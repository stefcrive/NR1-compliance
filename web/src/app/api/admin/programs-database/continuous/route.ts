import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import {
  CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCIES,
  DEFAULT_CONTINUOUS_PROGRAM_METRICS,
  DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS,
  DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY,
  type ContinuousProgramMaterial,
  type ContinuousProgramMetrics,
  type ContinuousProgramScheduleFrequency,
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
  metrics?: unknown;
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

const scheduleFrequencySchema = z.enum(CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCIES);

const createTemplateSchema = z.object({
  title: z.string().trim().min(3).max(255),
  description: z.string().trim().max(5000).nullable().optional(),
  targetRiskTopic: z.number().int().min(1).max(13),
  triggerThreshold: z.number().min(1).max(3),
  scheduleFrequency: scheduleFrequencySchema.optional(),
  scheduleAnchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  evaluationQuestions: z.array(z.string().trim().min(3).max(240)).min(1).max(20).optional(),
  materials: z.array(programMaterialSchema).max(80).optional(),
  metrics: metricsSchema.optional(),
});

const PROGRAM_BASE_SELECT = "program_id,title,description,target_risk_topic,trigger_threshold";
const PROGRAM_DETAILS_SELECT =
  "program_id,title,description,target_risk_topic,trigger_threshold,schedule_frequency,schedule_anchor_date,evaluation_questions,materials,metrics";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseScheduleFrequency(value: unknown): ContinuousProgramScheduleFrequency {
  if (typeof value !== "string") return DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY;
  const parsed = scheduleFrequencySchema.safeParse(value.toLowerCase());
  if (!parsed.success) return DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY;
  return parsed.data;
}

function parseEvaluationQuestions(value: unknown): string[] {
  const parsed = z.array(z.string().trim().min(3).max(240)).max(20).safeParse(value);
  if (!parsed.success || parsed.data.length === 0) {
    return DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS;
  }
  return parsed.data;
}

function parseMaterials(value: unknown): ContinuousProgramMaterial[] {
  const parsed = z.array(programMaterialSchema).max(80).safeParse(value);
  if (!parsed.success) return [];
  return parsed.data;
}

function parseMetrics(value: unknown): ContinuousProgramMetrics {
  const parsed = metricsSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_CONTINUOUS_PROGRAM_METRICS;
  return parsed.data;
}

function mapProgram(row: PeriodicProgramRow) {
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
    materials: parseMaterials(row.materials),
    metrics: parseMetrics(row.metrics),
  };
}

export async function POST(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let parsed: z.infer<typeof createTemplateSchema>;
  try {
    parsed = createTemplateSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const programId = randomUUID();
  const payload = {
    program_id: programId,
    title: parsed.title,
    description: parsed.description && parsed.description.length > 0 ? parsed.description : null,
    target_risk_topic: parsed.targetRiskTopic,
    trigger_threshold: Number(parsed.triggerThreshold.toFixed(2)),
    schedule_frequency: parsed.scheduleFrequency ?? DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY,
    schedule_anchor_date: parsed.scheduleAnchorDate ?? todayIsoDate(),
    evaluation_questions: parsed.evaluationQuestions ?? DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS,
    materials: parsed.materials ?? [],
    metrics: parsed.metrics ?? DEFAULT_CONTINUOUS_PROGRAM_METRICS,
  };

  const basePayload = {
    program_id: programId,
    title: payload.title,
    description: payload.description,
    target_risk_topic: payload.target_risk_topic,
    trigger_threshold: payload.trigger_threshold,
  };

  const supabase = getSupabaseAdminClient();
  const detailedInsertResult = await supabase
    .from("periodic_programs")
    .insert(payload)
    .select(PROGRAM_DETAILS_SELECT)
    .maybeSingle<PeriodicProgramRow>();

  const insertResult =
    detailedInsertResult.error && isMissingColumnError(detailedInsertResult.error)
      ? await supabase
          .from("periodic_programs")
          .insert(basePayload)
          .select(PROGRAM_BASE_SELECT)
          .maybeSingle<PeriodicProgramRow>()
      : detailedInsertResult;

  if (insertResult.error && !isMissingTableError(insertResult.error, "periodic_programs")) {
    return NextResponse.json({ error: "Could not create continuous program template." }, { status: 500 });
  }

  if (isMissingTableError(insertResult.error, "periodic_programs")) {
    return NextResponse.json(
      {
        error:
          "Program database is unavailable. Apply migration 20260301173000_seed_b2b_multitenant_compliance.sql.",
      },
      { status: 412 },
    );
  }

  if (!insertResult.data) {
    return NextResponse.json({ error: "Could not create continuous program template." }, { status: 500 });
  }

  return NextResponse.json({ program: mapProgram(insertResult.data) }, { status: 201 });
}
