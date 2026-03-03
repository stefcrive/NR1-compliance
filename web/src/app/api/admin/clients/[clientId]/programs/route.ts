import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { buildSuggestedAvailabilitySlots } from "@/lib/availability-scheduler";
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

async function createAvailabilityRequestForAssignment(
  clientId: string,
  assignment: ClientProgramRow,
  program: PeriodicProgramRow,
) {
  if (assignment.status === "Completed") {
    return { created: false, reason: "completed" as const };
  }

  const deployedAt = assignment.deployed_at ?? new Date().toISOString();
  const events = await loadClientMasterCalendarEvents(clientId);
  const suggestedSlots = buildSuggestedAvailabilitySlots({
    deployedAt,
    scheduleFrequency: program.schedule_frequency ?? null,
    scheduleAnchorDate: program.schedule_anchor_date ?? null,
    existingEvents: events,
  });

  const dueAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const supabase = getSupabaseAdminClient();
  const insertResult = await supabase
    .from("client_program_availability_requests")
    .insert({
      request_id: randomUUID(),
      client_id: clientId,
      client_program_id: assignment.client_program_id,
      status: "pending",
      requested_at: new Date().toISOString(),
      due_at: dueAt,
      suggested_slots: suggestedSlots,
      selected_slots: [],
    })
    .select("request_id,status,due_at")
    .maybeSingle<{ request_id: string; status: string; due_at: string | null }>();

  if (insertResult.error) {
    if (
      isMissingTableError(insertResult.error, "client_program_availability_requests")
    ) {
      return { created: false, reason: "unavailable" as const };
    }

    if (insertResult.error.code === "23505") {
      return { created: false, reason: "exists" as const };
    }

    throw insertResult.error;
  }

  if (!insertResult.data) {
    return { created: false, reason: "unknown" as const };
  }

  return {
    created: true,
    request: {
      id: insertResult.data.request_id,
      status: insertResult.data.status,
      dueAt: insertResult.data.due_at,
      suggestedSlots,
    },
  };
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

  return NextResponse.json({
    availablePrograms: (programsResult.data ?? []).map(mapAvailableProgram),
    assignedPrograms: (assignmentsResult.data ?? []).map((item) =>
      mapAssignedProgram(item, programById),
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

  let availabilityRequest: Awaited<ReturnType<typeof createAvailabilityRequestForAssignment>> | null =
    null;
  try {
    availabilityRequest = await createAvailabilityRequestForAssignment(
      clientId,
      insertResult.data,
      programResult.data,
    );
  } catch {
    availabilityRequest = null;
  }

  const programById = new Map([[programResult.data.program_id, programResult.data]]);
  return NextResponse.json(
    {
      assignment: mapAssignedProgram(insertResult.data, programById),
      availabilityRequest,
    },
    { status: 201 },
  );
}
