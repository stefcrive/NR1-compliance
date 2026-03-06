import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  CLIENT_SESSION_COOKIE,
  parseClientSessionToken,
} from "@/lib/auth/session";
import {
  type CompanyRiskProbabilityClass,
  COMPANY_RISK_PROFILE_FACTORS,
  COMPANY_RISK_PROFILE_QUESTIONNAIRE_VERSION,
  COMPANY_RISK_PROFILE_QUESTIONS,
  computeCompanyRiskProfile,
  countAnsweredCompanyRiskProfileAnswers,
  normalizeCompanyRiskProfileAnswers,
  totalCompanyRiskProfileQuestions,
} from "@/lib/company-risk-profile";
import { createClientNotification } from "@/lib/client-notifications";
import { createManagerNotification } from "@/lib/manager-notifications";
import { slugify } from "@/lib/slug";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ClientRow = {
  client_id: string;
  company_name: string;
  portal_slug: string;
};

type LegacyClientRow = {
  client_id: string;
  company_name: string;
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

type ReportRow = {
  id: string;
  questionnaire_version: string;
  sector: string | null;
  notes: string | null;
  overall_score: number | string;
  overall_class: string;
  created_at: string;
};

const REMINDER_INTERVAL_DAYS = 7;

const updateProgressSchema = z.object({
  action: z.enum(["save", "skip"]).optional(),
  answers: z.unknown().optional(),
});

const completeQuestionnaireSchema = z.object({
  answers: z.unknown(),
  sector: z.string().trim().max(140).optional(),
  notes: z.string().trim().max(8000).optional(),
});

function parseCompletionRatio(value: number | string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(4));
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(4));
}

function parseOverallScore(value: number | string): number {
  if (typeof value === "number") return Number(value.toFixed(2));
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(2));
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function normalizeOverallClass(value: unknown): CompanyRiskProbabilityClass {
  if (value === "baixa") return "baixa";
  if (value === "alta") return "alta";
  return "media";
}

function emptyProgress() {
  return {
    status: "not_started" as const,
    answers: normalizeCompanyRiskProfileAnswers({}, { allowIncomplete: true }),
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

function mapProgressRow(row: ProgressRow | null) {
  if (!row) return emptyProgress();
  return {
    status: row.status,
    answers: normalizeCompanyRiskProfileAnswers(row.answers_json, { allowIncomplete: true }),
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

function mapReportRow(row: ReportRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    questionnaireVersion: row.questionnaire_version,
    sector: row.sector,
    notes: row.notes,
    overallScore: parseOverallScore(row.overall_score),
    overallClass: normalizeOverallClass(row.overall_class),
    createdAt: row.created_at,
  };
}

function reminderDue(lastReminderAt: string | null): boolean {
  if (!lastReminderAt) return true;
  const reminderMs = new Date(lastReminderAt).getTime();
  if (!Number.isFinite(reminderMs)) return true;
  return Date.now() - reminderMs >= REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
}

function reassignmentLockDue(nextCycleAvailableAt: string | null): boolean {
  if (!nextCycleAvailableAt) return false;
  const lockMs = new Date(nextCycleAvailableAt).getTime();
  if (!Number.isFinite(lockMs)) return false;
  return lockMs > Date.now();
}

async function loadClientBySlug(clientSlug: string): Promise<ClientRow | null> {
  const supabase = getSupabaseAdminClient();
  const modernResult = await supabase
    .from("clients")
    .select("client_id,company_name,portal_slug")
    .eq("portal_slug", clientSlug)
    .maybeSingle<ClientRow>();

  if (!modernResult.error) {
    return modernResult.data ?? null;
  }

  if (!isMissingColumnError(modernResult.error, "portal_slug")) {
    throw modernResult.error;
  }

  const legacyResult = await supabase
    .from("clients")
    .select("client_id,company_name")
    .returns<LegacyClientRow[]>();

  if (legacyResult.error) {
    throw legacyResult.error;
  }

  const matched = (legacyResult.data ?? []).find((row) => slugify(row.company_name) === clientSlug);
  if (!matched) return null;

  return {
    client_id: matched.client_id,
    company_name: matched.company_name,
    portal_slug: slugify(matched.company_name),
  };
}

function ensureClientSession(request: NextRequest, clientSlug: string) {
  const session = parseClientSessionToken(request.cookies.get(CLIENT_SESSION_COOKIE)?.value);
  if (!session || session.clientSlug !== clientSlug) {
    return null;
  }
  return session;
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
      const fallbackResult = await supabase
        .from("client_company_risk_profile_progress")
        .select(
          "client_id,questionnaire_version,status,answers_json,completion_ratio,started_at,completed_at,last_saved_at,last_skipped_at,last_reminder_at,latest_report_id,updated_at",
        )
        .eq("client_id", clientId)
        .maybeSingle<Omit<ProgressRow, "next_cycle_available_at">>();
      if (fallbackResult.error) {
        if (isMissingTableError(fallbackResult.error, "client_company_risk_profile_progress")) {
          return { row: null, unavailable: true };
        }
        throw fallbackResult.error;
      }
      return {
        row: fallbackResult.data
          ? {
              ...fallbackResult.data,
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

async function loadLatestCompletedReport(clientId: string) {
  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("client_company_risk_profile_reports")
    .select("id,questionnaire_version,sector,notes,overall_score,overall_class,created_at")
    .eq("client_id", clientId)
    .eq("created_by_role", "client")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ReportRow>();

  if (result.error) {
    if (isMissingTableError(result.error, "client_company_risk_profile_reports")) {
      return { row: null, unavailable: true };
    }
    throw result.error;
  }

  return { row: result.data ?? null, unavailable: false };
}

async function upsertProgress(clientId: string, payload: Record<string, unknown>) {
  const supabase = getSupabaseAdminClient();
  const upsertResult = await supabase
    .from("client_company_risk_profile_progress")
    .upsert(
      {
        client_id: clientId,
        questionnaire_version: COMPANY_RISK_PROFILE_QUESTIONNAIRE_VERSION,
        ...payload,
      },
      { onConflict: "client_id" },
    )
    .select(
      "client_id,questionnaire_version,status,answers_json,completion_ratio,started_at,completed_at,last_saved_at,last_skipped_at,last_reminder_at,latest_report_id,next_cycle_available_at,updated_at",
    )
    .single<ProgressRow>();

  if (upsertResult.error) {
    throw upsertResult.error;
  }

  return upsertResult.data;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientSlug: string }> },
) {
  const { clientSlug } = await context.params;
  const session = ensureClientSession(request, clientSlug);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const touchReminder = request.nextUrl.searchParams.get("touchReminder") !== "0";

  try {
    const client = await loadClientBySlug(clientSlug);
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const [progressResult, latestReportResult] = await Promise.all([
      loadProgress(client.client_id),
      loadLatestCompletedReport(client.client_id),
    ]);

    const progress = mapProgressRow(progressResult.row);
    const latestReport = mapReportRow(latestReportResult.row);

    if (touchReminder && !progressResult.unavailable && progress.status !== "completed" && reminderDue(progress.lastReminderAt)) {
      const nowIso = new Date().toISOString();
      try {
        const notificationResult = await createClientNotification(getSupabaseAdminClient(), {
          clientId: client.client_id,
          notificationType: "company_risk_profile_reminder",
          title: "Questionario de perfil de risco pendente",
          message: "Complete o questionario da empresa quando possivel para liberar o resultado de risco.",
          metadata: {
            clientSlug,
            reminderType: "company_risk_profile",
            nextSuggestedCheckDays: REMINDER_INTERVAL_DAYS,
          },
        });

        if (!notificationResult.unavailable) {
          await upsertProgress(client.client_id, {
            status: progress.status,
            answers_json: progress.answers,
            completion_ratio: progress.completionRatio,
            started_at: progress.startedAt,
            completed_at: progress.completedAt,
            last_saved_at: progress.lastSavedAt,
            last_skipped_at: progress.lastSkippedAt,
            last_reminder_at: nowIso,
            latest_report_id: progress.latestReportId,
            next_cycle_available_at: progress.nextCycleAvailableAt,
            updated_at: nowIso,
          });
          progress.lastReminderAt = nowIso;
          progress.updatedAt = nowIso;
        }
      } catch {
        // Do not block client flow if reminder persistence fails.
      }
    }

    return NextResponse.json({
      client: {
        id: client.client_id,
        companyName: client.company_name,
        clientSlug: client.portal_slug,
      },
      questionnaire: {
        version: COMPANY_RISK_PROFILE_QUESTIONNAIRE_VERSION,
        factors: COMPANY_RISK_PROFILE_FACTORS,
        questions: COMPANY_RISK_PROFILE_QUESTIONS,
      },
      progress,
      latestReport,
      progressUnavailable: progressResult.unavailable,
      reportsUnavailable: latestReportResult.unavailable,
    });
  } catch {
    return NextResponse.json({ error: "Could not load company risk profile questionnaire." }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ clientSlug: string }> },
) {
  const { clientSlug } = await context.params;
  const session = ensureClientSession(request, clientSlug);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let parsed: z.infer<typeof updateProgressSchema>;
  try {
    parsed = updateProgressSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  try {
    const client = await loadClientBySlug(clientSlug);
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const progressResult = await loadProgress(client.client_id);
    if (progressResult.unavailable) {
      return NextResponse.json(
        {
          error:
            "Company risk profile progress table is unavailable. Apply migration 20260305235000_company_risk_profile_client_flow.sql.",
        },
        { status: 503 },
      );
    }

    const currentProgress = mapProgressRow(progressResult.row);
    if (reassignmentLockDue(currentProgress.nextCycleAvailableAt)) {
      return NextResponse.json(
        {
          error: `Questionario reatribuido. Nova rodada liberada em ${formatDateTime(currentProgress.nextCycleAvailableAt)}.`,
        },
        { status: 409 },
      );
    }

    if (currentProgress.status === "completed") {
      return NextResponse.json(
        { error: "Questionario ja concluido." },
        { status: 409 },
      );
    }

    const nextAnswers =
      parsed.answers === undefined
        ? currentProgress.answers
        : normalizeCompanyRiskProfileAnswers(parsed.answers, { allowIncomplete: true });
    const answeredCount = countAnsweredCompanyRiskProfileAnswers(nextAnswers);
    const totalQuestions = totalCompanyRiskProfileQuestions();
    const completionRatio = totalQuestions > 0 ? Number((answeredCount / totalQuestions).toFixed(4)) : 0;
    const status = answeredCount > 0 ? "in_progress" : "not_started";
    const nowIso = new Date().toISOString();

    const updated = await upsertProgress(client.client_id, {
      status,
      answers_json: nextAnswers,
      completion_ratio: completionRatio,
      started_at: status === "in_progress" ? currentProgress.startedAt ?? nowIso : null,
      completed_at: null,
      last_saved_at: parsed.action === "skip" ? currentProgress.lastSavedAt : nowIso,
      last_skipped_at: parsed.action === "skip" ? nowIso : currentProgress.lastSkippedAt,
      last_reminder_at: currentProgress.lastReminderAt,
      latest_report_id: currentProgress.latestReportId,
      next_cycle_available_at: null,
      updated_at: nowIso,
    });

    return NextResponse.json({
      progress: mapProgressRow(updated),
    });
  } catch {
    return NextResponse.json({ error: "Could not save questionnaire progress." }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ clientSlug: string }> },
) {
  const { clientSlug } = await context.params;
  const session = ensureClientSession(request, clientSlug);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let parsed: z.infer<typeof completeQuestionnaireSchema>;
  try {
    parsed = completeQuestionnaireSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  try {
    const client = await loadClientBySlug(clientSlug);
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const progressResult = await loadProgress(client.client_id);
    if (progressResult.unavailable) {
      return NextResponse.json(
        {
          error:
            "Company risk profile progress table is unavailable. Apply migration 20260305235000_company_risk_profile_client_flow.sql.",
        },
        { status: 503 },
      );
    }

    const currentProgress = mapProgressRow(progressResult.row);
    if (reassignmentLockDue(currentProgress.nextCycleAvailableAt)) {
      return NextResponse.json(
        {
          error: `Questionario reatribuido. Nova rodada liberada em ${formatDateTime(currentProgress.nextCycleAvailableAt)}.`,
        },
        { status: 409 },
      );
    }

    if (currentProgress.status === "completed") {
      return NextResponse.json({ error: "Questionario ja concluido." }, { status: 409 });
    }

    const answers = normalizeCompanyRiskProfileAnswers(parsed.answers, { allowIncomplete: true });
    const answeredCount = countAnsweredCompanyRiskProfileAnswers(answers);
    const totalQuestions = totalCompanyRiskProfileQuestions();
    if (answeredCount !== totalQuestions) {
      return NextResponse.json(
        {
          error: "Preencha todas as perguntas antes de concluir o questionario.",
        },
        { status: 400 },
      );
    }

    const computed = computeCompanyRiskProfile(answers);

    const supabase = getSupabaseAdminClient();
    const insertedReport = await supabase
      .from("client_company_risk_profile_reports")
      .insert({
        client_id: client.client_id,
        questionnaire_version: COMPANY_RISK_PROFILE_QUESTIONNAIRE_VERSION,
        sector: parsed.sector && parsed.sector.length > 0 ? parsed.sector : null,
        notes: parsed.notes && parsed.notes.length > 0 ? parsed.notes : null,
        answers_json: computed.answers,
        factor_scores: computed.factorScores,
        summary_counts: computed.summaryCounts,
        overall_score: computed.overallScore,
        overall_class: computed.overallClass,
        created_by_role: "client",
        created_by_email: session.email,
      })
      .select("id,questionnaire_version,sector,notes,overall_score,overall_class,created_at")
      .single<ReportRow>();

    if (insertedReport.error) {
      if (isMissingTableError(insertedReport.error, "client_company_risk_profile_reports")) {
        return NextResponse.json(
          {
            error:
              "Company risk profile reports table is unavailable. Apply migration 20260305233000_company_risk_profile_reports.sql.",
          },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: "Could not persist company risk profile report." }, { status: 500 });
    }

    const nowIso = new Date().toISOString();
    const updatedProgress = await upsertProgress(client.client_id, {
      status: "completed",
      answers_json: computed.answers,
      completion_ratio: 1,
      started_at: currentProgress.startedAt ?? nowIso,
      completed_at: nowIso,
      last_saved_at: nowIso,
      last_skipped_at: currentProgress.lastSkippedAt,
      last_reminder_at: currentProgress.lastReminderAt,
      latest_report_id: insertedReport.data.id,
      next_cycle_available_at: null,
      updated_at: nowIso,
    });

    try {
      await createManagerNotification(supabase, {
        clientId: client.client_id,
        notificationType: "client_company_risk_profile_completed",
        title: `Questionario de perfil de risco concluido: ${client.company_name}`,
        message: `${client.company_name} concluiu o questionario de perfil de risco da empresa.`,
        metadata: {
          clientSlug,
          reportId: insertedReport.data.id,
          overallScore: parseOverallScore(insertedReport.data.overall_score),
          overallClass: normalizeOverallClass(insertedReport.data.overall_class),
          completedAt: insertedReport.data.created_at,
        },
      });
    } catch {
      // Do not block completion when manager notification fails.
    }

    return NextResponse.json({
      report: mapReportRow(insertedReport.data),
      progress: mapProgressRow(updatedProgress),
    });
  } catch {
    return NextResponse.json({ error: "Could not complete questionnaire." }, { status: 500 });
  }
}
