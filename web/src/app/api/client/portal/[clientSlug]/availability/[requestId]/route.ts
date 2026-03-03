import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildSuggestedAvailabilitySlots,
  slotOverlapsMasterCalendar,
} from "@/lib/availability-scheduler";
import { createManagerNotification } from "@/lib/manager-notifications";
import {
  buildDrpsCalendarEvents,
  loadStoredCalendarEvents,
  mergeAndSortMasterCalendarEvents,
} from "@/lib/master-calendar";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ClientRow = {
  client_id: string;
  company_name: string;
};

type AvailabilityRequestRow = {
  request_id: string;
  client_program_id: string;
  status: "pending" | "submitted" | "scheduled" | "closed";
  suggested_slots: unknown;
};

type ClientProgramRow = {
  client_program_id: string;
  program_id: string;
  deployed_at: string | null;
  schedule_frequency_override?: string | null;
  schedule_anchor_date_override?: string | null;
};

type ProgramRow = {
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

type AvailabilitySlot = {
  startsAt: string;
  endsAt: string;
};

const submitAvailabilitySchema = z.object({
  selectedSlots: z.array(z.string().datetime()).min(1),
});

function parseSlots(value: unknown): AvailabilitySlot[] {
  if (!Array.isArray(value)) return [];
  const slots: AvailabilitySlot[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const startsAt = "startsAt" in item ? String(item.startsAt) : "";
    const endsAt = "endsAt" in item ? String(item.endsAt) : "";
    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);
    if (
      startsAt.length > 0 &&
      endsAt.length > 0 &&
      !Number.isNaN(startDate.getTime()) &&
      !Number.isNaN(endDate.getTime()) &&
      endDate.getTime() > startDate.getTime()
    ) {
      slots.push({ startsAt, endsAt });
    }
  }
  return slots;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ clientSlug: string; requestId: string }> },
) {
  let parsed: z.infer<typeof submitAvailabilitySchema>;
  try {
    parsed = submitAvailabilitySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const { clientSlug, requestId } = await context.params;
  const supabase = getSupabaseAdminClient();

  const clientResult = await supabase
    .from("clients")
    .select("client_id,company_name")
    .eq("portal_slug", clientSlug)
    .maybeSingle<ClientRow>();
  if (clientResult.error) {
    return NextResponse.json({ error: "Could not load client." }, { status: 500 });
  }
  if (!clientResult.data) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }
  const clientId = clientResult.data.client_id;
  const clientCompanyName = clientResult.data.company_name;

  const requestResult = await supabase
    .from("client_program_availability_requests")
    .select("request_id,client_program_id,status,suggested_slots")
    .eq("request_id", requestId)
    .eq("client_id", clientId)
    .maybeSingle<AvailabilityRequestRow>();

  if (requestResult.error) {
    if (isMissingTableError(requestResult.error, "client_program_availability_requests")) {
      return NextResponse.json(
        {
          error:
            "Availability table unavailable. Apply migration 20260302220000_master_calendar_availability.sql.",
        },
        { status: 412 },
      );
    }
    return NextResponse.json({ error: "Could not load availability request." }, { status: 500 });
  }

  if (!requestResult.data) {
    return NextResponse.json({ error: "Availability request not found." }, { status: 404 });
  }
  const availabilityRequest = requestResult.data;
  if (availabilityRequest.status === "closed") {
    return NextResponse.json({ error: "Availability request is closed." }, { status: 409 });
  }

  const withOverrides = await supabase
    .from("client_programs")
    .select(
      "client_program_id,program_id,deployed_at,schedule_frequency_override,schedule_anchor_date_override",
    )
    .eq("client_program_id", availabilityRequest.client_program_id)
    .eq("client_id", clientId)
    .maybeSingle<ClientProgramRow>();
  const assignmentResult =
    withOverrides.error && isMissingColumnError(withOverrides.error, "schedule_frequency_override")
      ? await supabase
          .from("client_programs")
          .select("client_program_id,program_id,deployed_at")
          .eq("client_program_id", availabilityRequest.client_program_id)
          .eq("client_id", clientId)
          .maybeSingle<ClientProgramRow>()
      : withOverrides;
  if (assignmentResult.error) {
    return NextResponse.json({ error: "Could not load assigned program." }, { status: 500 });
  }
  if (!assignmentResult.data) {
    return NextResponse.json({ error: "Assigned program not found." }, { status: 404 });
  }
  const assignment = assignmentResult.data;

  const programResult = await supabase
    .from("periodic_programs")
    .select("title,schedule_frequency,schedule_anchor_date")
    .eq("program_id", assignment.program_id)
    .maybeSingle<ProgramRow>();
  if (programResult.error && !isMissingTableError(programResult.error, "periodic_programs")) {
    return NextResponse.json({ error: "Could not load program details." }, { status: 500 });
  }

  let suggestedSlots = parseSlots(availabilityRequest.suggested_slots);
  if (suggestedSlots.length === 0) {
    const campaignsResult = await supabase
      .from("surveys")
      .select("id,client_id,name,starts_at,closes_at")
      .returns<CampaignRow[]>();
    if (campaignsResult.error && !isMissingTableError(campaignsResult.error, "surveys")) {
      return NextResponse.json({ error: "Could not validate availability." }, { status: 500 });
    }
    const drpsEvents = buildDrpsCalendarEvents(campaignsResult.data ?? []);
    const stored = await loadStoredCalendarEvents(supabase);
    const events = mergeAndSortMasterCalendarEvents(drpsEvents, stored.events);
    suggestedSlots = buildSuggestedAvailabilitySlots({
      deployedAt: assignment.deployed_at ?? new Date().toISOString(),
      scheduleFrequency:
        assignment.schedule_frequency_override ??
        programResult.data?.schedule_frequency ??
        null,
      scheduleAnchorDate:
        assignment.schedule_anchor_date_override ??
        programResult.data?.schedule_anchor_date ??
        null,
      existingEvents: events,
    });
  }

  const byStart = new Map(suggestedSlots.map((slot) => [slot.startsAt, slot]));
  const selectedSlots = parsed.selectedSlots.map((startsAt) => byStart.get(startsAt) ?? null);
  if (selectedSlots.some((slot) => !slot)) {
    return NextResponse.json(
      { error: "Selected availability must match the suggested conflict-free slots." },
      { status: 400 },
    );
  }

  const campaignsResult = await supabase
    .from("surveys")
    .select("id,client_id,name,starts_at,closes_at")
    .returns<CampaignRow[]>();
  if (campaignsResult.error && !isMissingTableError(campaignsResult.error, "surveys")) {
    return NextResponse.json({ error: "Could not validate availability." }, { status: 500 });
  }
  const drpsEvents = buildDrpsCalendarEvents(campaignsResult.data ?? []);
  const stored = await loadStoredCalendarEvents(supabase);
  const masterEvents = mergeAndSortMasterCalendarEvents(drpsEvents, stored.events);

  const safeSelected = selectedSlots as AvailabilitySlot[];
  const hasConflict = safeSelected.some((slot) =>
    slotOverlapsMasterCalendar(slot, masterEvents, {
      ignoreSourceClientProgramId: availabilityRequest.client_program_id,
    }),
  );
  if (hasConflict) {
    return NextResponse.json(
      { error: "At least one selected slot now conflicts with the master calendar. Refresh and try again." },
      { status: 409 },
    );
  }

  const meetingTitle = `Reagendamento - provisoria: ${programResult.data?.title ?? assignment.program_id}`;
  const existingEventsResult = await supabase
    .from("calendar_events")
    .select("event_id,metadata")
    .eq("client_id", clientId)
    .eq("source_client_program_id", availabilityRequest.client_program_id)
    .eq("event_type", "continuous_meeting")
    .returns<Array<{ event_id: string; metadata: unknown }>>();

  if (existingEventsResult.error && !isMissingTableError(existingEventsResult.error, "calendar_events")) {
    return NextResponse.json({ error: "Could not schedule meetings." }, { status: 500 });
  }
  if (isMissingTableError(existingEventsResult.error, "calendar_events")) {
    return NextResponse.json(
      {
        error:
          "Master calendar table unavailable. Apply migration 20260302220000_master_calendar_availability.sql.",
      },
      { status: 412 },
    );
  }

  const idsToDelete = (existingEventsResult.data ?? [])
    .filter((row) => {
      if (!row.metadata || typeof row.metadata !== "object" || Array.isArray(row.metadata)) {
        return false;
      }
      const metadata = row.metadata as Record<string, unknown>;
      return metadata.eventLifecycle === "provisory" && metadata.proposalKind === "reschedule";
    })
    .map((row) => row.event_id);

  if (idsToDelete.length > 0) {
    const deleteExisting = await supabase.from("calendar_events").delete().in("event_id", idsToDelete);
    if (deleteExisting.error) {
      return NextResponse.json({ error: "Could not schedule meetings." }, { status: 500 });
    }
  }

  const insertMeetings = await supabase.from("calendar_events").insert(
    safeSelected.map((slot) => ({
      event_id: randomUUID(),
      client_id: clientId,
      source_client_program_id: availabilityRequest.client_program_id,
      event_type: "continuous_meeting",
      title: meetingTitle,
      starts_at: slot.startsAt,
      ends_at: slot.endsAt,
      status: "scheduled",
      created_by: "client",
      metadata: {
        availabilityRequestId: availabilityRequest.request_id,
        eventLifecycle: "provisory",
        proposalKind: "reschedule",
        content: `Reagendamento proposto para o programa ${programResult.data?.title ?? assignment.program_id}.`,
        preparationRequired: "Aguardar confirmacao do gestor antes de considerar o horario final.",
      },
      updated_at: new Date().toISOString(),
    })),
  );
  if (insertMeetings.error) {
    return NextResponse.json({ error: "Could not schedule meetings." }, { status: 500 });
  }

  const nowIso = new Date().toISOString();
  const updateRequest = await supabase
    .from("client_program_availability_requests")
    .update({
      status: "submitted",
      selected_slots: safeSelected,
      submitted_at: nowIso,
      updated_at: nowIso,
    })
    .eq("request_id", availabilityRequest.request_id)
    .eq("client_id", clientId)
    .select("request_id,status,submitted_at,selected_slots")
    .maybeSingle<{
      request_id: string;
      status: "pending" | "submitted" | "scheduled" | "closed";
      submitted_at: string | null;
      selected_slots: unknown;
    }>();

  if (updateRequest.error) {
    return NextResponse.json({ error: "Could not update availability request." }, { status: 500 });
  }
  if (!updateRequest.data) {
    return NextResponse.json({ error: "Could not update availability request." }, { status: 500 });
  }

  try {
    await createManagerNotification(supabase, {
      clientId,
      notificationType: "client_reschedule_submitted",
      title: `Cliente reagendou processo continuo (${programResult.data?.title ?? assignment.program_id})`,
      message: `${clientCompanyName} enviou ${safeSelected.length} horario(s) provisoriamente. Confirmacao do gestor pendente.`,
      metadata: {
        clientSlug,
        clientCompanyName,
        availabilityRequestId: availabilityRequest.request_id,
        clientProgramId: availabilityRequest.client_program_id,
        programId: assignment.program_id,
        selectedSlots: safeSelected,
      },
    });
  } catch {
    // Do not block scheduling when notification persistence fails.
  }

  return NextResponse.json({
    request: {
      id: updateRequest.data.request_id,
      status: updateRequest.data.status,
      submittedAt: updateRequest.data.submitted_at,
      selectedSlots: parseSlots(updateRequest.data.selected_slots),
    },
  });
}
