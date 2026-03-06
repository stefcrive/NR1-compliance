import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { MANAGER_SESSION_COOKIE, parseManagerSessionToken } from "@/lib/auth/session";
import { isAdminApiAuthorized } from "@/lib/admin-auth";
import {
  COMPANY_RISK_PROFILE_FACTORS,
  COMPANY_RISK_PROFILE_QUESTIONNAIRE_VERSION,
  type CompanyRiskProbabilityClass,
  type CompanyRiskProfileAnswers,
  type CompanyRiskProfileFactorScore,
  normalizeCompanyRiskProfileAnswers,
} from "@/lib/company-risk-profile";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ClientRow = {
  client_id: string;
  company_name: string;
};

type ReportRow = {
  id: string;
  client_id: string;
  questionnaire_version: string;
  sector: string | null;
  notes: string | null;
  answers_json: CompanyRiskProfileAnswers;
  factor_scores: CompanyRiskProfileFactorScore[] | unknown;
  summary_counts: Record<string, number> | null;
  overall_score: number | string;
  overall_class: string;
  created_by_role: string;
  created_by_email: string | null;
  created_at: string;
};

type ProgressRow = {
  client_id: string;
  questionnaire_version: string;
  status: "not_started" | "in_progress" | "completed";
  answers_json: unknown;
  completion_ratio: number | string;
  started_at: string | null;
  completed_at: string | null;
  last_saved_at: string | null;
  last_skipped_at: string | null;
  last_reminder_at: string | null;
  latest_report_id: string | null;
  next_cycle_available_at: string | null;
  updated_at: string;
};

const reassignSchema = z.object({
  action: z.literal("reassign"),
  cooldownDays: z.coerce.number().int().min(0).max(365).optional(),
});

function parseOverallScore(value: number | string): number {
  if (typeof value === "number") return Number(value.toFixed(2));
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(2));
}

function parseCompletionRatio(value: number | string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(4));
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(4));
}

function normalizeProbabilityClass(value: string): CompanyRiskProbabilityClass {
  if (value === "baixa") return "baixa";
  if (value === "alta") return "alta";
  return "media";
}

function toOccurrenceProbability(value: CompanyRiskProbabilityClass): 1 | 2 | 3 {
  if (value === "baixa") return 1;
  if (value === "media") return 2;
  return 3;
}

function normalizeSummaryCounts(value: Record<string, number> | null | undefined) {
  return {
    baixa: Number.isFinite(value?.baixa) ? Number(value?.baixa) : 0,
    media: Number.isFinite(value?.media) ? Number(value?.media) : 0,
    alta: Number.isFinite(value?.alta) ? Number(value?.alta) : 0,
  };
}

function normalizeFactorScores(value: unknown): CompanyRiskProfileFactorScore[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is CompanyRiskProfileFactorScore =>
      Boolean(
        item &&
          typeof item === "object" &&
          typeof (item as { factorKey?: unknown }).factorKey === "string" &&
          typeof (item as { factorLabel?: unknown }).factorLabel === "string",
      ),
  );
}

function normalizeReportRow(row: ReportRow) {
  const factorScores = normalizeFactorScores(row.factor_scores);
  return {
    id: row.id,
    questionnaireVersion: row.questionnaire_version,
    sector: row.sector,
    notes: row.notes,
    answers: row.answers_json,
    factorScores,
    summaryCounts: normalizeSummaryCounts(row.summary_counts),
    overallScore: parseOverallScore(row.overall_score),
    overallClass: normalizeProbabilityClass(row.overall_class),
    createdByRole: row.created_by_role === "client" ? "client" : "manager",
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
  };
}

function mapProgressRow(row: ProgressRow | null) {
  if (!row) {
    return {
      status: "not_started" as const,
      completionRatio: 0,
      startedAt: null as string | null,
      completedAt: null as string | null,
      lastSavedAt: null as string | null,
      lastSkippedAt: null as string | null,
      lastReminderAt: null as string | null,
      latestReportId: null as string | null,
      nextCycleAvailableAt: null as string | null,
      updatedAt: null as string | null,
    };
  }

  return {
    status: row.status,
    completionRatio: parseCompletionRatio(row.completion_ratio),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastSavedAt: row.last_saved_at,
    lastSkippedAt: row.last_skipped_at,
    lastReminderAt: row.last_reminder_at,
    latestReportId: row.latest_report_id,
    nextCycleAvailableAt: row.next_cycle_available_at,
    updatedAt: row.updated_at,
  };
}

function buildRiskOccurrenceTrendSeries(
  reports: Array<ReturnType<typeof normalizeReportRow>>,
) {
  const chronologicalReports = [...reports].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const seriesByKey = new Map<
    string,
    {
      factorKey: string;
      factorLabel: string;
      points: Array<{
        reportId: string;
        createdAt: string;
        score: number;
        probabilityClass: CompanyRiskProbabilityClass;
        occurrenceProbability: 1 | 2 | 3;
      }>;
    }
  >();

  for (const report of chronologicalReports) {
    for (const factorScore of report.factorScores) {
      const bucket = seriesByKey.get(factorScore.factorKey) ?? {
        factorKey: factorScore.factorKey,
        factorLabel: factorScore.factorLabel,
        points: [],
      };
      bucket.points.push({
        reportId: report.id,
        createdAt: report.createdAt,
        score: Number(factorScore.score.toFixed(2)),
        probabilityClass: factorScore.probabilityClass,
        occurrenceProbability: toOccurrenceProbability(factorScore.probabilityClass),
      });
      seriesByKey.set(factorScore.factorKey, bucket);
    }
  }

  const factorOrder = new Map(COMPANY_RISK_PROFILE_FACTORS.map((factor, index) => [factor.key, index]));
  return Array.from(seriesByKey.values())
    .sort((left, right) => {
      const leftOrder = factorOrder.get(left.factorKey) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = factorOrder.get(right.factorKey) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.factorLabel.localeCompare(right.factorLabel);
    })
    .map((series) => ({
      ...series,
      points: series.points.sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    }));
}

async function loadClient(clientId: string): Promise<ClientRow | null> {
  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("clients")
    .select("client_id,company_name")
    .eq("client_id", clientId)
    .maybeSingle<ClientRow>();

  if (result.error) {
    throw result.error;
  }
  return result.data ?? null;
}

async function loadProgress(clientId: string) {
  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("client_company_risk_profile_progress")
    .select(
      "client_id,questionnaire_version,status,answers_json,completion_ratio,started_at,completed_at,last_saved_at,last_skipped_at,last_reminder_at,latest_report_id,next_cycle_available_at,updated_at",
    )
    .eq("client_id", clientId)
    .maybeSingle<ProgressRow>();

  if (result.error) {
    if (isMissingTableError(result.error, "client_company_risk_profile_progress")) {
      return { row: null, unavailable: true };
    }

    if (isMissingColumnError(result.error, "next_cycle_available_at")) {
      const fallback = await supabase
        .from("client_company_risk_profile_progress")
        .select(
          "client_id,questionnaire_version,status,answers_json,completion_ratio,started_at,completed_at,last_saved_at,last_skipped_at,last_reminder_at,latest_report_id,updated_at",
        )
        .eq("client_id", clientId)
        .maybeSingle<
          Omit<ProgressRow, "next_cycle_available_at">
        >();
      if (fallback.error) {
        if (isMissingTableError(fallback.error, "client_company_risk_profile_progress")) {
          return { row: null, unavailable: true };
        }
        throw fallback.error;
      }

      return {
        row: fallback.data
          ? {
              ...fallback.data,
              next_cycle_available_at: null,
            }
          : null,
        unavailable: false,
      };
    }
    throw result.error;
  }

  return { row: result.data ?? null, unavailable: false };
}

function ensureManagerSession(request: NextRequest) {
  return parseManagerSessionToken(request.cookies.get(MANAGER_SESSION_COOKIE)?.value);
}

function isRequestAuthorized(request: NextRequest): boolean {
  return Boolean(ensureManagerSession(request)) || isAdminApiAuthorized(request);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { clientId } = await context.params;
  const supabase = getSupabaseAdminClient();

  try {
    const client = await loadClient(clientId);
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const [progressResult, reportsResult] = await Promise.all([
      loadProgress(client.client_id),
      supabase
        .from("client_company_risk_profile_reports")
        .select(
          "id,client_id,questionnaire_version,sector,notes,answers_json,factor_scores,summary_counts,overall_score,overall_class,created_by_role,created_by_email,created_at",
        )
        .eq("client_id", client.client_id)
        .eq("created_by_role", "client")
        .order("created_at", { ascending: false })
        .limit(200)
        .returns<ReportRow[]>(),
    ]);

    if (reportsResult.error && !isMissingTableError(reportsResult.error, "client_company_risk_profile_reports")) {
      return NextResponse.json({ error: "Could not load company risk profile reports." }, { status: 500 });
    }

    const reportsUnavailable = isMissingTableError(reportsResult.error, "client_company_risk_profile_reports");
    const normalizedReports = reportsUnavailable ? [] : (reportsResult.data ?? []).map(normalizeReportRow);

    return NextResponse.json({
      client: {
        id: client.client_id,
        companyName: client.company_name,
      },
      questionnaire: {
        version: COMPANY_RISK_PROFILE_QUESTIONNAIRE_VERSION,
      },
      progress: mapProgressRow(progressResult.row),
      progressUnavailable: progressResult.unavailable,
      reports: normalizedReports,
      trendSeries: buildRiskOccurrenceTrendSeries(normalizedReports),
      reportsUnavailable,
    });
  } catch {
    return NextResponse.json({ error: "Could not load company risk profile data." }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { clientId } = await context.params;
  const supabase = getSupabaseAdminClient();

  const payload = await request.json().catch(() => null);
  const parsed = reassignSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid reassignment payload." }, { status: 400 });
  }

  const client = await loadClient(clientId).catch(() => null);
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const latestClientReportResult = await supabase
    .from("client_company_risk_profile_reports")
    .select("id")
    .eq("client_id", client.client_id)
    .eq("created_by_role", "client")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (
    latestClientReportResult.error &&
    !isMissingTableError(latestClientReportResult.error, "client_company_risk_profile_reports")
  ) {
    return NextResponse.json({ error: "Could not load latest client report." }, { status: 500 });
  }

  const cooldownDays = parsed.data.cooldownDays ?? 30;
  const now = new Date();
  const nowIso = now.toISOString();
  const nextCycleAvailableAt =
    cooldownDays > 0 ? new Date(now.getTime() + cooldownDays * 24 * 60 * 60 * 1000).toISOString() : null;

  const resetAnswers = normalizeCompanyRiskProfileAnswers({}, { allowIncomplete: true });
  const upsertResult = await supabase
    .from("client_company_risk_profile_progress")
    .upsert(
      {
        client_id: client.client_id,
        questionnaire_version: COMPANY_RISK_PROFILE_QUESTIONNAIRE_VERSION,
        status: "not_started",
        answers_json: resetAnswers,
        completion_ratio: 0,
        started_at: null,
        completed_at: null,
        last_saved_at: null,
        last_skipped_at: null,
        last_reminder_at: null,
        latest_report_id: latestClientReportResult.data?.id ?? null,
        next_cycle_available_at: nextCycleAvailableAt,
        updated_at: nowIso,
      },
      { onConflict: "client_id" },
    )
    .select(
      "client_id,questionnaire_version,status,answers_json,completion_ratio,started_at,completed_at,last_saved_at,last_skipped_at,last_reminder_at,latest_report_id,next_cycle_available_at,updated_at",
    )
    .single<ProgressRow>();

  if (upsertResult.error) {
    if (isMissingTableError(upsertResult.error, "client_company_risk_profile_progress")) {
      return NextResponse.json(
        {
          error:
            "Company risk profile progress table is unavailable. Apply migration 20260305235000_company_risk_profile_client_flow.sql.",
        },
        { status: 503 },
      );
    }
    if (isMissingColumnError(upsertResult.error, "next_cycle_available_at")) {
      return NextResponse.json(
        {
          error:
            "Company risk profile reassignment requires column next_cycle_available_at. Apply migration 20260306001000_company_risk_profile_reassignment.sql.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Could not reassign company questionnaire." }, { status: 500 });
  }

  return NextResponse.json({
    progress: mapProgressRow(upsertResult.data),
    reassignedAt: nowIso,
    nextCycleAvailableAt,
  });
}

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Managers can only review client-submitted company risk profile responses. Use the client flow to submit.",
    },
    { status: 405 },
  );
}
