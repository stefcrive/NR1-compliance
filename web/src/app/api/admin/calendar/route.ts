import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import {
  buildDrpsCalendarEvents,
  extractCalendarEventDetails,
  loadStoredCalendarEvents,
  mergeAndSortMasterCalendarEvents,
  withClientNames,
} from "@/lib/master-calendar";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type SurveyRow = {
  id: string;
  client_id: string | null;
  name: string;
  starts_at: string | null;
  closes_at: string | null;
};

type ClientRow = {
  client_id: string;
  company_name: string;
};

type ActiveClientProgramRow = {
  client_program_id: string;
  client_id: string;
  program_id: string;
  status: "Recommended" | "Active" | "Completed";
  deployed_at?: string | null;
};

type ProgramTitleRow = {
  program_id: string;
  title: string;
};

type EditableCalendarEventRow = {
  event_id: string;
  client_id: string | null;
  source_client_program_id: string | null;
  event_type: "continuous_meeting" | "blocked";
  title: string;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "completed" | "cancelled";
  metadata: unknown;
};

type RelatedCalendarEventRow = {
  event_id: string;
  client_id: string | null;
  source_client_program_id: string | null;
  event_type: "continuous_meeting" | "blocked";
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "completed" | "cancelled";
  metadata: unknown;
};

const detailTextSchema = z.string().trim().max(1500);

const createBlockedEventSchema = z
  .object({
    eventType: z.literal("blocked").optional(),
    clientId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(3).max(160).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    markedAt: z.string().datetime().optional(),
    workshopDurationMinutes: z.number().int().min(15).max(24 * 60).optional(),
    content: detailTextSchema.optional(),
    preparationRequired: detailTextSchema.optional(),
  });

const updateCalendarEventSchema = z
  .object({
    eventId: z.string().uuid(),
    title: z.string().trim().min(3).max(160).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    markedAt: z.string().datetime().optional(),
    workshopDurationMinutes: z.number().int().min(15).max(24 * 60).optional(),
    eventLifecycle: z.enum(["provisory", "committed"]).optional(),
    content: detailTextSchema.nullable().optional(),
    preparationRequired: detailTextSchema.nullable().optional(),
    commitProvisoryReschedule: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== "eventId"), {
    message: "At least one editable field must be provided.",
    path: ["eventId"],
  });

const deleteCalendarEventSchema = z.object({
  eventId: z.string().uuid(),
});

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function availabilityRequestIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  const raw = record.availabilityRequestId ?? record.availability_request_id ?? null;
  if (typeof raw !== "string") return null;
  return raw.trim().length > 0 ? raw : null;
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA < endB && endA > startB;
}

function resolveTimeWindow(params: {
  startsAt?: string;
  endsAt?: string;
  markedAt?: string;
  workshopDurationMinutes?: number;
  currentStartsAt?: string;
  currentEndsAt?: string;
  requireComplete: boolean;
}): { startsAt: string; endsAt: string } | null {
  const startsAt = params.markedAt ?? params.startsAt ?? params.currentStartsAt;
  if (!startsAt) return null;

  let endsAt = params.endsAt ?? params.currentEndsAt;
  if (params.workshopDurationMinutes !== undefined) {
    const startDate = new Date(startsAt);
    if (Number.isNaN(startDate.getTime())) return null;
    endsAt = new Date(startDate.getTime() + params.workshopDurationMinutes * 60 * 1000).toISOString();
  }

  if (!endsAt) {
    return params.requireComplete ? null : { startsAt, endsAt: startsAt };
  }

  const startDate = new Date(startsAt);
  const endDate = new Date(endsAt);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  if (endDate.getTime() <= startDate.getTime()) return null;

  return { startsAt: startDate.toISOString(), endsAt: endDate.toISOString() };
}

async function hasMasterCalendarConflict(params: {
  eventId: string;
  startsAt: string;
  endsAt: string;
}): Promise<boolean> {
  const [surveys, stored] = await Promise.all([
    loadSurveyRows(),
    loadStoredCalendarEvents(getSupabaseAdminClient()),
  ]);

  const masterEvents = mergeAndSortMasterCalendarEvents(
    buildDrpsCalendarEvents(surveys),
    stored.events,
  );
  const nextStart = new Date(params.startsAt);
  const nextEnd = new Date(params.endsAt);
  if (Number.isNaN(nextStart.getTime()) || Number.isNaN(nextEnd.getTime())) {
    return true;
  }

  return masterEvents.some((candidate) => {
    if (candidate.id === params.eventId) return false;
    if (candidate.status === "cancelled") return false;
    const candidateStart = new Date(candidate.startsAt);
    const candidateEnd = new Date(candidate.endsAt);
    if (Number.isNaN(candidateStart.getTime()) || Number.isNaN(candidateEnd.getTime())) {
      return false;
    }
    return overlaps(nextStart, nextEnd, candidateStart, candidateEnd);
  });
}

async function loadSurveyRows() {
  const supabase = getSupabaseAdminClient();
  const surveysResult = await supabase
    .from("surveys")
    .select("id,client_id,name,starts_at,closes_at")
    .returns<SurveyRow[]>();

  if (
    surveysResult.error &&
    !isMissingColumnError(surveysResult.error, "client_id") &&
    !isMissingTableError(surveysResult.error, "surveys")
  ) {
    throw surveysResult.error;
  }

  if (
    isMissingColumnError(surveysResult.error, "client_id") ||
    isMissingTableError(surveysResult.error, "surveys")
  ) {
    return [] as SurveyRow[];
  }

  return surveysResult.data ?? [];
}

async function loadClientNames(clientIds: string[]) {
  if (clientIds.length === 0) {
    return new Map<string, string>();
  }
  const supabase = getSupabaseAdminClient();
  const clientsResult = await supabase
    .from("clients")
    .select("client_id,company_name")
    .in("client_id", clientIds)
    .returns<ClientRow[]>();

  if (
    clientsResult.error &&
    !isMissingTableError(clientsResult.error, "clients") &&
    !isMissingColumnError(clientsResult.error, "company_name")
  ) {
    throw clientsResult.error;
  }

  return new Map((clientsResult.data ?? []).map((row) => [row.client_id, row.company_name]));
}

async function loadActiveContinuousPrograms() {
  const supabase = getSupabaseAdminClient();
  const withDeployedAt = await supabase
    .from("client_programs")
    .select("client_program_id,client_id,program_id,status,deployed_at")
    .returns<ActiveClientProgramRow[]>();

  const assignmentsResult =
    withDeployedAt.error && isMissingColumnError(withDeployedAt.error, "deployed_at")
      ? await supabase
          .from("client_programs")
          .select("client_program_id,client_id,program_id,status")
          .returns<ActiveClientProgramRow[]>()
      : withDeployedAt;

  if (
    assignmentsResult.error &&
    !isMissingTableError(assignmentsResult.error, "client_programs")
  ) {
    throw assignmentsResult.error;
  }

  const assignments = assignmentsResult.data ?? [];
  const programIds = Array.from(new Set(assignments.map((item) => item.program_id)));
  if (programIds.length === 0) {
    return { assignments, programTitleById: new Map<string, string>() };
  }

  const programsResult = await supabase
    .from("periodic_programs")
    .select("program_id,title")
    .in("program_id", programIds)
    .returns<ProgramTitleRow[]>();

  if (
    programsResult.error &&
    !isMissingTableError(programsResult.error, "periodic_programs")
  ) {
    throw programsResult.error;
  }

  return {
    assignments,
    programTitleById: new Map(
      (programsResult.data ?? []).map((program) => [program.program_id, program.title]),
    ),
  };
}

async function commitSubmittedReschedule(event: EditableCalendarEventRow): Promise<{
  unavailable: boolean;
  invalidState: boolean;
}> {
  const details = extractCalendarEventDetails(event.metadata);
  const requestId = availabilityRequestIdFromMetadata(event.metadata);
  if (
    details.eventLifecycle !== "provisory" ||
    details.proposalKind !== "reschedule" ||
    !requestId ||
    !event.source_client_program_id
  ) {
    return { unavailable: false, invalidState: true };
  }

  const supabase = getSupabaseAdminClient();
  const relatedResult = await supabase
    .from("calendar_events")
    .select(
      "event_id,client_id,source_client_program_id,event_type,starts_at,ends_at,status,metadata",
    )
    .eq("source_client_program_id", event.source_client_program_id)
    .eq("event_type", "continuous_meeting")
    .returns<RelatedCalendarEventRow[]>();

  if (relatedResult.error) {
    if (isMissingTableError(relatedResult.error, "calendar_events")) {
      return { unavailable: true, invalidState: false };
    }
    throw relatedResult.error;
  }

  const nowIso = new Date().toISOString();
  const events = relatedResult.data ?? [];
  const toCommit = events.filter((row) => {
    const rowDetails = extractCalendarEventDetails(row.metadata);
    const rowRequestId = availabilityRequestIdFromMetadata(row.metadata);
    return (
      rowDetails.eventLifecycle === "provisory" &&
      rowDetails.proposalKind === "reschedule" &&
      rowRequestId === requestId &&
      row.status !== "cancelled"
    );
  });

  if (toCommit.length === 0) {
    return { unavailable: false, invalidState: true };
  }

  for (const row of toCommit) {
    const metadata = normalizeMetadata(row.metadata);
    metadata.eventLifecycle = "committed";
    metadata.proposalKind = "reschedule";
    metadata.committedAt = nowIso;
    metadata.committedBy = "manager";

    const updateResult = await supabase
      .from("calendar_events")
      .update({
        status: "scheduled",
        metadata,
        updated_at: nowIso,
      })
      .eq("event_id", row.event_id);
    if (updateResult.error) {
      throw updateResult.error;
    }
  }

  const committedIds = new Set(toCommit.map((row) => row.event_id));
  const toCancel = events.filter((row) => {
    if (committedIds.has(row.event_id)) return false;
    if (row.status === "cancelled") return false;
    const rowDetails = extractCalendarEventDetails(row.metadata);
    return rowDetails.eventLifecycle === "committed";
  });

  if (toCancel.length > 0) {
    for (const row of toCancel) {
      const metadata = normalizeMetadata(row.metadata);
      metadata.cancelledByRescheduleRequestId = requestId;
      metadata.cancelledAt = nowIso;
      const cancelResult = await supabase
        .from("calendar_events")
        .update({
          status: "cancelled",
          metadata,
          updated_at: nowIso,
        })
        .eq("event_id", row.event_id);
      if (cancelResult.error) {
        throw cancelResult.error;
      }
    }
  }

  const selectedSlots = toCommit.map((row) => ({
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  }));
  const updateRequest = await supabase
    .from("client_program_availability_requests")
    .update({
      status: "scheduled",
      selected_slots: selectedSlots,
      submitted_at: nowIso,
      updated_at: nowIso,
    })
    .eq("request_id", requestId)
    .eq("client_program_id", event.source_client_program_id);

  if (
    updateRequest.error &&
    !isMissingTableError(updateRequest.error, "client_program_availability_requests")
  ) {
    throw updateRequest.error;
  }

  return { unavailable: false, invalidState: false };
}

export async function GET(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const surveyRows = await loadSurveyRows();
    const activePrograms = await loadActiveContinuousPrograms();
    const stored = await loadStoredCalendarEvents(getSupabaseAdminClient());
    const clientIds = Array.from(
      new Set(
        [
          ...surveyRows.map((row) => row.client_id),
          ...activePrograms.assignments.map((assignment) => assignment.client_id),
          ...stored.events.map((event) => event.clientId),
        ].filter((value): value is string => Boolean(value)),
      ),
    );
    const clientNameById = await loadClientNames(clientIds);
    const drpsEvents = withClientNames(buildDrpsCalendarEvents(surveyRows), clientNameById);
    const merged = withClientNames(
      mergeAndSortMasterCalendarEvents(drpsEvents, stored.events),
      clientNameById,
    );

    return NextResponse.json({
      events: merged,
      activeContinuousPrograms: activePrograms.assignments.map((assignment) => ({
        id: assignment.client_program_id,
        clientId: assignment.client_id,
        clientName: clientNameById.get(assignment.client_id) ?? null,
        programId: assignment.program_id,
        programTitle:
          activePrograms.programTitleById.get(assignment.program_id) ?? assignment.program_id,
        deployedAt: assignment.deployed_at ?? null,
        status: assignment.status,
      })),
      calendarEventsUnavailable: stored.unavailable,
    });
  } catch {
    return NextResponse.json({ error: "Could not load master calendar." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let parsed: z.infer<typeof createBlockedEventSchema>;
  try {
    parsed = createBlockedEventSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const timeWindow = resolveTimeWindow({
    startsAt: parsed.startsAt,
    endsAt: parsed.endsAt,
    markedAt: parsed.markedAt,
    workshopDurationMinutes: parsed.workshopDurationMinutes,
    requireComplete: true,
  });
  if (!timeWindow) {
    return NextResponse.json(
      { error: "Provide markedAt + workshopDurationMinutes or startsAt + endsAt." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdminClient();
  const insertResult = await supabase
    .from("calendar_events")
    .insert({
      event_id: randomUUID(),
      client_id: parsed.clientId ?? null,
      source_client_program_id: null,
      event_type: "blocked",
      title: parsed.title?.trim() || "Bloqueio de agenda",
      starts_at: timeWindow.startsAt,
      ends_at: timeWindow.endsAt,
      status: "scheduled",
      created_by: "manager",
      metadata: {
        content: parsed.content?.trim() || null,
        preparationRequired: parsed.preparationRequired?.trim() || null,
      },
      updated_at: new Date().toISOString(),
    })
    .select(
      "event_id,client_id,source_client_program_id,event_type,title,starts_at,ends_at,status,metadata",
    )
    .maybeSingle<EditableCalendarEventRow>();

  if (insertResult.error) {
    if (isMissingTableError(insertResult.error, "calendar_events")) {
      return NextResponse.json(
        {
          error:
            "Master calendar table unavailable. Apply migration 20260302220000_master_calendar_availability.sql.",
        },
        { status: 412 },
      );
    }
    return NextResponse.json({ error: "Could not create blocked window." }, { status: 500 });
  }

  if (!insertResult.data) {
    return NextResponse.json({ error: "Could not create blocked window." }, { status: 500 });
  }

  const clientNameById = await loadClientNames(
    insertResult.data.client_id ? [insertResult.data.client_id] : [],
  );

  return NextResponse.json({
    event: {
      id: insertResult.data.event_id,
      clientId: insertResult.data.client_id,
      clientName: insertResult.data.client_id
        ? clientNameById.get(insertResult.data.client_id) ?? null
        : null,
      eventType: insertResult.data.event_type,
      title: insertResult.data.title,
      startsAt: insertResult.data.starts_at,
      endsAt: insertResult.data.ends_at,
      status: insertResult.data.status,
      sourceClientProgramId: insertResult.data.source_client_program_id,
      details: extractCalendarEventDetails(insertResult.data.metadata),
    },
  });
}

export async function PATCH(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let parsed: z.infer<typeof updateCalendarEventSchema>;
  try {
    parsed = updateCalendarEventSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const currentResult = await supabase
    .from("calendar_events")
    .select(
      "event_id,client_id,source_client_program_id,event_type,title,starts_at,ends_at,status,metadata",
    )
    .eq("event_id", parsed.eventId)
    .maybeSingle<EditableCalendarEventRow>();

  if (currentResult.error) {
    if (isMissingTableError(currentResult.error, "calendar_events")) {
      return NextResponse.json(
        {
          error:
            "Master calendar table unavailable. Apply migration 20260302220000_master_calendar_availability.sql.",
        },
        { status: 412 },
      );
    }
    return NextResponse.json({ error: "Could not load calendar event." }, { status: 500 });
  }

  if (!currentResult.data) {
    return NextResponse.json({ error: "Calendar event not found." }, { status: 404 });
  }

  if (
    currentResult.data.event_type !== "blocked" &&
    currentResult.data.event_type !== "continuous_meeting"
  ) {
    return NextResponse.json({ error: "Only managed events can be edited." }, { status: 409 });
  }

  const timeWindow = resolveTimeWindow({
    startsAt: parsed.startsAt,
    endsAt: parsed.endsAt,
    markedAt: parsed.markedAt,
    workshopDurationMinutes: parsed.workshopDurationMinutes,
    currentStartsAt: currentResult.data.starts_at,
    currentEndsAt: currentResult.data.ends_at,
    requireComplete: true,
  });
  if (!timeWindow) {
    return NextResponse.json({ error: "Invalid time range." }, { status: 400 });
  }
  const nextStartsAt = timeWindow.startsAt;
  const nextEndsAt = timeWindow.endsAt;

  if (
    parsed.startsAt !== undefined ||
    parsed.endsAt !== undefined ||
    parsed.markedAt !== undefined ||
    parsed.workshopDurationMinutes !== undefined
  ) {
    const hasConflict = await hasMasterCalendarConflict({
      eventId: currentResult.data.event_id,
      startsAt: nextStartsAt,
      endsAt: nextEndsAt,
    });
    if (hasConflict) {
      return NextResponse.json(
        { error: "Selected date/time conflicts with another master calendar event." },
        { status: 409 },
      );
    }
  }

  const mergedMetadata = normalizeMetadata(currentResult.data.metadata);
  if (parsed.content !== undefined) {
    mergedMetadata.content = parsed.content?.trim() || null;
  }
  if (parsed.preparationRequired !== undefined) {
    mergedMetadata.preparationRequired = parsed.preparationRequired?.trim() || null;
    delete mergedMetadata.preparation_required;
  }
  if (parsed.eventLifecycle !== undefined) {
    mergedMetadata.eventLifecycle = parsed.eventLifecycle;
    if (
      parsed.eventLifecycle === "provisory" &&
      currentResult.data.event_type === "continuous_meeting" &&
      currentResult.data.source_client_program_id &&
      mergedMetadata.proposalKind !== "assignment" &&
      mergedMetadata.proposalKind !== "reschedule"
    ) {
      mergedMetadata.proposalKind = "assignment";
    }
  }

  const updatePayload = {
    ...(parsed.title !== undefined ? { title: parsed.title } : {}),
    ...(parsed.startsAt !== undefined ||
    parsed.endsAt !== undefined ||
    parsed.markedAt !== undefined ||
    parsed.workshopDurationMinutes !== undefined
      ? { starts_at: nextStartsAt, ends_at: nextEndsAt }
      : {}),
    ...(
      parsed.content !== undefined ||
      parsed.preparationRequired !== undefined ||
      parsed.eventLifecycle !== undefined
        ? { metadata: mergedMetadata }
        : {}
    ),
    updated_at: new Date().toISOString(),
  };

  const updateResult = await supabase
    .from("calendar_events")
    .update(updatePayload)
    .eq("event_id", parsed.eventId)
    .select(
      "event_id,client_id,source_client_program_id,event_type,title,starts_at,ends_at,status,metadata",
    )
    .maybeSingle<EditableCalendarEventRow>();

  if (updateResult.error) {
    return NextResponse.json({ error: "Could not update calendar event." }, { status: 500 });
  }

  if (!updateResult.data) {
    return NextResponse.json({ error: "Could not update calendar event." }, { status: 500 });
  }

  let finalEvent = updateResult.data;
  if (parsed.commitProvisoryReschedule) {
    const committed = await commitSubmittedReschedule(updateResult.data);
    if (committed.unavailable) {
      return NextResponse.json(
        {
          error:
            "Master calendar table unavailable. Apply migration 20260302220000_master_calendar_availability.sql.",
        },
        { status: 412 },
      );
    }
    if (committed.invalidState) {
      return NextResponse.json(
        { error: "Only provisory reschedule events can be committed." },
        { status: 409 },
      );
    }

    const refreshedResult = await supabase
      .from("calendar_events")
      .select(
        "event_id,client_id,source_client_program_id,event_type,title,starts_at,ends_at,status,metadata",
      )
      .eq("event_id", parsed.eventId)
      .maybeSingle<EditableCalendarEventRow>();
    if (refreshedResult.error || !refreshedResult.data) {
      return NextResponse.json({ error: "Could not refresh committed event." }, { status: 500 });
    }
    finalEvent = refreshedResult.data;
  }

  const updatedClientNameById = await loadClientNames(
    finalEvent.client_id ? [finalEvent.client_id] : [],
  );

  return NextResponse.json({
    event: {
      id: finalEvent.event_id,
      clientId: finalEvent.client_id,
      clientName: finalEvent.client_id
        ? updatedClientNameById.get(finalEvent.client_id) ?? null
        : null,
      eventType: finalEvent.event_type,
      title: finalEvent.title,
      startsAt: finalEvent.starts_at,
      endsAt: finalEvent.ends_at,
      status: finalEvent.status,
      sourceClientProgramId: finalEvent.source_client_program_id,
      details: extractCalendarEventDetails(finalEvent.metadata),
    },
  });
}

export async function DELETE(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let parsed: z.infer<typeof deleteCalendarEventSchema>;
  try {
    parsed = deleteCalendarEventSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const currentResult = await supabase
    .from("calendar_events")
    .select("event_id,event_type")
    .eq("event_id", parsed.eventId)
    .maybeSingle<Pick<EditableCalendarEventRow, "event_id" | "event_type">>();

  if (currentResult.error) {
    if (isMissingTableError(currentResult.error, "calendar_events")) {
      return NextResponse.json(
        {
          error:
            "Master calendar table unavailable. Apply migration 20260302220000_master_calendar_availability.sql.",
        },
        { status: 412 },
      );
    }
    return NextResponse.json({ error: "Could not load calendar event." }, { status: 500 });
  }

  if (!currentResult.data) {
    return NextResponse.json({ error: "Calendar event not found." }, { status: 404 });
  }

  if (
    currentResult.data.event_type !== "blocked" &&
    currentResult.data.event_type !== "continuous_meeting"
  ) {
    return NextResponse.json({ error: "Only managed events can be deleted." }, { status: 409 });
  }

  const deleteResult = await supabase
    .from("calendar_events")
    .delete()
    .eq("event_id", parsed.eventId);
  if (deleteResult.error) {
    return NextResponse.json({ error: "Could not delete calendar event." }, { status: 500 });
  }

  return NextResponse.json({ deletedEventId: parsed.eventId });
}
