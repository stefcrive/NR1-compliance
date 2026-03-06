import { NextRequest, NextResponse } from "next/server";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import {
  createEmptyContinuousProgramEvaluationSummary,
  parseContinuousProgramEvaluationQuestions,
  summarizeContinuousProgramEvaluations,
} from "@/lib/continuous-program-evaluations";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type SurveyDiagnosticRow = {
  id: string;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  client_id?: string | null;
  starts_at: string | null;
  closes_at: string | null;
  created_at: string;
};

type QuestionSurveyRow = {
  survey_id: string;
};

type LegacyDiagnosticRow = {
  campaign_id: string;
  campaign_name: string;
  status: "Draft" | "Active" | "Completed";
  client_id: string;
  start_date: string;
  end_date: string | null;
};

type PeriodicProgramRow = {
  program_id: string;
  title: string;
  description: string | null;
  target_risk_topic: number | string;
  trigger_threshold: number | string;
  evaluation_questions?: unknown;
};

type ClientProgramRow = {
  client_program_id: string;
  program_id: string;
  status: "Recommended" | "Active" | "Completed";
};

type ProgramEvaluationRow = {
  client_program_id: string;
  answers: unknown;
};

function mapLegacyStatus(status: LegacyDiagnosticRow["status"]): SurveyDiagnosticRow["status"] {
  if (status === "Active") return "live";
  if (status === "Completed") return "closed";
  return "draft";
}

export async function GET(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  let drpsDiagnostics: Array<{
    id: string;
    name: string;
    slug: string;
    status: "draft" | "live" | "closed" | "archived";
    linkedClientId: string | null;
    startsAt: string | null;
    closesAt: string | null;
    createdAt: string;
    source: "surveys" | "legacy_drps_campaigns";
    questionCount: number | null;
  }> = [];

  const surveysResult = await supabase
    .from("surveys")
    .select("id,name,public_slug,status,client_id,starts_at,closes_at,created_at")
    .is("client_id", null)
    .order("created_at", { ascending: false })
    .limit(300)
    .returns<SurveyDiagnosticRow[]>();

  const surveysMissingTable = isMissingTableError(surveysResult.error, "surveys");
  const surveysMissingClientColumn = isMissingColumnError(surveysResult.error, "client_id");

  if (surveysResult.error && !surveysMissingTable && !surveysMissingClientColumn) {
    return NextResponse.json({ error: "Could not load DRPS diagnostics." }, { status: 500 });
  }

  let surveyTemplates: SurveyDiagnosticRow[] = [];
  let surveysUnavailable = surveysMissingTable;

  if (!surveysResult.error) {
    surveyTemplates = surveysResult.data ?? [];
  } else if (surveysMissingClientColumn) {
    const fallbackSurveysResult = await supabase
      .from("surveys")
      .select("id,name,public_slug,status,starts_at,closes_at,created_at")
      .order("created_at", { ascending: false })
      .limit(300)
      .returns<
        Array<{
          id: string;
          name: string;
          public_slug: string;
          status: "draft" | "live" | "closed" | "archived";
          starts_at: string | null;
          closes_at: string | null;
          created_at: string;
        }>
      >();

    if (
      fallbackSurveysResult.error &&
      !isMissingTableError(fallbackSurveysResult.error, "surveys")
    ) {
      return NextResponse.json({ error: "Could not load DRPS diagnostics." }, { status: 500 });
    }

    surveysUnavailable = isMissingTableError(fallbackSurveysResult.error, "surveys");
    surveyTemplates = (fallbackSurveysResult.data ?? []).map((item) => ({ ...item, client_id: null }));
  }

  if (!surveysUnavailable) {
    const surveyIds = surveyTemplates.map((item) => item.id);
    const questionCountBySurveyId = new Map<string, number>();

    if (surveyIds.length > 0) {
      const questionsResult = await supabase
        .from("questions")
        .select("survey_id")
        .in("survey_id", surveyIds)
        .eq("is_active", true)
        .returns<QuestionSurveyRow[]>();

      if (questionsResult.error) {
        return NextResponse.json({ error: "Could not load DRPS diagnostics." }, { status: 500 });
      }

      for (const row of questionsResult.data ?? []) {
        questionCountBySurveyId.set(
          row.survey_id,
          (questionCountBySurveyId.get(row.survey_id) ?? 0) + 1,
        );
      }
    }

    drpsDiagnostics = surveyTemplates.map((item) => ({
      id: item.id,
      name: item.name,
      slug: item.public_slug,
      status: item.status,
      linkedClientId: item.client_id ?? null,
      startsAt: item.starts_at,
      closesAt: item.closes_at,
      createdAt: item.created_at,
      source: "surveys",
      questionCount: questionCountBySurveyId.get(item.id) ?? 0,
    }));
  } else {
    const legacyResult = await supabase
      .from("drps_campaigns")
      .select("campaign_id,campaign_name,status,client_id,start_date,end_date")
      .order("start_date", { ascending: false })
      .limit(300)
      .returns<LegacyDiagnosticRow[]>();

    if (legacyResult.error && !isMissingTableError(legacyResult.error, "drps_campaigns")) {
      return NextResponse.json({ error: "Could not load DRPS diagnostics." }, { status: 500 });
    }

    drpsDiagnostics = (legacyResult.data ?? []).map((item) => ({
      id: item.campaign_id,
      name: item.campaign_name,
      slug: "",
      status: mapLegacyStatus(item.status),
      linkedClientId: item.client_id,
      startsAt: item.start_date ? new Date(item.start_date).toISOString() : null,
      closesAt: item.end_date ? new Date(item.end_date).toISOString() : null,
      createdAt: item.start_date ? new Date(item.start_date).toISOString() : new Date().toISOString(),
      source: "legacy_drps_campaigns",
      questionCount: null,
    }));
  }

  const periodicWithQuestionsResult = await supabase
    .from("periodic_programs")
    .select("program_id,title,description,target_risk_topic,trigger_threshold,evaluation_questions")
    .order("title", { ascending: true })
    .returns<PeriodicProgramRow[]>();

  const periodicResult =
    periodicWithQuestionsResult.error &&
    isMissingColumnError(periodicWithQuestionsResult.error, "evaluation_questions")
      ? await supabase
          .from("periodic_programs")
          .select("program_id,title,description,target_risk_topic,trigger_threshold")
          .order("title", { ascending: true })
          .returns<PeriodicProgramRow[]>()
      : periodicWithQuestionsResult;

  if (periodicResult.error && !isMissingTableError(periodicResult.error, "periodic_programs")) {
    return NextResponse.json({ error: "Could not load continuous programs." }, { status: 500 });
  }

  const periodicPrograms = periodicResult.data ?? [];
  const programIds = periodicPrograms.map((item) => item.program_id);
  const clientProgramsResult =
    programIds.length > 0
      ? await supabase
          .from("client_programs")
          .select("client_program_id,program_id,status")
          .in("program_id", programIds)
          .returns<ClientProgramRow[]>()
      : { data: [] as ClientProgramRow[], error: null };

  if (
    clientProgramsResult.error &&
    !isMissingTableError(clientProgramsResult.error, "client_programs")
  ) {
    return NextResponse.json({ error: "Could not load continuous programs." }, { status: 500 });
  }

  const assignmentCountByProgram = new Map<
    string,
    { total: number; recommended: number; active: number; completed: number }
  >();

  for (const row of clientProgramsResult.data ?? []) {
    const current = assignmentCountByProgram.get(row.program_id) ?? {
      total: 0,
      recommended: 0,
      active: 0,
      completed: 0,
    };
    current.total += 1;
    if (row.status === "Recommended") current.recommended += 1;
    if (row.status === "Active") current.active += 1;
    if (row.status === "Completed") current.completed += 1;
    assignmentCountByProgram.set(row.program_id, current);
  }

  const assignmentProgramById = new Map(
    (clientProgramsResult.data ?? []).map((item) => [item.client_program_id, item.program_id]),
  );
  const assignmentIds = Array.from(assignmentProgramById.keys());
  const evaluationAnswersByProgram = new Map<string, unknown[]>();
  let evaluationsUnavailable = false;

  if (assignmentIds.length > 0) {
    const evaluationsResult = await supabase
      .from("client_program_evaluations")
      .select("client_program_id,answers")
      .in("client_program_id", assignmentIds)
      .returns<ProgramEvaluationRow[]>();

    if (evaluationsResult.error) {
      if (isMissingTableError(evaluationsResult.error, "client_program_evaluations")) {
        evaluationsUnavailable = true;
      } else {
        return NextResponse.json({ error: "Could not load continuous program evaluations." }, { status: 500 });
      }
    } else {
      for (const row of evaluationsResult.data ?? []) {
        const programId = assignmentProgramById.get(row.client_program_id);
        if (!programId) continue;
        const list = evaluationAnswersByProgram.get(programId) ?? [];
        list.push(row.answers);
        evaluationAnswersByProgram.set(programId, list);
      }
    }
  }

  return NextResponse.json({
    drpsDiagnostics,
    continuousPrograms: periodicPrograms.map((item) => {
      const evaluationQuestions = parseContinuousProgramEvaluationQuestions(item.evaluation_questions);
      const evaluationSummary = evaluationsUnavailable
        ? createEmptyContinuousProgramEvaluationSummary(evaluationQuestions.length)
        : summarizeContinuousProgramEvaluations({
            answerPayloads: evaluationAnswersByProgram.get(item.program_id) ?? [],
            questionCount: evaluationQuestions.length,
          });

      return {
        id: item.program_id,
        title: item.title,
        description: item.description,
        targetRiskTopic: Number(item.target_risk_topic),
        triggerThreshold: Number(item.trigger_threshold),
        assignments: assignmentCountByProgram.get(item.program_id) ?? {
          total: 0,
          recommended: 0,
          active: 0,
          completed: 0,
        },
        evaluation: {
          submissions: evaluationSummary.submissions,
          overallAverage: evaluationSummary.overallAverage,
          unavailable: evaluationsUnavailable,
          byQuestion: evaluationQuestions.map((question, index) => ({
            question,
            average: evaluationSummary.averageByQuestion[index] ?? null,
          })),
        },
      };
    }),
  });
}
