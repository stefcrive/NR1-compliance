import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { buildSuggestedAvailabilitySlots, type AvailabilitySlot } from "@/lib/availability-scheduler";
import { isAdminApiAuthorized } from "@/lib/admin-auth";
import {
  buildDrpsCalendarEvents,
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

const updateAssignmentSchema = z
  .object({
    status: z.enum(["Recommended", "Active", "Completed"]).optional(),
    deployedAt: z.string().datetime().optional(),
    commitCalendarEvents: z.boolean().optional(),
    calendarSlotStartsAt: z.array(z.string().datetime()).max(24).optional(),
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

  if (
    withSchedule.error &&
    isMissingColumnError(withSchedule.error, "schedule_frequency")
  ) {
    return supabase
      .from("periodic_programs")
      .select("program_id,title")
      .eq("program_id", programId)
      .maybeSingle<ProgramRow>();
  }

  return withSchedule;
}

async function loadClientMasterCalendarEvents(clientId: string) {
  const supabase = getSupabaseAdminClient();
  const campaignsResult = await supabase
    .from("surveys")
    .select("id,client_id,name,starts_at,closes_at")
    .eq("client_id", clientId)
    .returns<CampaignRow[]>();

  if (
    campaignsResult.error &&
    !isMissingColumnError(campaignsResult.error, "client_id") &&
    !isMissingTableError(campaignsResult.error, "surveys")
  ) {
    throw campaignsResult.error;
  }

  const drpsEvents = buildDrpsCalendarEvents(campaignsResult.data ?? []);
  const stored = await loadStoredCalendarEvents(supabase, { clientId });
  return mergeAndSortMasterCalendarEvents(drpsEvents, stored.events);
}

async function commitCalendarEventsForAssignment(params: {
  clientId: string;
  assignment: ClientProgramRow;
  program: ProgramRow;
  selectedStartsAt?: string[];
}) {
  const supabase = getSupabaseAdminClient();
  const masterEvents = await loadClientMasterCalendarEvents(params.clientId);
  const existingWithoutAssignment = masterEvents.filter(
    (event) => event.sourceClientProgramId !== params.assignment.client_program_id,
  );

  const suggestedSlots = buildSuggestedAvailabilitySlots({
    deployedAt: params.assignment.deployed_at ?? new Date().toISOString(),
    scheduleFrequency: params.program.schedule_frequency ?? null,
    scheduleAnchorDate: params.program.schedule_anchor_date ?? null,
    existingEvents: existingWithoutAssignment,
  });

  const byStartsAt = new Map(suggestedSlots.map((slot) => [slot.startsAt, slot]));
  const selectedSlots =
    params.selectedStartsAt && params.selectedStartsAt.length > 0
      ? params.selectedStartsAt.map((startsAt) => byStartsAt.get(startsAt) ?? null)
      : suggestedSlots.slice(0, Math.min(4, suggestedSlots.length));

  if (selectedSlots.some((slot) => !slot)) {
    return {
      invalidSelectedSlots: true as const,
      unavailable: false as const,
      suggestedSlots,
      committedSlots: [] as AvailabilitySlot[],
    };
  }

  const safeSelectedSlots = selectedSlots as AvailabilitySlot[];
  const removeOldEvents = await supabase
    .from("calendar_events")
    .delete()
    .eq("client_id", params.clientId)
    .eq("source_client_program_id", params.assignment.client_program_id)
    .eq("event_type", "continuous_meeting");

  if (removeOldEvents.error) {
    if (isMissingTableError(removeOldEvents.error, "calendar_events")) {
      return {
        invalidSelectedSlots: false as const,
        unavailable: true as const,
        suggestedSlots,
        committedSlots: [] as AvailabilitySlot[],
      };
    }
    throw removeOldEvents.error;
  }

  if (safeSelectedSlots.length > 0) {
    const insertEvents = await supabase.from("calendar_events").insert(
      safeSelectedSlots.map((slot) => ({
        event_id: randomUUID(),
        client_id: params.clientId,
        source_client_program_id: params.assignment.client_program_id,
        event_type: "continuous_meeting",
        title: `Reuniao processo continuo: ${params.program.title}`,
        starts_at: slot.startsAt,
        ends_at: slot.endsAt,
        status: "scheduled",
        created_by: "manager",
        metadata: {
          source: "manager_assignment_edit",
        },
        updated_at: new Date().toISOString(),
      })),
    );
    if (insertEvents.error) {
      throw insertEvents.error;
    }
  }

  const nowIso = new Date().toISOString();
  const closeAvailabilityRequest = await supabase
    .from("client_program_availability_requests")
    .update({
      status: "closed",
      suggested_slots: suggestedSlots,
      selected_slots: safeSelectedSlots,
      submitted_at: nowIso,
      updated_at: nowIso,
    })
    .eq("client_id", params.clientId)
    .eq("client_program_id", params.assignment.client_program_id);

  if (
    closeAvailabilityRequest.error &&
    !isMissingTableError(closeAvailabilityRequest.error, "client_program_availability_requests")
  ) {
    throw closeAvailabilityRequest.error;
  }

  return {
    invalidSelectedSlots: false as const,
    unavailable: false as const,
    suggestedSlots,
    committedSlots: safeSelectedSlots,
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
  };

  const supabase = getSupabaseAdminClient();
  const updateResult =
    Object.keys(updatePayload).length > 0
      ? await supabase
          .from("client_programs")
          .update(updatePayload)
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
    return NextResponse.json({ error: "Could not update assignment." }, { status: 500 });
  }

  if (!updateResult.data) {
    return NextResponse.json({ error: "Assignment not found for this company." }, { status: 404 });
  }

  let calendarCommit:
    | {
        suggestedSlots: AvailabilitySlot[];
        committedSlots: AvailabilitySlot[];
      }
    | null = null;
  if (parsed.commitCalendarEvents) {
    const programResult = await loadProgram(updateResult.data.program_id);
    if (
      programResult.error &&
      !isMissingTableError(programResult.error, "periodic_programs")
    ) {
      return NextResponse.json({ error: "Could not load cadence settings." }, { status: 500 });
    }
    if (isMissingTableError(programResult.error, "periodic_programs") || !programResult.data) {
      return NextResponse.json({ error: "Program not found." }, { status: 404 });
    }

    const committed = await commitCalendarEventsForAssignment({
      clientId,
      assignment: updateResult.data,
      program: programResult.data,
      selectedStartsAt: parsed.calendarSlotStartsAt,
    });

    if (committed.unavailable) {
      return NextResponse.json(
        {
          error:
            "Master calendar table unavailable. Apply migration 20260302220000_master_calendar_availability.sql.",
        },
        { status: 412 },
      );
    }
    if (committed.invalidSelectedSlots) {
      return NextResponse.json(
        {
          error:
            "Selected calendar dates are no longer valid for this cadence. Refresh and select again.",
          suggestedSlots: committed.suggestedSlots,
        },
        { status: 409 },
      );
    }

    calendarCommit = {
      suggestedSlots: committed.suggestedSlots,
      committedSlots: committed.committedSlots,
    };
  }

  return NextResponse.json({
    assignment: {
      id: updateResult.data.client_program_id,
      programId: updateResult.data.program_id,
      status: updateResult.data.status,
      deployedAt: updateResult.data.deployed_at,
    },
    calendarCommit,
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
