import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { buildSuggestedAvailabilitySlots } from "@/lib/availability-scheduler";
import {
  buildDrpsCalendarEvents,
  loadStoredCalendarEvents,
  mergeAndSortMasterCalendarEvents,
} from "@/lib/master-calendar";
import { isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ClientRow = {
  client_id: string;
  company_name: string;
};

type AssignmentRow = {
  client_program_id: string;
  program_id: string;
  status: "Recommended" | "Active" | "Completed";
  deployed_at: string | null;
};

type ProgramRow = {
  program_id: string;
  title: string;
  schedule_frequency: string | null;
  schedule_anchor_date: string | null;
};

type CampaignRow = {
  id: string;
  client_id: string | null;
  name: string;
  starts_at: string | null;
  closes_at: string | null;
};

type AvailabilityRequestRow = {
  request_id: string;
  status: "pending" | "submitted" | "scheduled" | "closed";
  requested_at: string;
  due_at: string | null;
  suggested_slots: unknown;
  selected_slots: unknown;
  submitted_at: string | null;
};

type AvailabilitySlot = {
  startsAt: string;
  endsAt: string;
};

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
  _request: NextRequest,
  context: { params: Promise<{ clientSlug: string; assignmentId: string }> },
) {
  const { clientSlug, assignmentId } = await context.params;
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
  const client = clientResult.data;

  const assignmentResult = await supabase
    .from("client_programs")
    .select("client_program_id,program_id,status,deployed_at")
    .eq("client_id", client.client_id)
    .eq("client_program_id", assignmentId)
    .maybeSingle<AssignmentRow>();
  if (assignmentResult.error) {
    return NextResponse.json({ error: "Could not load assigned program." }, { status: 500 });
  }
  if (!assignmentResult.data) {
    return NextResponse.json({ error: "Assigned program not found." }, { status: 404 });
  }
  if (assignmentResult.data.status === "Completed") {
    return NextResponse.json({ error: "Completed programs cannot be rescheduled." }, { status: 409 });
  }

  const programResult = await supabase
    .from("periodic_programs")
    .select("program_id,title,schedule_frequency,schedule_anchor_date")
    .eq("program_id", assignmentResult.data.program_id)
    .maybeSingle<ProgramRow>();
  if (programResult.error && !isMissingTableError(programResult.error, "periodic_programs")) {
    return NextResponse.json({ error: "Could not load program settings." }, { status: 500 });
  }
  if (!programResult.data) {
    return NextResponse.json({ error: "Program not found." }, { status: 404 });
  }

  const campaignsResult = await supabase
    .from("surveys")
    .select("id,client_id,name,starts_at,closes_at")
    .eq("client_id", client.client_id)
    .returns<CampaignRow[]>();
  if (campaignsResult.error && !isMissingTableError(campaignsResult.error, "surveys")) {
    return NextResponse.json({ error: "Could not compute suggested dates." }, { status: 500 });
  }

  const drpsEvents = buildDrpsCalendarEvents(campaignsResult.data ?? []);
  const stored = await loadStoredCalendarEvents(supabase, { clientId: client.client_id });
  const existingEvents = mergeAndSortMasterCalendarEvents(drpsEvents, stored.events).filter(
    (event) => event.sourceClientProgramId !== assignmentResult.data?.client_program_id,
  );

  const suggestedSlots = buildSuggestedAvailabilitySlots({
    deployedAt: assignmentResult.data.deployed_at ?? new Date().toISOString(),
    scheduleFrequency: programResult.data.schedule_frequency ?? null,
    scheduleAnchorDate: programResult.data.schedule_anchor_date ?? null,
    existingEvents,
  });

  const nowIso = new Date().toISOString();
  const dueAtIso = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

  const existingRequest = await supabase
    .from("client_program_availability_requests")
    .select("request_id")
    .eq("client_id", client.client_id)
    .eq("client_program_id", assignmentResult.data.client_program_id)
    .maybeSingle<{ request_id: string }>();

  if (
    existingRequest.error &&
    !isMissingTableError(existingRequest.error, "client_program_availability_requests")
  ) {
    return NextResponse.json({ error: "Could not open reschedule request." }, { status: 500 });
  }
  if (isMissingTableError(existingRequest.error, "client_program_availability_requests")) {
    return NextResponse.json(
      {
        error:
          "Availability table unavailable. Apply migration 20260302220000_master_calendar_availability.sql.",
      },
      { status: 412 },
    );
  }

  let upserted: AvailabilityRequestRow | null = null;
  if (existingRequest.data) {
    const updateResult = await supabase
      .from("client_program_availability_requests")
      .update({
        status: "pending",
        requested_at: nowIso,
        due_at: dueAtIso,
        suggested_slots: suggestedSlots,
        selected_slots: [],
        submitted_at: null,
        updated_at: nowIso,
      })
      .eq("request_id", existingRequest.data.request_id)
      .eq("client_id", client.client_id)
      .select(
        "request_id,status,requested_at,due_at,suggested_slots,selected_slots,submitted_at",
      )
      .maybeSingle<AvailabilityRequestRow>();

    if (updateResult.error || !updateResult.data) {
      return NextResponse.json({ error: "Could not open reschedule request." }, { status: 500 });
    }
    upserted = updateResult.data;
  } else {
    const insertResult = await supabase
      .from("client_program_availability_requests")
      .insert({
        request_id: randomUUID(),
        client_id: client.client_id,
        client_program_id: assignmentResult.data.client_program_id,
        status: "pending",
        requested_at: nowIso,
        due_at: dueAtIso,
        suggested_slots: suggestedSlots,
        selected_slots: [],
        submitted_at: null,
        updated_at: nowIso,
      })
      .select(
        "request_id,status,requested_at,due_at,suggested_slots,selected_slots,submitted_at",
      )
      .maybeSingle<AvailabilityRequestRow>();

    if (insertResult.error || !insertResult.data) {
      return NextResponse.json({ error: "Could not open reschedule request." }, { status: 500 });
    }
    upserted = insertResult.data;
  }

  return NextResponse.json({
    request: {
      id: upserted.request_id,
      clientProgramId: assignmentResult.data.client_program_id,
      programId: assignmentResult.data.program_id,
      programTitle: programResult.data.title,
      status: upserted.status,
      requestedAt: upserted.requested_at,
      dueAt: upserted.due_at,
      submittedAt: upserted.submitted_at,
      suggestedSlots: parseSlots(upserted.suggested_slots),
      selectedSlots: parseSlots(upserted.selected_slots),
      clientCompanyName: client.company_name,
    },
  });
}
