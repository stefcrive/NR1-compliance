import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildSuggestedAvailabilitySlots,
  slotOverlapsMasterCalendar,
  type AvailabilitySlot,
} from "@/lib/availability-scheduler";
import { isAdminApiAuthorized } from "@/lib/admin-auth";
import {
  DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY,
  parseContinuousProgramSessions,
} from "@/lib/continuous-programs";
import {
  buildAssignmentSessionPlans,
  normalizeAnnualPlanMonths as normalizeAnnualPlanMonthKeys,
  type AssignmentSessionPlan,
} from "@/lib/continuous-program-assignment-sessions";
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
  materials?: unknown;
  sessions?: unknown;
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
  status?: "scheduled" | "completed" | "cancelled";
};

type AssignmentCalendarEvent = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "completed" | "cancelled";
  lifecycle: "provisory" | "committed";
  proposalKind: "assignment" | "reschedule" | null;
  sessionId?: string | null;
  sessionIndex?: number | null;
  sessionTitle?: string | null;
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
    .select("program_id,title,schedule_frequency,schedule_anchor_date,materials,sessions")
    .eq("program_id", programId)
    .maybeSingle<ProgramRow>();

  if (withSchedule.error && isMissingColumnError(withSchedule.error, "schedule_frequency")) {
    return supabase
      .from("periodic_programs")
      .select("program_id,title,materials")
      .eq("program_id", programId)
      .maybeSingle<ProgramRow>();
  }

  if (withSchedule.error && isMissingColumnError(withSchedule.error, "sessions")) {
    return supabase
      .from("periodic_programs")
      .select("program_id,title,schedule_frequency,schedule_anchor_date,materials")
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

function resolveCadence(assignment: ClientProgramRow, program: ProgramRow | null) {
  return {
    scheduleFrequency: parseScheduleFrequency(
      assignment.schedule_frequency_override ?? program?.schedule_frequency,
    ),
    scheduleAnchorDate:
      parseIsoDate(
        assignment.schedule_anchor_date_override ?? program?.schedule_anchor_date,
      ) ?? todayIsoDate(),
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

async function loadAssignmentTimelineEvents(params: {
  clientId: string;
  assignmentId: string;
}): Promise<{ events: AssignmentCalendarEvent[]; unavailable: boolean }> {
  const supabase = getSupabaseAdminClient();
  const eventsResult = await supabase
    .from("calendar_events")
    .select("event_id,metadata,starts_at,ends_at,status")
    .eq("client_id", params.clientId)
    .eq("source_client_program_id", params.assignmentId)
    .eq("event_type", "continuous_meeting")
    .order("starts_at", { ascending: true })
    .returns<CalendarEventRow[]>();

  if (eventsResult.error) {
    if (isMissingTableError(eventsResult.error, "calendar_events")) {
      return { events: [], unavailable: true };
    }
    throw eventsResult.error;
  }

  const events: AssignmentCalendarEvent[] = [];
  for (const row of eventsResult.data ?? []) {
    if (!row.starts_at || !row.ends_at || !row.status) continue;
    const details = extractCalendarEventDetails(row.metadata);
    events.push({
      id: row.event_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      lifecycle: details.eventLifecycle,
      proposalKind: details.proposalKind,
      sessionId: details.sessionId ?? null,
      sessionIndex: details.sessionIndex ?? null,
      sessionTitle: details.sessionTitle ?? null,
    });
  }

  return { events, unavailable: false };
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
  sessions: ReturnType<typeof parseContinuousProgramSessions>,
): AssignmentSessionPlan[] {
  return slots.map((slot, index) => ({
    slot,
    session: sessions[index % sessions.length],
    sessionSequence: index + 1,
    sessionCycle: Math.floor(index / sessions.length) + 1,
  }));
}

function normalizeSessionPlans(plans: AssignmentSessionPlan[]): AssignmentSessionPlan[] {
  const unique = new Map<string, AssignmentSessionPlan>();
  for (const plan of plans) {
    const start = new Date(plan.slot.startsAt);
    const end = new Date(plan.slot.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      continue;
    }
    const normalizedSlot = {
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    };
    const key = `${normalizedSlot.startsAt}|${normalizedSlot.endsAt}`;
    if (!unique.has(key)) {
      unique.set(key, { ...plan, slot: normalizedSlot });
    }
  }
  return Array.from(unique.values()).sort(
    (left, right) =>
      new Date(left.slot.startsAt).getTime() -
      new Date(right.slot.startsAt).getTime(),
  );
}

async function replaceAssignmentProvisoryEvents(params: {
  clientId: string;
  assignmentId: string;
  programTitle: string;
  plans: AssignmentSessionPlan[];
}): Promise<{
  unavailable: boolean;
  invalidSlot: boolean;
  provisorySlots: AvailabilitySlot[];
}> {
  const supabase = getSupabaseAdminClient();
  const normalizedPlans = normalizeSessionPlans(params.plans);
  const normalizedSlots = normalizedPlans.map((plan) => plan.slot);

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

  if (normalizedPlans.length > 0) {
    const nowIso = new Date().toISOString();
    const insertEvents = await supabase.from("calendar_events").insert(
      normalizedPlans.map((plan) => ({
        event_id: randomUUID(),
        client_id: params.clientId,
        source_client_program_id: params.assignmentId,
        event_type: "continuous_meeting",
        title: `Reuniao processo continuo: ${params.programTitle} | Sessao ${plan.sessionSequence}`,
        starts_at: plan.slot.startsAt,
        ends_at: plan.slot.endsAt,
        status: "scheduled",
        created_by: "manager",
        metadata: {
          source: "manager_assignment_edit",
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
      ? normalizeAnnualPlanMonthKeys(parsed.annualPlanMonths)
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

  const cadence = resolveCadence(assignment, programResult.data);
  const programSessions = parseContinuousProgramSessions(programResult.data.sessions, {
    fallbackMaterials: programResult.data.materials,
    minCount: 1,
  });
  const annualPlanMonths = annualPlanSupported
    ? normalizeAnnualPlanMonthKeys(assignment.annual_plan_months)
    : [];

  const shouldRefreshProvisorySlots =
    parsed.status !== undefined ||
    parsed.provisorySlots !== undefined ||
    parsed.deployedAt !== undefined ||
    parsed.scheduleFrequency !== undefined ||
    parsed.annualPlanMonths !== undefined;

  let provisorySlots: AvailabilitySlot[] = [];
  if (shouldRefreshProvisorySlots) {
    let desiredPlans: AssignmentSessionPlan[] = [];
    const explicitAnnualPlanSelection = annualPlanSupported && parsed.annualPlanMonths !== undefined;
    const shouldUseAnnualPlan = annualPlanSupported && annualPlanMonths.length > 0;

    if (assignment.status !== "Active") {
      desiredPlans = [];
    } else if (parsed.provisorySlots !== undefined) {
      desiredPlans = mapSlotsToSessionPlans(parsed.provisorySlots, programSessions);
    } else if (shouldUseAnnualPlan || explicitAnnualPlanSelection) {
      const masterEvents = await loadManagerMasterCalendarEvents();
      const eventsWithoutCurrentProvisory = filterCurrentAssignmentProvisoryEvents(
        masterEvents,
        assignment.client_program_id,
      );
      desiredPlans = buildAssignmentSessionPlans({
        annualPlanMonths,
        deployedAt: assignment.deployed_at,
        sessions: programSessions,
        existingEvents: eventsWithoutCurrentProvisory,
      });
      if (!explicitAnnualPlanSelection && annualPlanMonths.length > 0 && desiredPlans.length === 0) {
        const fallbackSlots = buildSuggestedAvailabilitySlots({
          deployedAt: assignment.deployed_at ?? new Date().toISOString(),
          scheduleFrequency: cadence.scheduleFrequency,
          scheduleAnchorDate: cadence.scheduleAnchorDate,
          existingEvents: masterEvents.filter(
            (event) => event.sourceClientProgramId !== assignment.client_program_id,
          ),
          maxSlots: Math.max(programSessions.length, 1),
          enforceCadenceSeries: true,
        });
        desiredPlans = mapSlotsToSessionPlans(fallbackSlots, programSessions);
      }
    } else {
      const masterEvents = await loadManagerMasterCalendarEvents();
      const fallbackSlots = buildSuggestedAvailabilitySlots({
        deployedAt: assignment.deployed_at ?? new Date().toISOString(),
        scheduleFrequency: cadence.scheduleFrequency,
        scheduleAnchorDate: cadence.scheduleAnchorDate,
        existingEvents: masterEvents.filter(
          (event) => event.sourceClientProgramId !== assignment.client_program_id,
        ),
        maxSlots: Math.max(programSessions.length, 1),
        enforceCadenceSeries: true,
      });
      desiredPlans = mapSlotsToSessionPlans(fallbackSlots, programSessions);
    }

    const replaced = await replaceAssignmentProvisoryEvents({
      clientId,
      assignmentId: assignment.client_program_id,
      programTitle: programResult.data.title,
      plans: desiredPlans,
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

  const timelineLoaded = await loadAssignmentTimelineEvents({
    clientId,
    assignmentId: assignment.client_program_id,
  });
  const timelineEvents = timelineLoaded.unavailable ? [] : timelineLoaded.events;

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
      calendarTimelineEvents: timelineEvents,
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
