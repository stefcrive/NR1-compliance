import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import {
  buildDrpsCalendarEvents,
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

const createBlockedEventSchema = z
  .object({
    eventType: z.literal("blocked").optional(),
    clientId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(3).max(160).optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })
  .refine((value) => new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(), {
    message: "Invalid time range.",
    path: ["endsAt"],
  });

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
    .eq("status", "Active")
    .returns<ActiveClientProgramRow[]>();

  const assignmentsResult =
    withDeployedAt.error && isMissingColumnError(withDeployedAt.error, "deployed_at")
      ? await supabase
          .from("client_programs")
          .select("client_program_id,client_id,program_id,status")
          .eq("status", "Active")
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

export async function GET(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const surveyRows = await loadSurveyRows();
    const activePrograms = await loadActiveContinuousPrograms();
    const clientIds = Array.from(
      new Set(
        [
          ...surveyRows.map((row) => row.client_id),
          ...activePrograms.assignments.map((assignment) => assignment.client_id),
        ].filter((value): value is string => Boolean(value)),
      ),
    );
    const clientNameById = await loadClientNames(clientIds);
    const drpsEvents = withClientNames(buildDrpsCalendarEvents(surveyRows), clientNameById);
    const stored = await loadStoredCalendarEvents(getSupabaseAdminClient());
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

  const supabase = getSupabaseAdminClient();
  const insertResult = await supabase
    .from("calendar_events")
    .insert({
      event_id: randomUUID(),
      client_id: parsed.clientId ?? null,
      source_client_program_id: null,
      event_type: "blocked",
      title: parsed.title?.trim() || "Bloqueio de agenda",
      starts_at: parsed.startsAt,
      ends_at: parsed.endsAt,
      status: "scheduled",
      created_by: "manager",
      metadata: {},
      updated_at: new Date().toISOString(),
    })
    .select(
      "event_id,client_id,source_client_program_id,event_type,title,starts_at,ends_at,status",
    )
    .maybeSingle<{
      event_id: string;
      client_id: string | null;
      source_client_program_id: string | null;
      event_type: "continuous_meeting" | "blocked";
      title: string;
      starts_at: string;
      ends_at: string;
      status: "scheduled" | "completed" | "cancelled";
    }>();

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

  return NextResponse.json({
    event: {
      id: insertResult.data.event_id,
      clientId: insertResult.data.client_id,
      clientName: null,
      eventType: insertResult.data.event_type,
      title: insertResult.data.title,
      startsAt: insertResult.data.starts_at,
      endsAt: insertResult.data.ends_at,
      status: insertResult.data.status,
      sourceClientProgramId: insertResult.data.source_client_program_id,
    },
  });
}
