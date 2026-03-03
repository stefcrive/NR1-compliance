import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildSuggestedAvailabilitySlots,
  slotOverlapsMasterCalendar,
  type AvailabilitySlot,
} from "@/lib/availability-scheduler";
import { isAdminApiAuthorized } from "@/lib/admin-auth";
import {
  buildDrpsCalendarEvents,
  extractCalendarEventDetails,
  loadStoredCalendarEvents,
  mergeAndSortMasterCalendarEvents,
} from "@/lib/master-calendar";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ClientProgramRow = {
  client_program_id: string;
  program_id: string;
  status: "Recommended" | "Active" | "Completed";
  deployed_at: string | null;
  schedule_frequency_override?: string | null;
  schedule_anchor_date_override?: string | null;
};

type ProgramRow = {
  program_id: string;
  title: string;
  schedule_frequency?: string | null;
  schedule_anchor_date?: string | null;
};

type CampaignRow = {
  id: string;
  client_id: string | null;
  name: string;
  starts_at: string | null;
  closes_at: string | null;
};

type CalendarEventRow = {
  event_id: string;
  metadata: unknown;
  starts_at?: string;
  ends_at?: string;
};

const cadenceFrequencyValues = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
  "custom",
] as const;

const slotSchema = z
  .object({
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })
  .refine((value) => new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(), {
    message: "Invalid slot range.",
    path: ["endsAt"],
  });

const updateAssignmentSchema = z
  .object({
    status: z.enum(["Recommended", "Active", "Completed"]).optional(),
    deployedAt: z.string().datetime().optional(),
    scheduleFrequency: z.enum(cadenceFrequencyValues).optional(),
    scheduleAnchorDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .or(z.literal("")),
    provisorySlots: z.array(slotSchema).max(24).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

async function loadProgram(programId: string) {
  const supabase = getSupabaseAdminClient();
  const withSchedule = await supabase
    .from("periodic_programs")
    .select("program_id,title,schedule_frequency,schedule_anchor_date")
    .eq("program_id", programId)
    .maybeSingle<ProgramRow>();

  if (withSchedule.error && isMissingColumnError(withSchedule.error, "schedule_frequency")) {
    return supabase
      .from("periodic_programs")
      .select("program_id,title")
      .eq("program_id", programId)
      .maybeSingle<ProgramRow>();
  }

  return withSchedule;
}

async function loadManagerMasterCalendarEvents() {
  const supabase = getSupabaseAdminClient();
  const campaignsResult = await supabase
    .from("surveys")
    .select("id,client_id,name,starts_at,closes_at")
    .returns<CampaignRow[]>();

  if (
    campaignsResult.error &&
    !isMissingColumnError(campaignsResult.error, "client_id") &&
    !isMissingTableError(campaignsResult.error, "surveys")
  ) {
    throw campaignsResult.error;
  }

  const drpsEvents = buildDrpsCalendarEvents(campaignsResult.data ?? []);
  const stored = await loadStoredCalendarEvents(supabase);
  return mergeAndSortMasterCalendarEvents(drpsEvents, stored.events);
}

function resolveCadence(assignment: ClientProgramRow, program: ProgramRow) {
  return {
    scheduleFrequency:
      assignment.schedule_frequency_override ?? program.schedule_frequency ?? "monthly",
    scheduleAnchorDate:
      assignment.schedule_anchor_date_override ?? program.schedule_anchor_date ?? null,
  };
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA < endB && endA > startB;
}

function sortSlots(slots: AvailabilitySlot[]): AvailabilitySlot[] {
  return slots
    .slice()
    .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
}

function normalizeSlots(slots: AvailabilitySlot[]): AvailabilitySlot[] {
  const unique = new Map<string, AvailabilitySlot>();
  for (const slot of slots) {
    const start = new Date(slot.startsAt);
    const end = new Date(slot.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      continue;
    }
    unique.set(`${start.toISOString()}|${end.toISOString()}`, {
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    });
  }
  return sortSlots(Array.from(unique.values()));
}

async function loadProvisoryAssignmentSlots(params: {
  clientId: string;
  assignmentId: string;
}): Promise<{ slots: AvailabilitySlot[]; unavailable: boolean }> {
  const supabase = getSupabaseAdminClient();
  const eventsResult = await supabase
    .from("calendar_events")
    .select("event_id,metadata,starts_at,ends_at")
    .eq("client_id", params.clientId)
    .eq("source_client_program_id", params.assignmentId)
    .eq("event_type", "continuous_meeting")
    .order("starts_at", { ascending: true })
    .returns<CalendarEventRow[]>();

  if (eventsResult.error) {
    if (isMissingTableError(eventsResult.error, "calendar_events")) {
      return { slots: [], unavailable: true };
    }
    throw eventsResult.error;
  }

  const slots: AvailabilitySlot[] = [];
  for (const row of eventsResult.data ?? []) {
    if (!row.starts_at || !row.ends_at) continue;
    const details = extractCalendarEventDetails(row.metadata);
    if (details.eventLifecycle !== "provisory" || details.proposalKind !== "assignment") continue;
    slots.push({ startsAt: row.starts_at, endsAt: row.ends_at });
  }

  return { slots: sortSlots(slots), unavailable: false };
}

async function replaceAssignmentProvisoryEvents(params: {
  clientId: string;
  assignmentId: string;
  programTitle: string;
  slots: AvailabilitySlot[];
}): Promise<{
  unavailable: boolean;
  invalidSlot: boolean;
  provisorySlots: AvailabilitySlot[];
}> {
  const supabase = getSupabaseAdminClient();
  const normalizedSlots = normalizeSlots(params.slots);

  const masterEvents = await loadManagerMasterCalendarEvents();
  const eventsWithoutCurrentProvisory = masterEvents.filter((event) => {
    if (event.sourceClientProgramId !== params.assignmentId) return true;
    if (event.eventType !== "continuous_meeting") return true;
    return !(
      event.details.eventLifecycle === "provisory" && event.details.proposalKind === "assignment"
    );
  });

  const hasMasterConflict = normalizedSlots.some((slot) =>
    slotOverlapsMasterCalendar(slot, eventsWithoutCurrentProvisory),
  );
  if (hasMasterConflict) {
    return {
      unavailable: false,
      invalidSlot: true,
      provisorySlots: normalizedSlots,
    };
  }

  for (let index = 0; index < normalizedSlots.length; index += 1) {
    const left = normalizedSlots[index];
    const leftStart = new Date(left.startsAt);
    const leftEnd = new Date(left.endsAt);
    for (let otherIndex = index + 1; otherIndex < normalizedSlots.length; otherIndex += 1) {
      const right = normalizedSlots[otherIndex];
      const rightStart = new Date(right.startsAt);
      const rightEnd = new Date(right.endsAt);
      if (overlaps(leftStart, leftEnd, rightStart, rightEnd)) {
        return {
          unavailable: false,
          invalidSlot: true,
          provisorySlots: normalizedSlots,
        };
      }
    }
  }

  const existingResult = await supabase
    .from("calendar_events")
    .select("event_id,metadata")
    .eq("client_id", params.clientId)
    .eq("source_client_program_id", params.assignmentId)
    .eq("event_type", "continuous_meeting")
    .returns<CalendarEventRow[]>();

  if (existingResult.error) {
    if (isMissingTableError(existingResult.error, "calendar_events")) {
      return {
        unavailable: true,
        invalidSlot: false,
        provisorySlots: [],
      };
    }
    throw existingResult.error;
  }

  const idsToDelete = (existingResult.data ?? [])
    .filter((row) => {
      const details = extractCalendarEventDetails(row.metadata);
      return details.eventLifecycle === "provisory" && details.proposalKind === "assignment";
    })
    .map((row) => row.event_id);

  if (idsToDelete.length > 0) {
    const deleteResult = await supabase.from("calendar_events").delete().in("event_id", idsToDelete);
    if (deleteResult.error) {
      throw deleteResult.error;
    }
  }

  if (normalizedSlots.length > 0) {
    const nowIso = new Date().toISOString();
    const insertEvents = await supabase.from("calendar_events").insert(
      normalizedSlots.map((slot) => ({
        event_id: randomUUID(),
        client_id: params.clientId,
        source_client_program_id: params.assignmentId,
        event_type: "continuous_meeting",
        title: `Reuniao processo continuo: ${params.programTitle}`,
        starts_at: slot.startsAt,
        ends_at: slot.endsAt,
        status: "scheduled",
        created_by: "manager",
        metadata: {
          source: "manager_assignment_edit",
          eventLifecycle: "provisory",
          proposalKind: "assignment",
          content: `Reuniao provisoria do programa ${params.programTitle}.`,
          preparationRequired: "Revisar indicadores recentes e alinhar proximos passos.",
        },
        updated_at: nowIso,
      })),
    );
    if (insertEvents.error) {
      throw insertEvents.error;
    }
  }

  return {
    unavailable: false,
    invalidSlot: false,
    provisorySlots: normalizedSlots,
  };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ clientId: string; assignmentId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { clientId, assignmentId } = await context.params;
  let parsed: z.infer<typeof updateAssignmentSchema>;
  try {
    parsed = updateAssignmentSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const updatePayload = {
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
    ...(parsed.deployedAt !== undefined ? { deployed_at: parsed.deployedAt } : {}),
    ...(parsed.scheduleFrequency !== undefined
      ? { schedule_frequency_override: parsed.scheduleFrequency }
      : {}),
    ...(parsed.scheduleAnchorDate !== undefined
      ? {
          schedule_anchor_date_override:
            parsed.scheduleAnchorDate && parsed.scheduleAnchorDate.length > 0
              ? parsed.scheduleAnchorDate
              : null,
        }
      : {}),
  };

  const supabase = getSupabaseAdminClient();
  const withOverrides =
    Object.keys(updatePayload).length > 0
      ? await supabase
          .from("client_programs")
          .update(updatePayload)
          .eq("client_id", clientId)
          .eq("client_program_id", assignmentId)
          .select(
            "client_program_id,program_id,status,deployed_at,schedule_frequency_override,schedule_anchor_date_override",
          )
          .maybeSingle<ClientProgramRow>()
      : await supabase
          .from("client_programs")
          .select(
            "client_program_id,program_id,status,deployed_at,schedule_frequency_override,schedule_anchor_date_override",
          )
          .eq("client_id", clientId)
          .eq("client_program_id", assignmentId)
          .maybeSingle<ClientProgramRow>();

  const updateResult =
    withOverrides.error && isMissingColumnError(withOverrides.error, "schedule_frequency_override")
      ? Object.keys(updatePayload).some(
          (key) =>
            key === "schedule_frequency_override" ||
            key === "schedule_anchor_date_override",
        )
        ? null
        : Object.keys(updatePayload).length > 0
          ? await supabase
              .from("client_programs")
              .update({
                ...(parsed.status !== undefined ? { status: parsed.status } : {}),
                ...(parsed.deployedAt !== undefined ? { deployed_at: parsed.deployedAt } : {}),
              })
              .eq("client_id", clientId)
              .eq("client_program_id", assignmentId)
              .select("client_program_id,program_id,status,deployed_at")
              .maybeSingle<ClientProgramRow>()
          : await supabase
              .from("client_programs")
              .select("client_program_id,program_id,status,deployed_at")
              .eq("client_id", clientId)
              .eq("client_program_id", assignmentId)
              .maybeSingle<ClientProgramRow>()
      : withOverrides;

  if (!updateResult) {
    return NextResponse.json(
      {
        error:
          "Cadence override columns are unavailable. Apply migration 20260303130000_client_program_cadence_override.sql.",
      },
      { status: 412 },
    );
  }

  if (updateResult.error) {
    if (isMissingTableError(updateResult.error, "client_programs")) {
      return NextResponse.json(
        {
          error:
            "Assignments table is unavailable. Apply migration 20260301173000_seed_b2b_multitenant_compliance.sql.",
        },
        { status: 412 },
      );
    }
    return NextResponse.json(
      {
        error: updateResult.error.message
          ? `Could not update assignment. ${updateResult.error.message}`
          : "Could not update assignment.",
      },
      { status: 500 },
    );
  }

  if (!updateResult.data) {
    return NextResponse.json({ error: "Assignment not found for this company." }, { status: 404 });
  }

  const assignment = updateResult.data;
  const programResult = await loadProgram(assignment.program_id);
  if (programResult.error && !isMissingTableError(programResult.error, "periodic_programs")) {
    return NextResponse.json({ error: "Could not load cadence settings." }, { status: 500 });
  }
  if (isMissingTableError(programResult.error, "periodic_programs") || !programResult.data) {
    return NextResponse.json({ error: "Program not found." }, { status: 404 });
  }

  const cadence = resolveCadence(assignment, programResult.data);

  const shouldRefreshProvisorySlots =
    parsed.provisorySlots !== undefined ||
    parsed.deployedAt !== undefined ||
    parsed.scheduleFrequency !== undefined ||
    parsed.scheduleAnchorDate !== undefined;

  let provisorySlots: AvailabilitySlot[] = [];
  if (shouldRefreshProvisorySlots) {
    let desiredSlots: AvailabilitySlot[] = [];

    if (parsed.provisorySlots) {
      desiredSlots = normalizeSlots(parsed.provisorySlots);
    } else {
      const masterEvents = await loadManagerMasterCalendarEvents();
      desiredSlots = buildSuggestedAvailabilitySlots({
        deployedAt: assignment.deployed_at ?? new Date().toISOString(),
        scheduleFrequency: cadence.scheduleFrequency,
        scheduleAnchorDate: cadence.scheduleAnchorDate,
        existingEvents: masterEvents.filter((event) => event.sourceClientProgramId !== assignment.client_program_id),
      });
    }

    const replaced = await replaceAssignmentProvisoryEvents({
      clientId,
      assignmentId: assignment.client_program_id,
      programTitle: programResult.data.title,
      slots: desiredSlots,
    });

    if (replaced.unavailable) {
      return NextResponse.json(
        {
          error:
            "Master calendar table unavailable. Apply migration 20260302220000_master_calendar_availability.sql.",
        },
        { status: 412 },
      );
    }

    if (replaced.invalidSlot) {
      return NextResponse.json(
        {
          error: "One or more provisional meetings conflict with the master calendar.",
          provisorySlots: replaced.provisorySlots,
        },
        { status: 409 },
      );
    }

    provisorySlots = replaced.provisorySlots;
  } else {
    const loaded = await loadProvisoryAssignmentSlots({
      clientId,
      assignmentId: assignment.client_program_id,
    });
    provisorySlots = loaded.slots;
  }

  return NextResponse.json({
    assignment: {
      id: assignment.client_program_id,
      programId: assignment.program_id,
      status: assignment.status,
      deployedAt: assignment.deployed_at,
      scheduleFrequency: cadence.scheduleFrequency,
      scheduleAnchorDate: cadence.scheduleAnchorDate,
      cadenceSuggestedSlots: provisorySlots,
      calendarProvisorySlots: provisorySlots,
    },
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ clientId: string; assignmentId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { clientId, assignmentId } = await context.params;
  const supabase = getSupabaseAdminClient();
  const deleteResult = await supabase
    .from("client_programs")
    .delete()
    .eq("client_id", clientId)
    .eq("client_program_id", assignmentId)
    .select("client_program_id")
    .maybeSingle<{ client_program_id: string }>();

  if (deleteResult.error) {
    if (isMissingTableError(deleteResult.error, "client_programs")) {
      return NextResponse.json(
        {
          error:
            "Assignments table is unavailable. Apply migration 20260301173000_seed_b2b_multitenant_compliance.sql.",
        },
        { status: 412 },
      );
    }
    return NextResponse.json({ error: "Could not remove assignment." }, { status: 500 });
  }

  if (!deleteResult.data) {
    return NextResponse.json({ error: "Assignment not found for this company." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
