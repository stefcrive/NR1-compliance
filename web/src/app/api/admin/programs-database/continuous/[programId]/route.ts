import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
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
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

const PROGRAM_BASE_SELECT = "program_id,title,description,target_risk_topic,trigger_threshold";
const PROGRAM_DETAILS_SELECT =
  "program_id,title,description,target_risk_topic,trigger_threshold,schedule_frequency,schedule_anchor_date,evaluation_questions,materials,sessions,metrics";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
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

  const normalizedSessions =
    parsed.sessions !== undefined
      ? parseContinuousProgramSessions(parsed.sessions, {
          fallbackMaterials: parsed.materials,
          minCount: 1,
        })
      : undefined;
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
  });
}
