import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildSuggestedAvailabilitySlots,
  type AvailabilitySlot,
} from "@/lib/availability-scheduler";
import { isAdminApiAuthorized } from "@/lib/admin-auth";
import {
  buildAssignmentSessionPlans,
  buildSequentialAnnualPlanMonths,
  normalizeAnnualPlanMonths as normalizeAnnualPlanMonthKeys,
  type AssignmentSessionPlan,
} from "@/lib/continuous-program-assignment-sessions";
import {
  CONTINUOUS_PROGRAM_MAX_SESSIONS,
  CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCIES,
  DEFAULT_CONTINUOUS_PROGRAM_METRICS,
  DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS,
  DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY,
  type ContinuousProgramMaterial,
  type ContinuousProgramMetrics,
  type ContinuousProgramSession,
  type ContinuousProgramScheduleFrequency,
  flattenContinuousProgramSessionMaterials,
  parseContinuousProgramSessions,
} from "@/lib/continuous-programs";
import {
  buildDrpsCalendarEvents,
  extractCalendarEventDetails,
  loadStoredCalendarEvents,
  mergeAndSortMasterCalendarEvents,
  type MasterCalendarEvent,
} from "@/lib/master-calendar";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type PeriodicProgramRow = {
  program_id: string;
  title: string;
  description: string | null;
  target_risk_topic: number | string;
  trigger_threshold: number | string;
  schedule_frequency?: string | null;
  schedule_anchor_date?: string | null;
  evaluation_questions?: unknown;
  materials?: unknown;
  sessions?: unknown;
  metrics?: unknown;
};

type ClientProgramStatusRow = {
  status: "Recommended" | "Active" | "Completed";
};

type ActiveClientProgramRow = {
  client_program_id: string;
  client_id: string;
  status?: "Recommended" | "Active" | "Completed";
  deployed_at?: string | null;
  schedule_frequency_override?: string | null;
  schedule_anchor_date_override?: string | null;
  annual_plan_months?: unknown;
};

type CalendarEventRow = {
  event_id: string;
  client_id: string | null;
  source_client_program_id: string | null;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "completed" | "cancelled";
  metadata?: unknown;
};

type ClientCampaignRow = {
  id: string;
  client_id: string | null;
  name: string;
  starts_at: string | null;
  closes_at: string | null;
};

type ProgramChronogramSyncContext = {
  assignments: ActiveClientProgramRow[];
  eventsByAssignment: Map<string, CalendarEventRow[]>;
  markedEventsAtRisk: number;
  assignmentsWithMarkedEvents: number;
  calendarUnavailable: boolean;
};

const programMaterialSchema: z.ZodType<ContinuousProgramMaterial> = z.object({
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(240),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().min(0).max(50 * 1024 * 1024),
  uploadedAt: z.string().datetime({ offset: true }),
  storagePath: z.string().trim().min(1).max(512),
  downloadUrl: z.string().url(),
});

const metricsSchema: z.ZodType<ContinuousProgramMetrics> = z.object({
  participationTarget: z.number().min(0).max(100),
  completionTarget: z.number().min(0).max(100),
  adherenceTarget: z.number().min(0).max(100),
  satisfactionTarget: z.number().min(1).max(5),
});

const programSessionSchema: z.ZodType<ContinuousProgramSession> = z.object({
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(5000).nullable().default(null),
  preparationRequired: z.string().trim().max(1500).nullable().default(null),
  materials: z.array(programMaterialSchema).max(80).default([]),
});

const scheduleFrequencySchema = z.enum(CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCIES);
const chronogramUpdateModeValues = ["prompt", "overwrite", "preserve"] as const;
type ChronogramUpdateMode = (typeof chronogramUpdateModeValues)[number];

const updateProgramSchema = z
  .object({
    title: z.string().trim().min(3).max(255).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    targetRiskTopic: z.number().int().min(1).max(13).optional(),
    triggerThreshold: z.number().min(1).max(3).optional(),
    scheduleFrequency: scheduleFrequencySchema.optional(),
    scheduleAnchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    evaluationQuestions: z.array(z.string().trim().min(3).max(240)).min(1).max(20).optional(),
    materials: z.array(programMaterialSchema).max(80).optional(),
    sessions: z.array(programSessionSchema).min(1).max(CONTINUOUS_PROGRAM_MAX_SESSIONS).optional(),
    metrics: metricsSchema.optional(),
    chronogramUpdateMode: z.enum(chronogramUpdateModeValues).optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== "chronogramUpdateMode"), {
    message: "At least one field must be provided.",
  });

const PROGRAM_BASE_SELECT = "program_id,title,description,target_risk_topic,trigger_threshold";
const PROGRAM_DETAILS_SELECT =
  "program_id,title,description,target_risk_topic,trigger_threshold,schedule_frequency,schedule_anchor_date,evaluation_questions,materials,sessions,metrics";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  return normalized;
}

function parseScheduleFrequency(value: unknown): ContinuousProgramScheduleFrequency {
  if (typeof value !== "string") {
    return DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY;
  }
  const result = scheduleFrequencySchema.safeParse(value.toLowerCase());
  if (!result.success) {
    return DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY;
  }
  return result.data;
}

function parseEvaluationQuestions(value: unknown): string[] {
  const parsed = z.array(z.string().trim().min(3).max(240)).max(20).safeParse(value);
  if (!parsed.success || parsed.data.length === 0) {
    return DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS;
  }
  return parsed.data;
}

function parseSessions(row: Pick<PeriodicProgramRow, "sessions" | "materials">): ContinuousProgramSession[] {
  return parseContinuousProgramSessions(row.sessions, {
    fallbackMaterials: row.materials,
    minCount: 1,
  });
}

function parseMetrics(value: unknown): ContinuousProgramMetrics {
  const parsed = metricsSchema.safeParse(value);
  if (!parsed.success) {
    return DEFAULT_CONTINUOUS_PROGRAM_METRICS;
  }
  return parsed.data;
}

function summarizeAssignments(rows: ClientProgramStatusRow[] | null | undefined) {
  const summary = {
    total: 0,
    recommended: 0,
    active: 0,
    completed: 0,
  };

  for (const row of rows ?? []) {
    summary.total += 1;
    if (row.status === "Recommended") summary.recommended += 1;
    if (row.status === "Active") summary.active += 1;
    if (row.status === "Completed") summary.completed += 1;
  }

  return summary;
}

function mapProgram(row: PeriodicProgramRow, assignments: ReturnType<typeof summarizeAssignments>) {
  const sessions = parseSessions(row);
  return {
    id: row.program_id,
    title: row.title,
    description: row.description,
    targetRiskTopic: Number(row.target_risk_topic),
    triggerThreshold: Number(row.trigger_threshold),
    scheduleFrequency: parseScheduleFrequency(row.schedule_frequency),
    scheduleAnchorDate:
      typeof row.schedule_anchor_date === "string" && row.schedule_anchor_date.length > 0
        ? row.schedule_anchor_date
        : todayIsoDate(),
    evaluationQuestions: parseEvaluationQuestions(row.evaluation_questions),
    materials: flattenContinuousProgramSessionMaterials(sessions),
    sessions,
    metrics: parseMetrics(row.metrics),
    assignments,
  };
}

function sessionSequenceFingerprint(sessions: ContinuousProgramSession[]): string {
  return sessions.map((session) => session.id.trim()).join("|");
}

function buildSessionEventContent(plan: AssignmentSessionPlan): string {
  const lines: string[] = [];
  if (plan.session.notes) {
    lines.push(plan.session.notes);
  } else {
    lines.push(
      `Sessao ${plan.sessionSequence}: ${plan.session.title} (${plan.sessionCycle}o ciclo).`,
    );
  }
  if (plan.session.materials.length > 0) {
    lines.push("");
    lines.push("Materiais da sessao:");
    for (const material of plan.session.materials) {
      lines.push(`- ${material.title}: ${material.downloadUrl}`);
    }
  }
  return lines.join("\n").trim();
}

function mapSlotsToSessionPlans(
  slots: AvailabilitySlot[],
  sessions: ContinuousProgramSession[],
): AssignmentSessionPlan[] {
  return slots.map((slot, index) => ({
    slot,
    session: sessions[index % sessions.length],
    sessionSequence: index + 1,
    sessionCycle: Math.floor(index / sessions.length) + 1,
  }));
}

function resolveCadenceForAssignment(params: {
  assignment: ActiveClientProgramRow;
  programDefaults: {
    scheduleFrequency: ContinuousProgramScheduleFrequency;
    scheduleAnchorDate: string;
  };
}) {
  return {
    scheduleFrequency: parseScheduleFrequency(
      params.assignment.schedule_frequency_override ?? params.programDefaults.scheduleFrequency,
    ),
    scheduleAnchorDate:
      parseIsoDate(
        params.assignment.schedule_anchor_date_override ?? params.programDefaults.scheduleAnchorDate,
      ) ?? todayIsoDate(),
  };
}

async function loadProgramRow(programId: string) {
  const supabase = getSupabaseAdminClient();
  const detailedResult = await supabase
    .from("periodic_programs")
    .select(PROGRAM_DETAILS_SELECT)
    .eq("program_id", programId)
    .maybeSingle<PeriodicProgramRow>();

  if (detailedResult.error && isMissingColumnError(detailedResult.error)) {
    const baseResult = await supabase
      .from("periodic_programs")
      .select(PROGRAM_BASE_SELECT)
      .eq("program_id", programId)
      .maybeSingle<PeriodicProgramRow>();
    return { result: baseResult, hasDetailColumns: false };
  }

  return { result: detailedResult, hasDetailColumns: true };
}

async function loadActiveAssignmentsForProgram(programId: string): Promise<{
  assignments: ActiveClientProgramRow[];
  unavailable: boolean;
}> {
  const supabase = getSupabaseAdminClient();
  const withAnnual = await supabase
    .from("client_programs")
    .select(
      "client_program_id,client_id,status,deployed_at,schedule_frequency_override,schedule_anchor_date_override,annual_plan_months",
    )
    .eq("program_id", programId)
    .eq("status", "Active")
    .returns<ActiveClientProgramRow[]>();

  if (!withAnnual.error) {
    return { assignments: withAnnual.data ?? [], unavailable: false };
  }
  if (isMissingTableError(withAnnual.error, "client_programs")) {
    return { assignments: [], unavailable: true };
  }
  if (!isMissingColumnError(withAnnual.error, "annual_plan_months")) {
    throw withAnnual.error;
  }

  const withOverrides = await supabase
    .from("client_programs")
    .select(
      "client_program_id,client_id,status,deployed_at,schedule_frequency_override,schedule_anchor_date_override",
    )
    .eq("program_id", programId)
    .eq("status", "Active")
    .returns<ActiveClientProgramRow[]>();

  if (!withOverrides.error) {
    return { assignments: withOverrides.data ?? [], unavailable: false };
  }
  if (!isMissingColumnError(withOverrides.error, "schedule_frequency_override")) {
    throw withOverrides.error;
  }

  const withoutOverrides = await supabase
    .from("client_programs")
    .select("client_program_id,client_id,status,deployed_at")
    .eq("program_id", programId)
    .eq("status", "Active")
    .returns<ActiveClientProgramRow[]>();

  if (!withoutOverrides.error) {
    return { assignments: withoutOverrides.data ?? [], unavailable: false };
  }
  if (!isMissingColumnError(withoutOverrides.error, "deployed_at")) {
    throw withoutOverrides.error;
  }

  const fallback = await supabase
    .from("client_programs")
    .select("client_program_id,client_id,status")
    .eq("program_id", programId)
    .eq("status", "Active")
    .returns<ActiveClientProgramRow[]>();

  if (fallback.error) {
    throw fallback.error;
  }
  return { assignments: fallback.data ?? [], unavailable: false };
}

async function loadCalendarEventsByAssignment(assignmentIds: string[]): Promise<{
  eventsByAssignment: Map<string, CalendarEventRow[]>;
  unavailable: boolean;
}> {
  if (assignmentIds.length === 0) {
    return { eventsByAssignment: new Map(), unavailable: false };
  }

  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("calendar_events")
    .select("event_id,client_id,source_client_program_id,starts_at,ends_at,status,metadata")
    .eq("event_type", "continuous_meeting")
    .in("source_client_program_id", assignmentIds)
    .order("starts_at", { ascending: true })
    .returns<CalendarEventRow[]>();

  if (result.error) {
    if (isMissingTableError(result.error, "calendar_events")) {
      return { eventsByAssignment: new Map(), unavailable: true };
    }
    throw result.error;
  }

  const grouped = new Map<string, CalendarEventRow[]>();
  for (const row of result.data ?? []) {
    if (!row.source_client_program_id) continue;
    const list = grouped.get(row.source_client_program_id) ?? [];
    list.push(row);
    grouped.set(row.source_client_program_id, list);
  }

  return { eventsByAssignment: grouped, unavailable: false };
}

function countMarkedEvents(
  assignments: ActiveClientProgramRow[],
  eventsByAssignment: Map<string, CalendarEventRow[]>,
): { markedEventsAtRisk: number; assignmentsWithMarkedEvents: number } {
  let markedEventsAtRisk = 0;
  let assignmentsWithMarkedEvents = 0;
  for (const assignment of assignments) {
    const rows = eventsByAssignment.get(assignment.client_program_id) ?? [];
    const count = rows.filter((row) => {
      if (row.status !== "scheduled") return false;
      const details = extractCalendarEventDetails(row.metadata);
      return details.eventLifecycle === "committed";
    }).length;
    if (count > 0) {
      markedEventsAtRisk += count;
      assignmentsWithMarkedEvents += 1;
    }
  }
  return { markedEventsAtRisk, assignmentsWithMarkedEvents };
}

async function prepareProgramChronogramSyncContext(programId: string): Promise<ProgramChronogramSyncContext> {
  const loadedAssignments = await loadActiveAssignmentsForProgram(programId);
  if (loadedAssignments.unavailable || loadedAssignments.assignments.length === 0) {
    return {
      assignments: [],
      eventsByAssignment: new Map(),
      markedEventsAtRisk: 0,
      assignmentsWithMarkedEvents: 0,
      calendarUnavailable: false,
    };
  }

  const loadedEvents = await loadCalendarEventsByAssignment(
    loadedAssignments.assignments.map((item) => item.client_program_id),
  );
  const counts = countMarkedEvents(loadedAssignments.assignments, loadedEvents.eventsByAssignment);

  return {
    assignments: loadedAssignments.assignments,
    eventsByAssignment: loadedEvents.eventsByAssignment,
    markedEventsAtRisk: counts.markedEventsAtRisk,
    assignmentsWithMarkedEvents: counts.assignmentsWithMarkedEvents,
    calendarUnavailable: loadedEvents.unavailable,
  };
}

function shouldDeleteEventForSync(row: CalendarEventRow, mode: Exclude<ChronogramUpdateMode, "prompt">): boolean {
  if (row.status !== "scheduled") return false;
  const details = extractCalendarEventDetails(row.metadata);
  if (mode === "overwrite") {
    return details.eventLifecycle === "committed" || details.proposalKind === "assignment";
  }
  return details.eventLifecycle === "provisory" && details.proposalKind === "assignment";
}

async function loadManagerMasterCalendarEvents(): Promise<MasterCalendarEvent[]> {
  const supabase = getSupabaseAdminClient();
  const campaignsResult = await supabase
    .from("surveys")
    .select("id,client_id,name,starts_at,closes_at")
    .returns<ClientCampaignRow[]>();

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

async function applyProgramSessionChronogramSync(params: {
  context: ProgramChronogramSyncContext;
  mode: Exclude<ChronogramUpdateMode, "prompt">;
  sessions: ContinuousProgramSession[];
  programTitle: string;
  programDefaults: {
    scheduleFrequency: ContinuousProgramScheduleFrequency;
    scheduleAnchorDate: string;
  };
}) {
  if (params.context.assignments.length === 0) {
    return {
      mode: params.mode,
      assignmentsTouched: 0,
      markedEventsAtRisk: 0,
      markedEventsOverwritten: 0,
      markedEventsPreserved: 0,
      deletedEvents: 0,
      createdEvents: 0,
      calendarUnavailable: false,
    };
  }

  if (params.context.calendarUnavailable) {
    return {
      mode: params.mode,
      assignmentsTouched: params.context.assignments.length,
      markedEventsAtRisk: params.context.markedEventsAtRisk,
      markedEventsOverwritten: 0,
      markedEventsPreserved: 0,
      deletedEvents: 0,
      createdEvents: 0,
      calendarUnavailable: true,
    };
  }

  const deletedEventIds = new Set<string>();
  for (const assignment of params.context.assignments) {
    const rows = params.context.eventsByAssignment.get(assignment.client_program_id) ?? [];
    for (const row of rows) {
      if (shouldDeleteEventForSync(row, params.mode)) {
        deletedEventIds.add(row.event_id);
      }
    }
  }

  const masterEvents = await loadManagerMasterCalendarEvents();
  const rollingEvents = masterEvents.filter((event) => !deletedEventIds.has(event.id));

  const insertedEvents: Array<Record<string, unknown>> = [];
  const nowIso = new Date().toISOString();
  for (const assignment of params.context.assignments) {
    const cadence = resolveCadenceForAssignment({
      assignment,
      programDefaults: params.programDefaults,
    });
    const configuredMonths = normalizeAnnualPlanMonthKeys(assignment.annual_plan_months);
    const effectiveMonths =
      configuredMonths.length > 0
        ? configuredMonths
        : buildSequentialAnnualPlanMonths({
            deployedAt: assignment.deployed_at,
            monthCount: Math.max(params.sessions.length, 1),
          });

    let plans = buildAssignmentSessionPlans({
      annualPlanMonths: effectiveMonths,
      deployedAt: assignment.deployed_at ?? null,
      sessions: params.sessions,
      existingEvents: rollingEvents,
    });

    if (plans.length === 0) {
      const fallbackSlots = buildSuggestedAvailabilitySlots({
        deployedAt: assignment.deployed_at ?? new Date().toISOString(),
        scheduleFrequency: cadence.scheduleFrequency,
        scheduleAnchorDate: cadence.scheduleAnchorDate,
        existingEvents: rollingEvents,
        maxSlots: Math.max(params.sessions.length, 1),
        enforceCadenceSeries: true,
      });
      plans = mapSlotsToSessionPlans(fallbackSlots, params.sessions);
    }

    for (const plan of plans) {
      const eventId = randomUUID();
      insertedEvents.push({
        event_id: eventId,
        client_id: assignment.client_id,
        source_client_program_id: assignment.client_program_id,
        event_type: "continuous_meeting",
        title: `Reuniao processo continuo: ${params.programTitle} | Sessao ${plan.sessionSequence}`,
        starts_at: plan.slot.startsAt,
        ends_at: plan.slot.endsAt,
        status: "scheduled",
        created_by: "manager",
        metadata: {
          source: "manager_program_sessions_sync",
          eventLifecycle: "provisory",
          proposalKind: "assignment",
          sessionId: plan.session.id,
          sessionIndex: plan.sessionSequence,
          sessionTitle: plan.session.title,
          sessionCycle: plan.sessionCycle,
          sessionMaterials: plan.session.materials,
          content: buildSessionEventContent(plan),
          preparationRequired:
            plan.session.preparationRequired ??
            "Revisar indicadores recentes e alinhar proximos passos.",
        },
        updated_at: nowIso,
      });

      rollingEvents.push({
        id: `planned-${eventId}`,
        clientId: assignment.client_id,
        clientName: null,
        eventType: "continuous_meeting",
        title: `Reuniao processo continuo: ${params.programTitle} | Sessao ${plan.sessionSequence}`,
        startsAt: plan.slot.startsAt,
        endsAt: plan.slot.endsAt,
        status: "scheduled",
        sourceClientProgramId: assignment.client_program_id,
        details: {
          content: null,
          preparationRequired: null,
          eventLifecycle: "provisory",
          proposalKind: "assignment",
          availabilityRequestId: null,
          sessionId: plan.session.id,
          sessionIndex: plan.sessionSequence,
          sessionTitle: plan.session.title,
          sessionMaterials: plan.session.materials,
        },
      });
    }
  }

  const supabase = getSupabaseAdminClient();
  if (deletedEventIds.size > 0) {
    const allIds = Array.from(deletedEventIds.values());
    for (let offset = 0; offset < allIds.length; offset += 200) {
      const batch = allIds.slice(offset, offset + 200);
      const result = await supabase.from("calendar_events").delete().in("event_id", batch);
      if (result.error) {
        throw result.error;
      }
    }
  }

  if (insertedEvents.length > 0) {
    for (let offset = 0; offset < insertedEvents.length; offset += 100) {
      const batch = insertedEvents.slice(offset, offset + 100);
      const result = await supabase.from("calendar_events").insert(batch);
      if (result.error) {
        throw result.error;
      }
    }
  }

  return {
    mode: params.mode,
    assignmentsTouched: params.context.assignments.length,
    markedEventsAtRisk: params.context.markedEventsAtRisk,
    markedEventsOverwritten: params.mode === "overwrite" ? params.context.markedEventsAtRisk : 0,
    markedEventsPreserved: params.mode === "preserve" ? params.context.markedEventsAtRisk : 0,
    deletedEvents: deletedEventIds.size,
    createdEvents: insertedEvents.length,
    calendarUnavailable: false,
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ programId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { programId } = await context.params;
  const supabase = getSupabaseAdminClient();
  const { result: periodicResult } = await loadProgramRow(programId);

  if (
    periodicResult.error &&
    !isMissingTableError(periodicResult.error, "periodic_programs")
  ) {
    return NextResponse.json({ error: "Could not load continuous program." }, { status: 500 });
  }

  if (!periodicResult.data) {
    return NextResponse.json({ error: "Continuous program not found." }, { status: 404 });
  }

  const assignmentsResult = await supabase
    .from("client_programs")
    .select("status")
    .eq("program_id", programId)
    .returns<ClientProgramStatusRow[]>();

  if (
    assignmentsResult.error &&
    !isMissingTableError(assignmentsResult.error, "client_programs")
  ) {
    return NextResponse.json({ error: "Could not load continuous program." }, { status: 500 });
  }

  return NextResponse.json({
    program: mapProgram(periodicResult.data, summarizeAssignments(assignmentsResult.data)),
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ programId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { programId } = await context.params;
  let parsed: z.infer<typeof updateProgramSchema>;
  try {
    parsed = updateProgramSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const currentProgramLoaded = await loadProgramRow(programId);
  if (
    currentProgramLoaded.result.error &&
    !isMissingTableError(currentProgramLoaded.result.error, "periodic_programs")
  ) {
    return NextResponse.json({ error: "Could not update continuous program." }, { status: 500 });
  }
  if (!currentProgramLoaded.result.data) {
    return NextResponse.json({ error: "Continuous program not found." }, { status: 404 });
  }

  const currentProgram = currentProgramLoaded.result.data;
  const normalizedSessions =
    parsed.sessions !== undefined
      ? parseContinuousProgramSessions(parsed.sessions, {
          fallbackMaterials: parsed.materials,
          minCount: 1,
        })
      : undefined;
  const currentSessions = parseSessions(currentProgram);
  const sessionsSequenceChanged =
    normalizedSessions !== undefined &&
    sessionSequenceFingerprint(normalizedSessions) !== sessionSequenceFingerprint(currentSessions);

  const requestedChronogramMode: ChronogramUpdateMode = parsed.chronogramUpdateMode ?? "prompt";
  let syncContext: ProgramChronogramSyncContext | null = null;
  if (sessionsSequenceChanged) {
    try {
      syncContext = await prepareProgramChronogramSyncContext(programId);
    } catch {
      return NextResponse.json({ error: "Could not validate chronogram changes." }, { status: 500 });
    }

    if (requestedChronogramMode === "prompt" && syncContext.markedEventsAtRisk > 0) {
      return NextResponse.json(
        {
          error:
            "Updating the session sequence requires replacing scheduled marked events in active assignments. Choose overwrite or preserve mode.",
          errorCode: "scheduled_event_overwrite_confirmation_required",
          requiresChronogramDecision: true,
          conflict: {
            assignmentsAffected: syncContext.assignmentsWithMarkedEvents,
            markedEventsAtRisk: syncContext.markedEventsAtRisk,
          },
        },
        { status: 409 },
      );
    }
  }

  const payload = {
    ...(parsed.title !== undefined ? { title: parsed.title } : {}),
    ...(parsed.description !== undefined
      ? { description: parsed.description && parsed.description.length > 0 ? parsed.description : null }
      : {}),
    ...(parsed.targetRiskTopic !== undefined ? { target_risk_topic: parsed.targetRiskTopic } : {}),
    ...(parsed.triggerThreshold !== undefined
      ? { trigger_threshold: Number(parsed.triggerThreshold.toFixed(2)) }
      : {}),
    ...(parsed.scheduleFrequency !== undefined
      ? { schedule_frequency: parsed.scheduleFrequency }
      : {}),
    ...(parsed.scheduleAnchorDate !== undefined
      ? { schedule_anchor_date: parsed.scheduleAnchorDate }
      : {}),
    ...(parsed.evaluationQuestions !== undefined
      ? { evaluation_questions: parsed.evaluationQuestions }
      : {}),
    ...(parsed.materials !== undefined ? { materials: parsed.materials } : {}),
    ...(normalizedSessions !== undefined
      ? {
          sessions: normalizedSessions,
          materials: flattenContinuousProgramSessionMaterials(normalizedSessions),
        }
      : {}),
    ...(parsed.metrics !== undefined ? { metrics: parsed.metrics } : {}),
  };

  const basePayload = {
    ...(parsed.title !== undefined ? { title: parsed.title } : {}),
    ...(parsed.description !== undefined
      ? { description: parsed.description && parsed.description.length > 0 ? parsed.description : null }
      : {}),
    ...(parsed.targetRiskTopic !== undefined ? { target_risk_topic: parsed.targetRiskTopic } : {}),
    ...(parsed.triggerThreshold !== undefined
      ? { trigger_threshold: Number(parsed.triggerThreshold.toFixed(2)) }
      : {}),
  };

  const supabase = getSupabaseAdminClient();
  const detailedUpdateResult = await supabase
    .from("periodic_programs")
    .update(payload)
    .eq("program_id", programId)
    .select(PROGRAM_DETAILS_SELECT)
    .maybeSingle<PeriodicProgramRow>();

  const usesDetailFields =
    parsed.scheduleFrequency !== undefined ||
    parsed.scheduleAnchorDate !== undefined ||
    parsed.evaluationQuestions !== undefined ||
    parsed.materials !== undefined ||
    parsed.sessions !== undefined ||
    parsed.metrics !== undefined;

  if (
    detailedUpdateResult.error &&
    isMissingColumnError(detailedUpdateResult.error) &&
    usesDetailFields
  ) {
    return NextResponse.json(
      {
        error:
          "This database schema does not support sessions/materials, frequency, questionnaire, or metrics yet. Apply migrations 20260302190000_continuous_program_details.sql and 20260307090000_continuous_program_sessions.sql.",
      },
      { status: 409 },
    );
  }

  const updateResult =
    detailedUpdateResult.error && isMissingColumnError(detailedUpdateResult.error)
      ? await supabase
          .from("periodic_programs")
          .update(basePayload)
          .eq("program_id", programId)
          .select(PROGRAM_BASE_SELECT)
          .maybeSingle<PeriodicProgramRow>()
      : detailedUpdateResult;

  if (
    updateResult.error &&
    !isMissingTableError(updateResult.error, "periodic_programs")
  ) {
    return NextResponse.json({ error: "Could not update continuous program." }, { status: 500 });
  }

  if (!updateResult.data) {
    return NextResponse.json({ error: "Continuous program not found." }, { status: 404 });
  }

  let chronogramUpdate: Awaited<ReturnType<typeof applyProgramSessionChronogramSync>> | null = null;
  if (sessionsSequenceChanged && normalizedSessions && syncContext) {
    const effectiveMode: Exclude<ChronogramUpdateMode, "prompt"> =
      requestedChronogramMode === "preserve" ? "preserve" : "overwrite";
    try {
      chronogramUpdate = await applyProgramSessionChronogramSync({
        context: syncContext,
        mode: effectiveMode,
        sessions: normalizedSessions,
        programTitle: updateResult.data.title,
        programDefaults: {
          scheduleFrequency: parseScheduleFrequency(updateResult.data.schedule_frequency),
          scheduleAnchorDate:
            parseIsoDate(updateResult.data.schedule_anchor_date) ?? todayIsoDate(),
        },
      });
    } catch {
      return NextResponse.json({ error: "Could not refresh assignment chronograms." }, { status: 500 });
    }
  }

  const assignmentsResult = await supabase
    .from("client_programs")
    .select("status")
    .eq("program_id", programId)
    .returns<ClientProgramStatusRow[]>();

  if (
    assignmentsResult.error &&
    !isMissingTableError(assignmentsResult.error, "client_programs")
  ) {
    return NextResponse.json({ error: "Could not update continuous program." }, { status: 500 });
  }

  return NextResponse.json({
    program: mapProgram(updateResult.data, summarizeAssignments(assignmentsResult.data)),
    chronogramUpdate,
  });
}
