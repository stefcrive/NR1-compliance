import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildSuggestedAvailabilitySlots,
  DEFAULT_ASSIGNMENT_CADENCE_SLOT_COUNT,
  type AvailabilitySlot,
} from "@/lib/availability-scheduler";
import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { createClientNotification } from "@/lib/client-notifications";
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

type ClientRow = {
  client_id: string;
  company_name: string;
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
  schedule_frequency_override?: string | null;
  schedule_anchor_date_override?: string | null;
  annual_plan_months?: unknown;
};

type ClientCampaignRow = {
  id: string;
  client_id: string | null;
  name: string;
  starts_at: string | null;
  closes_at: string | null;
};

type CalendarMeetingRow = {
  event_id: string;
  source_client_program_id: string | null;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "completed" | "cancelled";
  metadata?: unknown;
};

type AssignmentCalendarEvent = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "completed" | "cancelled";
  lifecycle: "provisory" | "committed";
  proposalKind: "assignment" | "reschedule" | null;
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

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function toMonthKey(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function parseScheduleFrequency(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY;
  const normalized = value.trim().toLowerCase();
  if (
    cadenceFrequencyValues.includes(
      normalized as (typeof cadenceFrequencyValues)[number],
    )
  ) {
    return normalized;
  }
  return DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY;
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  return normalized;
}

function resolveCadenceValues(params: {
  assignment: ClientProgramRow;
  program: PeriodicProgramRow | null;
}): { scheduleFrequency: string; scheduleAnchorDate: string } {
  const scheduleFrequency = parseScheduleFrequency(
    params.assignment.schedule_frequency_override ?? params.program?.schedule_frequency,
  );
  const scheduleAnchorDate =
    parseIsoDate(
      params.assignment.schedule_anchor_date_override ?? params.program?.schedule_anchor_date,
    ) ?? todayIsoDate();
  return { scheduleFrequency, scheduleAnchorDate };
}

const assignProgramSchema = z.object({
  programId: z.string().trim().min(1).max(120),
  status: z.enum(["Recommended", "Active", "Completed"]).optional(),
  deployedAt: z.string().datetime().optional().or(z.literal("")),
  scheduleFrequency: z.enum(cadenceFrequencyValues).optional(),
  scheduleAnchorDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  annualPlanMonths: z.array(z.string().regex(annualPlanMonthRegex)).max(12).optional(),
});

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

function deriveAnnualPlanMonthsFromSlots(slots: AvailabilitySlot[]): string[] {
  const monthKeys = new Set<string>();
  for (const slot of slots) {
    const date = new Date(slot.startsAt);
    if (Number.isNaN(date.getTime())) continue;
    monthKeys.add(toMonthKey(date));
  }
  return normalizeAnnualPlanMonths(Array.from(monthKeys.values()));
}

function mapAvailableProgram(program: PeriodicProgramRow) {
  return {
    id: program.program_id,
    title: program.title,
    description: program.description,
    targetRiskTopic: Number(program.target_risk_topic),
    triggerThreshold: Number(program.trigger_threshold),
    scheduleFrequency: parseScheduleFrequency(program.schedule_frequency),
    scheduleAnchorDate: parseIsoDate(program.schedule_anchor_date) ?? todayIsoDate(),
  };
}

function mapAssignedProgram(
  assignment: ClientProgramRow,
  programById: Map<string, PeriodicProgramRow>,
  options?: {
    cadenceSuggestedSlots?: AvailabilitySlot[];
    calendarProvisorySlots?: AvailabilitySlot[];
    calendarCommittedSlots?: AvailabilitySlot[];
    calendarTimelineEvents?: AssignmentCalendarEvent[];
  },
) {
  const program = programById.get(assignment.program_id) ?? null;
  const cadence = resolveCadenceValues({ assignment, program });
  return {
    id: assignment.client_program_id,
    programId: assignment.program_id,
    programTitle: program?.title ?? assignment.program_id,
    programDescription: program?.description ?? null,
    targetRiskTopic: program ? Number(program.target_risk_topic) : null,
    triggerThreshold: program ? Number(program.trigger_threshold) : null,
    scheduleFrequency: cadence.scheduleFrequency,
    scheduleAnchorDate: cadence.scheduleAnchorDate,
    status: assignment.status,
    deployedAt: assignment.deployed_at ?? null,
    annualPlanMonths: normalizeAnnualPlanMonths(assignment.annual_plan_months),
    cadenceSuggestedSlots: options?.cadenceSuggestedSlots ?? [],
    calendarProvisorySlots: options?.calendarProvisorySlots ?? [],
    calendarCommittedSlots: options?.calendarCommittedSlots ?? [],
    calendarTimelineEvents: options?.calendarTimelineEvents ?? [],
  };
}

async function loadClientOrNull(clientId: string) {
  const supabase = getSupabaseAdminClient();
  const clientResult = await supabase
    .from("clients")
    .select("client_id,company_name")
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

async function loadAssignments(clientId: string): Promise<{
  data: ClientProgramRow[] | null;
  error: { code?: string | null; message?: string | null } | null;
  annualPlanSupported: boolean;
}> {
  const supabase = getSupabaseAdminClient();
  const withAnnualAndOverrides = await supabase
    .from("client_programs")
    .select(
      "client_program_id,program_id,status,deployed_at,schedule_frequency_override,schedule_anchor_date_override,annual_plan_months",
    )
    .eq("client_id", clientId)
    .order("deployed_at", { ascending: false })
    .returns<ClientProgramRow[]>();

  if (!withAnnualAndOverrides.error) {
    return {
      data: withAnnualAndOverrides.data ?? [],
      error: null,
      annualPlanSupported: true,
    };
  }

  if (!isMissingColumnError(withAnnualAndOverrides.error)) {
    return {
      data: withAnnualAndOverrides.data ?? null,
      error: withAnnualAndOverrides.error,
      annualPlanSupported: false,
    };
  }

  const withOverrides = await supabase
    .from("client_programs")
    .select(
      "client_program_id,program_id,status,deployed_at,schedule_frequency_override,schedule_anchor_date_override",
    )
    .eq("client_id", clientId)
    .order("deployed_at", { ascending: false })
    .returns<ClientProgramRow[]>();

  if (!withOverrides.error) {
    return { data: withOverrides.data ?? [], error: null, annualPlanSupported: false };
  }

  if (!isMissingColumnError(withOverrides.error, "schedule_frequency_override")) {
    return {
      data: withOverrides.data ?? null,
      error: withOverrides.error,
      annualPlanSupported: false,
    };
  }

  const withoutOverrides = await supabase
    .from("client_programs")
    .select("client_program_id,program_id,status,deployed_at")
    .eq("client_id", clientId)
    .order("deployed_at", { ascending: false })
    .returns<ClientProgramRow[]>();

  if (withoutOverrides.error && isMissingColumnError(withoutOverrides.error, "deployed_at")) {
    const fallback = await supabase
      .from("client_programs")
      .select("client_program_id,program_id,status")
      .eq("client_id", clientId)
      .returns<ClientProgramRow[]>();
    return {
      data: fallback.data ?? null,
      error: fallback.error,
      annualPlanSupported: false,
    };
  }

  return {
    data: withoutOverrides.data ?? null,
    error: withoutOverrides.error,
    annualPlanSupported: false,
  };
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

async function loadCommittedMeetingsByAssignment(
  clientId: string,
  assignmentIds: string[],
): Promise<{
  committedByAssignment: Map<string, AvailabilitySlot[]>;
  provisoryByAssignment: Map<string, AvailabilitySlot[]>;
  timelineByAssignment: Map<string, AssignmentCalendarEvent[]>;
  unavailable: boolean;
}> {
  if (assignmentIds.length === 0) {
    return {
      committedByAssignment: new Map(),
      provisoryByAssignment: new Map(),
      timelineByAssignment: new Map(),
      unavailable: false,
    };
  }

  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("calendar_events")
    .select("event_id,source_client_program_id,starts_at,ends_at,status,metadata")
    .eq("client_id", clientId)
    .eq("event_type", "continuous_meeting")
    .in("source_client_program_id", assignmentIds)
    .order("starts_at", { ascending: true })
    .returns<CalendarMeetingRow[]>();

  if (result.error) {
    if (isMissingTableError(result.error, "calendar_events")) {
      return {
        committedByAssignment: new Map(),
        provisoryByAssignment: new Map(),
        timelineByAssignment: new Map(),
        unavailable: true,
      };
    }
    throw result.error;
  }

  const committedByAssignment = new Map<string, AvailabilitySlot[]>();
  const provisoryByAssignment = new Map<string, AvailabilitySlot[]>();
  const timelineByAssignment = new Map<string, AssignmentCalendarEvent[]>();
  for (const row of result.data ?? []) {
    if (!row.source_client_program_id) continue;
    const details = extractCalendarEventDetails(row.metadata);
    const timeline = timelineByAssignment.get(row.source_client_program_id) ?? [];
    timeline.push({
      id: row.event_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      lifecycle: details.eventLifecycle,
      proposalKind: details.proposalKind,
    });
    timelineByAssignment.set(row.source_client_program_id, timeline);
    if (row.status === "cancelled") continue;
    const targetMap =
      details.eventLifecycle === "provisory" ? provisoryByAssignment : committedByAssignment;
    const list = targetMap.get(row.source_client_program_id) ?? [];
    list.push({ startsAt: row.starts_at, endsAt: row.ends_at });
    targetMap.set(row.source_client_program_id, list);
  }
  for (const [assignmentId, timeline] of timelineByAssignment.entries()) {
    timelineByAssignment.set(
      assignmentId,
      timeline.slice().sort((left, right) => {
        const leftTime = new Date(left.startsAt).getTime();
        const rightTime = new Date(right.startsAt).getTime();
        return leftTime - rightTime;
      }),
    );
  }
  return { committedByAssignment, provisoryByAssignment, timelineByAssignment, unavailable: false };
}

function resolveCadenceForAssignment(
  assignment: ClientProgramRow,
  programById: Map<string, PeriodicProgramRow>,
): { scheduleFrequency: string; scheduleAnchorDate: string | null } {
  const program = programById.get(assignment.program_id) ?? null;
  return resolveCadenceValues({ assignment, program });
}

async function insertProvisoryAssignmentEvents(params: {
  clientId: string;
  assignmentId: string;
  programTitle: string;
  slots: AvailabilitySlot[];
}) {
  if (params.slots.length === 0) return { unavailable: false as const };
  const supabase = getSupabaseAdminClient();
  const insertEvents = await supabase.from("calendar_events").insert(
    params.slots.map((slot) => ({
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
        source: "manager_assignment_auto",
        eventLifecycle: "provisory",
        proposalKind: "assignment",
        content: `Reuniao provisoria gerada pela cadencia do programa ${params.programTitle}.`,
        preparationRequired: "Revisar indicadores recentes e alinhar proximos passos.",
      },
      updated_at: new Date().toISOString(),
    })),
  );

  if (insertEvents.error) {
    if (isMissingTableError(insertEvents.error, "calendar_events")) {
      return { unavailable: true as const };
    }
    throw insertEvents.error;
  }

  return { unavailable: false as const };
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

  const assignmentsLoaded = await loadAssignments(clientId);
  if (
    assignmentsLoaded.error &&
    !isMissingTableError(assignmentsLoaded.error, "client_programs")
  ) {
    return NextResponse.json({ error: "Could not load assigned programs." }, { status: 500 });
  }

  const programById = new Map((programsResult.data ?? []).map((row) => [row.program_id, row]));
  const assignments = assignmentsLoaded.data ?? [];

  let clientMasterCalendarEvents: MasterCalendarEvent[] = [];
  try {
    clientMasterCalendarEvents = await loadManagerMasterCalendarEvents();
  } catch {
    clientMasterCalendarEvents = [];
  }

  let committedByAssignment = new Map<string, AvailabilitySlot[]>();
  let provisoryByAssignment = new Map<string, AvailabilitySlot[]>();
  let timelineByAssignment = new Map<string, AssignmentCalendarEvent[]>();
  try {
    const loaded = await loadCommittedMeetingsByAssignment(
      clientId,
      assignments.map((assignment) => assignment.client_program_id),
    );
    committedByAssignment = loaded.committedByAssignment;
    provisoryByAssignment = loaded.provisoryByAssignment;
    timelineByAssignment = loaded.timelineByAssignment;
  } catch {
    committedByAssignment = new Map<string, AvailabilitySlot[]>();
    provisoryByAssignment = new Map<string, AvailabilitySlot[]>();
    timelineByAssignment = new Map<string, AssignmentCalendarEvent[]>();
  }

  return NextResponse.json({
    availablePrograms: (programsResult.data ?? []).map(mapAvailableProgram),
    assignedPrograms: assignments.map((item) => {
      const cadence = resolveCadenceForAssignment(item, programById);
      const storedProvisorySlots = provisoryByAssignment.get(item.client_program_id) ?? [];
      const cadenceSuggestedSlots =
        item.status === "Active" && !assignmentsLoaded.annualPlanSupported
          ? buildSuggestedAvailabilitySlots({
              deployedAt: item.deployed_at ?? new Date().toISOString(),
              scheduleFrequency: cadence.scheduleFrequency,
              scheduleAnchorDate: cadence.scheduleAnchorDate,
              existingEvents: clientMasterCalendarEvents.filter(
                (event) => event.sourceClientProgramId !== item.client_program_id,
              ),
              maxSlots: DEFAULT_ASSIGNMENT_CADENCE_SLOT_COUNT,
              enforceCadenceSeries: true,
            })
          : [];
      const provisorySlots =
        storedProvisorySlots.length > 0
          ? storedProvisorySlots
          : item.status === "Active"
            ? cadenceSuggestedSlots
            : [];

      return mapAssignedProgram(item, programById, {
        cadenceSuggestedSlots,
        calendarProvisorySlots: provisorySlots,
        calendarCommittedSlots: committedByAssignment.get(item.client_program_id) ?? [],
        calendarTimelineEvents: timelineByAssignment.get(item.client_program_id) ?? [],
      });
    }),
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

  const annualPlanMonths = normalizeAnnualPlanMonths(parsed.annualPlanMonths);
  let annualPlanColumnSupported = true;
  let insertResult = await supabase
    .from("client_programs")
    .insert({
      client_program_id: randomUUID(),
      client_id: clientId,
      program_id: parsed.programId,
      status: parsed.status ?? "Active",
      deployed_at:
        parsed.deployedAt && parsed.deployedAt.length > 0 ? parsed.deployedAt : new Date().toISOString(),
      schedule_frequency_override:
        parsed.scheduleFrequency ?? DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY,
      schedule_anchor_date_override:
        parsed.scheduleAnchorDate && parsed.scheduleAnchorDate.length > 0
          ? parsed.scheduleAnchorDate
          : todayIsoDate(),
      annual_plan_months: annualPlanMonths,
    })
    .select(
      "client_program_id,program_id,status,deployed_at,schedule_frequency_override,schedule_anchor_date_override,annual_plan_months",
    )
    .maybeSingle<ClientProgramRow>();

  if (insertResult.error && isMissingColumnError(insertResult.error, "annual_plan_months")) {
    annualPlanColumnSupported = false;
    insertResult = await supabase
      .from("client_programs")
      .insert({
        client_program_id: randomUUID(),
        client_id: clientId,
        program_id: parsed.programId,
        status: parsed.status ?? "Active",
        deployed_at:
          parsed.deployedAt && parsed.deployedAt.length > 0 ? parsed.deployedAt : new Date().toISOString(),
        schedule_frequency_override:
          parsed.scheduleFrequency ?? DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY,
        schedule_anchor_date_override:
          parsed.scheduleAnchorDate && parsed.scheduleAnchorDate.length > 0
            ? parsed.scheduleAnchorDate
            : todayIsoDate(),
      })
      .select(
        "client_program_id,program_id,status,deployed_at,schedule_frequency_override,schedule_anchor_date_override",
      )
      .maybeSingle<ClientProgramRow>();
  }

  if (insertResult.error) {
    if (isMissingColumnError(insertResult.error, "schedule_frequency_override")) {
      return NextResponse.json(
        {
          error:
            "Cadence override columns are unavailable. Apply migration 20260303130000_client_program_cadence_override.sql.",
        },
        { status: 412 },
      );
    }
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

  try {
    await createClientNotification(supabase, {
      clientId: client.client_id,
      notificationType: "manager_program_assigned",
      title: `Programa atribuido: ${programResult.data.title}`,
      message: "O gestor atribuiu um processo continuo para sua empresa.",
      metadata: {
        assignmentId: insertResult.data.client_program_id,
        programId: programResult.data.program_id,
        programTitle: programResult.data.title,
        assignmentStatus: insertResult.data.status,
        deployedAt: insertResult.data.deployed_at ?? null,
      },
    });
  } catch {
    // Do not block program assignment when notification persistence fails.
  }

  const programById = new Map([[programResult.data.program_id, programResult.data]]);
  let cadenceSuggestedSlots: AvailabilitySlot[] = [];
  const cadence = resolveCadenceForAssignment(insertResult.data, programById);
  let calendarUnavailable = false;
  try {
    if (insertResult.data.status === "Active") {
      const masterEvents = await loadManagerMasterCalendarEvents();
      cadenceSuggestedSlots = buildSuggestedAvailabilitySlots({
        deployedAt: insertResult.data.deployed_at ?? new Date().toISOString(),
        scheduleFrequency: cadence.scheduleFrequency,
        scheduleAnchorDate: cadence.scheduleAnchorDate,
        existingEvents: masterEvents,
        maxSlots: DEFAULT_ASSIGNMENT_CADENCE_SLOT_COUNT,
        enforceCadenceSeries: true,
      });
      const inserted = await insertProvisoryAssignmentEvents({
        clientId,
        assignmentId: insertResult.data.client_program_id,
        programTitle: programResult.data.title,
        slots: cadenceSuggestedSlots,
      });
      calendarUnavailable = inserted.unavailable;
    }
  } catch {
    cadenceSuggestedSlots = [];
  }

  if (annualPlanColumnSupported) {
    const persistedAnnualPlanMonths = normalizeAnnualPlanMonths(insertResult.data.annual_plan_months);
    const shouldBackfillAnnualPlanMonths =
      persistedAnnualPlanMonths.length === 0 &&
      annualPlanMonths.length === 0 &&
      insertResult.data.status === "Active";

    if (shouldBackfillAnnualPlanMonths) {
      const derivedAnnualPlanMonths = deriveAnnualPlanMonthsFromSlots(cadenceSuggestedSlots);
      if (derivedAnnualPlanMonths.length > 0) {
        const annualPlanUpdate = await supabase
          .from("client_programs")
          .update({ annual_plan_months: derivedAnnualPlanMonths })
          .eq("client_program_id", insertResult.data.client_program_id)
          .select("annual_plan_months")
          .maybeSingle<{ annual_plan_months: unknown }>();

        if (!annualPlanUpdate.error && annualPlanUpdate.data) {
          insertResult = {
            ...insertResult,
            data: {
              ...insertResult.data,
              annual_plan_months: annualPlanUpdate.data.annual_plan_months,
            },
          };
        }
      }
    }
  }

  return NextResponse.json(
    {
      assignment: mapAssignedProgram(insertResult.data, programById, {
        cadenceSuggestedSlots,
        calendarProvisorySlots: cadenceSuggestedSlots,
        calendarCommittedSlots: [],
      }),
      calendarUnavailable,
    },
    { status: 201 },
  );
}
