import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildSuggestedAvailabilitySlots,
  DEFAULT_ASSIGNMENT_CADENCE_SLOT_COUNT,
  slotOverlapsMasterCalendar,
  type AvailabilitySlot,
} from "@/lib/availability-scheduler";
import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY } from "@/lib/continuous-programs";
import {
  buildDrpsCalendarEvents,
  extractCalendarEventDetails,
  loadStoredCalendarEvents,
  mergeAndSortMasterCalendarEvents,
  type MasterCalendarEvent,
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
  annual_plan_months?: unknown;
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
const annualPlanMonthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
const annualPlanCandidateHoursUtc = [13, 17, 19] as const;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

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
    annualPlanMonths: z.array(z.string().regex(annualPlanMonthRegex)).max(12).optional(),
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

function resolveCadence(assignment: ClientProgramRow) {
  return {
    scheduleFrequency:
      assignment.schedule_frequency_override ?? DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY,
    scheduleAnchorDate: todayIsoDate(),
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

function normalizeAnnualPlanMonths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (!annualPlanMonthRegex.test(normalized)) continue;
    unique.add(normalized);
  }
  return Array.from(unique.values()).sort();
}

function parseAnnualPlanMonthKey(value: string): { year: number; monthIndex: number } | null {
  if (!annualPlanMonthRegex.test(value)) return null;
  const [yearText, monthText] = value.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return null;
  return { year, monthIndex };
}

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function isWeekendUtc(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function filterCurrentAssignmentProvisoryEvents(
  events: MasterCalendarEvent[],
  assignmentId: string,
): MasterCalendarEvent[] {
  return events.filter((event) => {
    if (event.sourceClientProgramId !== assignmentId) return true;
    if (event.eventType !== "continuous_meeting") return true;
    return !(
      event.details.eventLifecycle === "provisory" && event.details.proposalKind === "assignment"
    );
  });
}

function buildAnnualPlanProvisorySlots(params: {
  annualPlanMonths: string[];
  deployedAt: string | null;
  existingEvents: MasterCalendarEvent[];
  durationMinutes?: number;
}): AvailabilitySlot[] {
  if (params.annualPlanMonths.length === 0) return [];

  const deployedDate = params.deployedAt ? new Date(params.deployedAt) : null;
  const hasDeployedDate = deployedDate && !Number.isNaN(deployedDate.getTime());
  const preferredDay = hasDeployedDate ? Math.min(28, Math.max(1, deployedDate.getUTCDate())) : 1;
  const preferredHour = hasDeployedDate ? deployedDate.getUTCHours() : annualPlanCandidateHoursUtc[0];
  const preferredMinute = hasDeployedDate ? deployedDate.getUTCMinutes() : 0;
  const candidateHours = [preferredHour, ...annualPlanCandidateHoursUtc.filter((hour) => hour !== preferredHour)];
  const durationMinutes = params.durationMinutes ?? 60;
  const slotDurationMs = durationMinutes * 60 * 1000;
  const minStart = new Date();
  minStart.setUTCDate(minStart.getUTCDate() + 1);

  const generated: AvailabilitySlot[] = [];
  for (const monthKey of params.annualPlanMonths) {
    const parsed = parseAnnualPlanMonthKey(monthKey);
    if (!parsed) continue;

    const daysInMonth = daysInUtcMonth(parsed.year, parsed.monthIndex);
    let chosen: AvailabilitySlot | null = null;

    for (let dayOffset = 0; dayOffset < daysInMonth && !chosen; dayOffset += 1) {
      const day = ((preferredDay - 1 + dayOffset) % daysInMonth) + 1;
      for (const hour of candidateHours) {
        const start = new Date(
          Date.UTC(parsed.year, parsed.monthIndex, day, hour, preferredMinute, 0, 0),
        );
        if (start.getUTCMonth() !== parsed.monthIndex) continue;
        if (isWeekendUtc(start) || start <= minStart) continue;
        const end = new Date(start.getTime() + slotDurationMs);
        const candidate = { startsAt: start.toISOString(), endsAt: end.toISOString() };
        if (slotOverlapsMasterCalendar(candidate, params.existingEvents)) continue;
        const hasGeneratedOverlap = generated.some((slot) =>
          overlaps(new Date(slot.startsAt), new Date(slot.endsAt), start, end),
        );
        if (hasGeneratedOverlap) continue;
        chosen = candidate;
        break;
      }
    }

    if (chosen) {
      generated.push(chosen);
    }
  }

  return sortSlots(generated);
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
  const eventsWithoutCurrentProvisory = filterCurrentAssignmentProvisoryEvents(
    masterEvents,
    params.assignmentId,
  );

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

  const normalizedAnnualPlanMonths =
    parsed.annualPlanMonths !== undefined
      ? normalizeAnnualPlanMonths(parsed.annualPlanMonths)
      : undefined;

  const modernPayload = {
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
    ...(parsed.deployedAt !== undefined ? { deployed_at: parsed.deployedAt } : {}),
    ...(parsed.scheduleFrequency !== undefined
      ? { schedule_frequency_override: parsed.scheduleFrequency }
      : {}),
    ...(normalizedAnnualPlanMonths !== undefined
      ? { annual_plan_months: normalizedAnnualPlanMonths }
      : {}),
  };
  const statusAndDatePayload = {
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
    ...(parsed.deployedAt !== undefined ? { deployed_at: parsed.deployedAt } : {}),
  };
  const statusOnlyPayload = {
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
  };

  const supabase = getSupabaseAdminClient();
  let annualPlanSupported = true;
  let updateResult =
    Object.keys(modernPayload).length > 0
      ? await supabase
          .from("client_programs")
          .update(modernPayload)
          .eq("client_id", clientId)
          .eq("client_program_id", assignmentId)
          .select(
            "client_program_id,program_id,status,deployed_at,schedule_frequency_override,schedule_anchor_date_override,annual_plan_months",
          )
          .maybeSingle<ClientProgramRow>()
      : await supabase
          .from("client_programs")
          .select(
            "client_program_id,program_id,status,deployed_at,schedule_frequency_override,schedule_anchor_date_override,annual_plan_months",
          )
          .eq("client_id", clientId)
          .eq("client_program_id", assignmentId)
          .maybeSingle<ClientProgramRow>();

  if (updateResult.error && isMissingColumnError(updateResult.error, "annual_plan_months")) {
    annualPlanSupported = false;
    if (normalizedAnnualPlanMonths !== undefined) {
      return NextResponse.json(
        {
          error:
            "Annual plan columns are unavailable. Apply migration 20260304120000_client_program_annual_plan.sql.",
        },
        { status: 412 },
      );
    }

    const withoutAnnualPayload = {
      ...(parsed.status !== undefined ? { status: parsed.status } : {}),
      ...(parsed.deployedAt !== undefined ? { deployed_at: parsed.deployedAt } : {}),
      ...(parsed.scheduleFrequency !== undefined
        ? { schedule_frequency_override: parsed.scheduleFrequency }
        : {}),
    };
    updateResult =
      Object.keys(withoutAnnualPayload).length > 0
        ? await supabase
            .from("client_programs")
            .update(withoutAnnualPayload)
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
  }

  if (updateResult.error && isMissingColumnError(updateResult.error, "schedule_frequency_override")) {
    annualPlanSupported = false;
    if (parsed.scheduleFrequency !== undefined) {
      return NextResponse.json(
        {
          error:
            "Cadence override columns are unavailable. Apply migration 20260303130000_client_program_cadence_override.sql.",
        },
        { status: 412 },
      );
    }

    updateResult =
      Object.keys(statusAndDatePayload).length > 0
        ? await supabase
            .from("client_programs")
            .update(statusAndDatePayload)
            .eq("client_id", clientId)
            .eq("client_program_id", assignmentId)
            .select("client_program_id,program_id,status,deployed_at")
            .maybeSingle<ClientProgramRow>()
        : await supabase
            .from("client_programs")
            .select("client_program_id,program_id,status,deployed_at")
            .eq("client_id", clientId)
            .eq("client_program_id", assignmentId)
            .maybeSingle<ClientProgramRow>();
  }

  if (updateResult.error && isMissingColumnError(updateResult.error, "deployed_at")) {
    annualPlanSupported = false;
    updateResult =
      Object.keys(statusOnlyPayload).length > 0
        ? await supabase
            .from("client_programs")
            .update(statusOnlyPayload)
            .eq("client_id", clientId)
            .eq("client_program_id", assignmentId)
            .select("client_program_id,program_id,status")
            .maybeSingle<ClientProgramRow>()
        : await supabase
            .from("client_programs")
            .select("client_program_id,program_id,status")
            .eq("client_id", clientId)
            .eq("client_program_id", assignmentId)
            .maybeSingle<ClientProgramRow>();
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

  const cadence = resolveCadence(assignment);
  const annualPlanMonths = annualPlanSupported
    ? normalizeAnnualPlanMonths(assignment.annual_plan_months)
    : [];

  const shouldRefreshProvisorySlots =
    parsed.status !== undefined ||
    parsed.provisorySlots !== undefined ||
    parsed.deployedAt !== undefined ||
    parsed.scheduleFrequency !== undefined ||
    parsed.annualPlanMonths !== undefined;

  let provisorySlots: AvailabilitySlot[] = [];
  if (shouldRefreshProvisorySlots) {
    let desiredSlots: AvailabilitySlot[] = [];

    if (assignment.status !== "Active") {
      desiredSlots = [];
    } else if (annualPlanSupported) {
      const masterEvents = await loadManagerMasterCalendarEvents();
      const eventsWithoutCurrentProvisory = filterCurrentAssignmentProvisoryEvents(
        masterEvents,
        assignment.client_program_id,
      );
      desiredSlots = buildAnnualPlanProvisorySlots({
        annualPlanMonths,
        deployedAt: assignment.deployed_at,
        existingEvents: eventsWithoutCurrentProvisory,
      });
    } else {
      const masterEvents = await loadManagerMasterCalendarEvents();
      desiredSlots = buildSuggestedAvailabilitySlots({
        deployedAt: assignment.deployed_at ?? new Date().toISOString(),
        scheduleFrequency: cadence.scheduleFrequency,
        scheduleAnchorDate: cadence.scheduleAnchorDate,
        existingEvents: masterEvents.filter(
          (event) => event.sourceClientProgramId !== assignment.client_program_id,
        ),
        maxSlots: DEFAULT_ASSIGNMENT_CADENCE_SLOT_COUNT,
        enforceCadenceSeries: true,
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
      annualPlanMonths,
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
