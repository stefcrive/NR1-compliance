import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildSuggestedAvailabilitySlots,
  type AvailabilitySlot,
} from "@/lib/availability-scheduler";
import { isAdminApiAuthorized } from "@/lib/admin-auth";
import {
  buildDrpsCalendarEvents,
  loadStoredCalendarEvents,
  mergeAndSortMasterCalendarEvents,
  type MasterCalendarEvent,
} from "@/lib/master-calendar";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ClientRow = {
  client_id: string;
};

type PeriodicProgramRow = {
  program_id: string;
  title: string;
  description: string | null;
  target_risk_topic: number | string;
  trigger_threshold: number | string;
  schedule_frequency?: string | null;
  schedule_anchor_date?: string | null;
};

type ClientProgramRow = {
  client_program_id: string;
  program_id: string;
  status: "Recommended" | "Active" | "Completed";
  deployed_at?: string | null;
};

type ClientCampaignRow = {
  id: string;
  client_id: string | null;
  name: string;
  starts_at: string | null;
  closes_at: string | null;
};

type CalendarMeetingRow = {
  source_client_program_id: string | null;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "completed" | "cancelled";
};

const assignProgramSchema = z.object({
  programId: z.string().trim().min(1).max(120),
  status: z.enum(["Recommended", "Active", "Completed"]).optional(),
  deployedAt: z.string().datetime().optional().or(z.literal("")),
});

function mapAvailableProgram(program: PeriodicProgramRow) {
  return {
    id: program.program_id,
    title: program.title,
    description: program.description,
    targetRiskTopic: Number(program.target_risk_topic),
    triggerThreshold: Number(program.trigger_threshold),
    scheduleFrequency: program.schedule_frequency ?? "monthly",
    scheduleAnchorDate: program.schedule_anchor_date ?? null,
  };
}

function mapAssignedProgram(
  assignment: ClientProgramRow,
  programById: Map<string, PeriodicProgramRow>,
  options?: {
    cadenceSuggestedSlots?: AvailabilitySlot[];
    calendarCommittedSlots?: AvailabilitySlot[];
  },
) {
  const program = programById.get(assignment.program_id) ?? null;
  return {
    id: assignment.client_program_id,
    programId: assignment.program_id,
    programTitle: program?.title ?? assignment.program_id,
    programDescription: program?.description ?? null,
    targetRiskTopic: program ? Number(program.target_risk_topic) : null,
    triggerThreshold: program ? Number(program.trigger_threshold) : null,
    scheduleFrequency: program?.schedule_frequency ?? "monthly",
    scheduleAnchorDate: program?.schedule_anchor_date ?? null,
    status: assignment.status,
    deployedAt: assignment.deployed_at ?? null,
    cadenceSuggestedSlots: options?.cadenceSuggestedSlots ?? [],
    calendarCommittedSlots: options?.calendarCommittedSlots ?? [],
  };
}

async function loadClientOrNull(clientId: string) {
  const supabase = getSupabaseAdminClient();
  const clientResult = await supabase
    .from("clients")
    .select("client_id")
    .eq("client_id", clientId)
    .maybeSingle<ClientRow>();

  if (clientResult.error) {
    throw clientResult.error;
  }

  return clientResult.data ?? null;
}

async function loadPrograms() {
  const supabase = getSupabaseAdminClient();
  const withSchedule = await supabase
    .from("periodic_programs")
    .select(
      "program_id,title,description,target_risk_topic,trigger_threshold,schedule_frequency,schedule_anchor_date",
    )
    .order("title", { ascending: true })
    .returns<PeriodicProgramRow[]>();

  if (
    withSchedule.error &&
    isMissingColumnError(withSchedule.error, "schedule_frequency")
  ) {
    return supabase
      .from("periodic_programs")
      .select("program_id,title,description,target_risk_topic,trigger_threshold")
      .order("title", { ascending: true })
      .returns<PeriodicProgramRow[]>();
  }

  return withSchedule;
}

async function loadProgramById(programId: string) {
  const supabase = getSupabaseAdminClient();
  const withSchedule = await supabase
    .from("periodic_programs")
    .select(
      "program_id,title,description,target_risk_topic,trigger_threshold,schedule_frequency,schedule_anchor_date",
    )
    .eq("program_id", programId)
    .maybeSingle<PeriodicProgramRow>();

  if (
    withSchedule.error &&
    isMissingColumnError(withSchedule.error, "schedule_frequency")
  ) {
    return supabase
      .from("periodic_programs")
      .select("program_id,title,description,target_risk_topic,trigger_threshold")
      .eq("program_id", programId)
      .maybeSingle<PeriodicProgramRow>();
  }

  return withSchedule;
}

async function loadAssignments(clientId: string) {
  const supabase = getSupabaseAdminClient();
  const withDeployedAt = await supabase
    .from("client_programs")
    .select("client_program_id,program_id,status,deployed_at")
    .eq("client_id", clientId)
    .order("deployed_at", { ascending: false })
    .returns<ClientProgramRow[]>();

  if (withDeployedAt.error && isMissingColumnError(withDeployedAt.error, "deployed_at")) {
    const fallback = await supabase
      .from("client_programs")
      .select("client_program_id,program_id,status")
      .eq("client_id", clientId)
      .returns<ClientProgramRow[]>();
    return fallback;
  }

  return withDeployedAt;
}

async function loadClientMasterCalendarEvents(clientId: string): Promise<MasterCalendarEvent[]> {
  const supabase = getSupabaseAdminClient();
  const campaignsResult = await supabase
    .from("surveys")
    .select("id,client_id,name,starts_at,closes_at")
    .eq("client_id", clientId)
    .returns<ClientCampaignRow[]>();

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

async function loadCommittedMeetingsByAssignment(
  clientId: string,
  assignmentIds: string[],
): Promise<{ byAssignment: Map<string, AvailabilitySlot[]>; unavailable: boolean }> {
  if (assignmentIds.length === 0) {
    return { byAssignment: new Map(), unavailable: false };
  }

  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("calendar_events")
    .select("source_client_program_id,starts_at,ends_at,status")
    .eq("client_id", clientId)
    .eq("event_type", "continuous_meeting")
    .in("source_client_program_id", assignmentIds)
    .order("starts_at", { ascending: true })
    .returns<CalendarMeetingRow[]>();

  if (result.error) {
    if (isMissingTableError(result.error, "calendar_events")) {
      return { byAssignment: new Map(), unavailable: true };
    }
    throw result.error;
  }

  const byAssignment = new Map<string, AvailabilitySlot[]>();
  for (const row of result.data ?? []) {
    if (!row.source_client_program_id) continue;
    if (row.status === "cancelled") continue;
    const list = byAssignment.get(row.source_client_program_id) ?? [];
    list.push({ startsAt: row.starts_at, endsAt: row.ends_at });
    byAssignment.set(row.source_client_program_id, list);
  }
  return { byAssignment, unavailable: false };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { clientId } = await context.params;
  let client: ClientRow | null = null;
  try {
    client = await loadClientOrNull(clientId);
  } catch {
    return NextResponse.json({ error: "Could not load client." }, { status: 500 });
  }

  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const programsResult = await loadPrograms();
  if (
    programsResult.error &&
    !isMissingTableError(programsResult.error, "periodic_programs")
  ) {
    return NextResponse.json({ error: "Could not load available programs." }, { status: 500 });
  }

  const assignmentsResult = await loadAssignments(clientId);
  if (
    assignmentsResult.error &&
    !isMissingTableError(assignmentsResult.error, "client_programs")
  ) {
    return NextResponse.json({ error: "Could not load assigned programs." }, { status: 500 });
  }

  const programById = new Map((programsResult.data ?? []).map((row) => [row.program_id, row]));
  const assignments = assignmentsResult.data ?? [];

  let clientMasterCalendarEvents: MasterCalendarEvent[] = [];
  try {
    clientMasterCalendarEvents = await loadClientMasterCalendarEvents(clientId);
  } catch {
    clientMasterCalendarEvents = [];
  }

  let committedByAssignment = new Map<string, AvailabilitySlot[]>();
  try {
    const loaded = await loadCommittedMeetingsByAssignment(
      clientId,
      assignments.map((assignment) => assignment.client_program_id),
    );
    committedByAssignment = loaded.byAssignment;
  } catch {
    committedByAssignment = new Map<string, AvailabilitySlot[]>();
  }

  return NextResponse.json({
    availablePrograms: (programsResult.data ?? []).map(mapAvailableProgram),
    assignedPrograms: assignments.map((item) =>
      mapAssignedProgram(item, programById, {
        cadenceSuggestedSlots:
          item.status === "Completed"
            ? []
            : buildSuggestedAvailabilitySlots({
                deployedAt: item.deployed_at ?? new Date().toISOString(),
                scheduleFrequency:
                  programById.get(item.program_id)?.schedule_frequency ?? null,
                scheduleAnchorDate:
                  programById.get(item.program_id)?.schedule_anchor_date ?? null,
                existingEvents: clientMasterCalendarEvents.filter(
                  (event) => event.sourceClientProgramId !== item.client_program_id,
                ),
              }),
        calendarCommittedSlots:
          committedByAssignment.get(item.client_program_id) ?? [],
      }),
    ),
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { clientId } = await context.params;
  let parsed: z.infer<typeof assignProgramSchema>;
  try {
    parsed = assignProgramSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  let client: ClientRow | null = null;
  try {
    client = await loadClientOrNull(clientId);
  } catch {
    return NextResponse.json({ error: "Could not load client." }, { status: 500 });
  }

  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const supabase = getSupabaseAdminClient();
  const programResult = await loadProgramById(parsed.programId);

  if (
    programResult.error &&
    !isMissingTableError(programResult.error, "periodic_programs")
  ) {
    return NextResponse.json({ error: "Could not validate selected program." }, { status: 500 });
  }

  if (isMissingTableError(programResult.error, "periodic_programs")) {
    return NextResponse.json(
      {
        error:
          "Program database is unavailable. Apply migration 20260301173000_seed_b2b_multitenant_compliance.sql.",
      },
      { status: 412 },
    );
  }

  if (!programResult.data) {
    return NextResponse.json({ error: "Program not found." }, { status: 404 });
  }

  const existingResult = await supabase
    .from("client_programs")
    .select("client_program_id")
    .eq("client_id", clientId)
    .eq("program_id", parsed.programId)
    .maybeSingle<{ client_program_id: string }>();

  if (
    existingResult.error &&
    !isMissingTableError(existingResult.error, "client_programs")
  ) {
    return NextResponse.json({ error: "Could not validate assignment." }, { status: 500 });
  }

  if (isMissingTableError(existingResult.error, "client_programs")) {
    return NextResponse.json(
      {
        error:
          "Assignments table is unavailable. Apply migration 20260301173000_seed_b2b_multitenant_compliance.sql.",
      },
      { status: 412 },
    );
  }

  if (existingResult.data) {
    return NextResponse.json({ error: "Program is already assigned to this company." }, { status: 409 });
  }

  const insertResult = await supabase
    .from("client_programs")
    .insert({
      client_program_id: randomUUID(),
      client_id: clientId,
      program_id: parsed.programId,
      status: parsed.status ?? "Active",
      deployed_at:
        parsed.deployedAt && parsed.deployedAt.length > 0 ? parsed.deployedAt : new Date().toISOString(),
    })
    .select("client_program_id,program_id,status,deployed_at")
    .maybeSingle<ClientProgramRow>();

  if (insertResult.error) {
    if (isMissingTableError(insertResult.error, "client_programs")) {
      return NextResponse.json(
        {
          error:
            "Assignments table is unavailable. Apply migration 20260301173000_seed_b2b_multitenant_compliance.sql.",
        },
        { status: 412 },
      );
    }
    return NextResponse.json({ error: "Could not assign program." }, { status: 500 });
  }

  if (!insertResult.data) {
    return NextResponse.json({ error: "Could not assign program." }, { status: 500 });
  }

  const programById = new Map([[programResult.data.program_id, programResult.data]]);
  let cadenceSuggestedSlots: AvailabilitySlot[] = [];
  try {
    const masterEvents = await loadClientMasterCalendarEvents(clientId);
    cadenceSuggestedSlots = buildSuggestedAvailabilitySlots({
      deployedAt: insertResult.data.deployed_at ?? new Date().toISOString(),
      scheduleFrequency: programResult.data.schedule_frequency ?? null,
      scheduleAnchorDate: programResult.data.schedule_anchor_date ?? null,
      existingEvents: masterEvents,
    });
  } catch {
    cadenceSuggestedSlots = [];
  }

  return NextResponse.json(
    {
      assignment: mapAssignedProgram(insertResult.data, programById, {
        cadenceSuggestedSlots,
        calendarCommittedSlots: [],
      }),
    },
    { status: 201 },
  );
}
