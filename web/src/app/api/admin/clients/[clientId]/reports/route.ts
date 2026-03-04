import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { createClientNotification } from "@/lib/client-notifications";
import { classifyScore, resolveRisk } from "@/lib/risk";
import { isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { toRiskParameter } from "@/lib/survey-sectors";

type ClientRow = {
  client_id: string;
  company_name: string;
};

type SurveyRow = {
  id: string;
  client_id: string | null;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  k_anonymity_min: number;
};

type TopicAggregateRow = {
  topic_id: number;
  n_responses: number;
  mean_severity: number | null;
  mean_probability: number | null;
};

type GroupCountRow = {
  group_value: string;
  n_responses: number;
};

type SectorConfigRow = {
  id: string;
  key: string;
  name: string;
  risk_parameter: number | string;
  submission_count: number;
  last_submitted_at: string | null;
};

type LatestDrpsRow = {
  id: string;
  sector: string;
  reference_period: string;
  part1_probability_score: number;
  part1_probability_class: "low" | "medium" | "high";
  recommended_programs: string[];
  governance_actions: string[];
  created_at: string;
};

type ClientReportRow = {
  id: string;
  client_id: string;
  survey_id: string | null;
  report_title: string;
  status: "draft" | "processing" | "ready" | "failed";
  generated_by: string;
  summary: Record<string, unknown>;
  created_at: string;
};

const createReportSchema = z.object({
  surveyId: z.string().uuid().optional(),
  surveyIds: z.array(z.string().uuid()).min(1).max(200).optional(),
  generateAll: z.boolean().optional(),
  reportTitle: z.string().trim().min(3).max(180).optional(),
}).refine(
  (value) => Boolean(value.generateAll || value.surveyId || (value.surveyIds?.length ?? 0) > 0),
  {
    message: "At least one campaign selector must be provided.",
  },
);

function normalizeTopic(row: TopicAggregateRow) {
  const meanProbability = row.mean_probability ?? row.mean_severity;
  const severityClass = classifyScore(row.mean_severity);
  const probabilityClass = classifyScore(meanProbability);
  const risk = resolveRisk(severityClass, probabilityClass);
  return {
    topicId: row.topic_id,
    nResponses: row.n_responses,
    meanSeverity: row.mean_severity,
    meanProbability,
    severityClass,
    probabilityClass,
    risk,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeAdjustedSectorRisk(
  topics: Array<ReturnType<typeof normalizeTopic>>,
  riskParameter: number,
): { adjustedRiskIndex: number | null; adjustedRiskClass: "low" | "medium" | "high" | null } {
  const validValues = topics
    .map((topic) => topic.meanSeverity)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (validValues.length === 0) {
    return {
      adjustedRiskIndex: null,
      adjustedRiskClass: null,
    };
  }

  const meanSeverity = validValues.reduce((acc, value) => acc + value, 0) / validValues.length;
  const adjusted = Number(clamp(meanSeverity * riskParameter, 1, 5).toFixed(2));
  return {
    adjustedRiskIndex: adjusted,
    adjustedRiskClass: classifyScore(adjusted),
  };
}

async function buildReportSummaryForSurvey(params: {
  supabase: ReturnType<typeof getSupabaseAdminClient>;
  survey: SurveyRow;
}) {
  const { supabase, survey } = params;

  const [globalResult, sectorCountsResult, latestDrpsResult, sectorConfigResult] = await Promise.all([
    supabase
      .rpc("get_topic_aggregates", {
        p_survey_id: survey.id,
        p_group_key: null,
        p_group_value: null,
      })
      .returns<TopicAggregateRow[]>(),
    supabase
      .rpc("get_group_counts", {
        p_survey_id: survey.id,
        p_group_key: "sector",
      })
      .returns<GroupCountRow[]>(),
    supabase
      .from("drps_assessments")
      .select(
        "id,sector,reference_period,part1_probability_score,part1_probability_class,recommended_programs,governance_actions,created_at",
      )
      .eq("survey_id", survey.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<LatestDrpsRow[]>(),
    supabase
      .from("survey_sectors")
      .select("id,key,name,risk_parameter,submission_count,last_submitted_at")
      .eq("survey_id", survey.id)
      .eq("is_active", true)
      .returns<SectorConfigRow[]>(),
  ]);

  if (
    globalResult.error ||
    sectorCountsResult.error ||
    latestDrpsResult.error ||
    sectorConfigResult.error
  ) {
    throw new Error("Could not build report snapshot.");
  }

  const globalRows = Array.isArray(globalResult.data) ? globalResult.data : [];
  const normalizedGlobal = globalRows.map(normalizeTopic);
  const sectorCounts = Array.isArray(sectorCountsResult.data) ? sectorCountsResult.data : [];
  const sectorConfigs = Array.isArray(sectorConfigResult.data) ? sectorConfigResult.data : [];

  const riskDistribution = {
    low: normalizedGlobal.filter((item) => item.risk === "low").length,
    medium: normalizedGlobal.filter((item) => item.risk === "medium").length,
    high: normalizedGlobal.filter((item) => item.risk === "high").length,
    critical: normalizedGlobal.filter((item) => item.risk === "critical").length,
  };

  const countBySectorName = new Map<string, number>();
  for (const row of sectorCounts) {
    countBySectorName.set(row.group_value, row.n_responses);
  }

  const configByName = new Map(sectorConfigs.map((item) => [item.name, item]));
  const allSectorNames = Array.from(
    new Set([
      ...sectorConfigs.map((item) => item.name),
      ...sectorCounts.map((item) => item.group_value),
    ]),
  );

  const sectors = [] as Array<{
    sector: string;
    nResponses: number;
    suppressed: boolean;
    riskParameter: number;
    adjustedRiskIndex: number | null;
    adjustedRiskClass: "low" | "medium" | "high" | null;
    topics: Array<ReturnType<typeof normalizeTopic>>;
  }>;

  for (const sectorName of allSectorNames) {
    const config = configByName.get(sectorName);
    const nResponses = countBySectorName.get(sectorName) ?? 0;
    const suppressed = nResponses > 0 && nResponses < survey.k_anonymity_min;
    const riskParameter = config ? toRiskParameter(config.risk_parameter) : 1;

    if (suppressed || nResponses === 0) {
      sectors.push({
        sector: sectorName,
        nResponses,
        suppressed,
        riskParameter,
        adjustedRiskIndex: null,
        adjustedRiskClass: null,
        topics: [],
      });
      continue;
    }

    const groupedResult = await supabase
      .rpc("get_topic_aggregates", {
        p_survey_id: survey.id,
        p_group_key: "sector",
        p_group_value: sectorName,
      })
      .returns<TopicAggregateRow[]>();

    if (groupedResult.error) {
      throw new Error("Could not load sector topics.");
    }

    const groupedRows = Array.isArray(groupedResult.data) ? groupedResult.data : [];
    const normalizedTopics = groupedRows.map(normalizeTopic);
    const adjusted = computeAdjustedSectorRisk(normalizedTopics, riskParameter);
    sectors.push({
      sector: sectorName,
      nResponses,
      suppressed: false,
      riskParameter,
      adjustedRiskIndex: adjusted.adjustedRiskIndex,
      adjustedRiskClass: adjusted.adjustedRiskClass,
      topics: normalizedTopics,
    });
  }

  sectors.sort((a, b) => b.nResponses - a.nResponses);

  const latestDrps = Array.isArray(latestDrpsResult.data)
    ? latestDrpsResult.data[0] ?? null
    : null;

  const generatedAt = new Date().toISOString();
  const summary = {
    generatedAt,
    survey: {
      id: survey.id,
      name: survey.name,
      slug: survey.public_slug,
      status: survey.status,
      kAnonymityMin: survey.k_anonymity_min,
    },
    totals: {
      responses: globalRows[0]?.n_responses ?? 0,
      topics: normalizedGlobal.length,
      activeSectors: sectorConfigs.length,
    },
    riskDistribution,
    topics: normalizedGlobal,
    sectors,
    latestDrps,
  };

  return {
    summary,
    generatedAt,
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
  const supabase = getSupabaseAdminClient();

  const [clientResult, reportsResult] = await Promise.all([
    supabase.from("clients").select("client_id,company_name").eq("client_id", clientId).maybeSingle<ClientRow>(),
    supabase
      .from("client_reports")
      .select("id,client_id,survey_id,report_title,status,generated_by,summary,created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .returns<ClientReportRow[]>(),
  ]);

  if (clientResult.error || reportsResult.error) {
    if (!clientResult.error && isMissingTableError(reportsResult.error, "client_reports")) {
      return NextResponse.json({
        client: {
          id: clientResult.data?.client_id ?? clientId,
          companyName: clientResult.data?.company_name ?? "Client",
        },
        reports: [],
      });
    }
    return NextResponse.json({ error: "Could not load reports." }, { status: 500 });
  }
  if (!clientResult.data) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  return NextResponse.json({
    client: {
      id: clientResult.data.client_id,
      companyName: clientResult.data.company_name,
    },
    reports: reportsResult.data ?? [],
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
  let parsed: z.infer<typeof createReportSchema>;
  try {
    parsed = createReportSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("client_id,company_name")
    .eq("client_id", clientId)
    .maybeSingle<ClientRow>();

  if (clientError) {
    return NextResponse.json({ error: "Could not load client." }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const { data: surveys, error: surveysError } = await supabase
    .from("surveys")
    .select("id,client_id,name,public_slug,status,k_anonymity_min")
    .eq("client_id", clientId)
    .returns<SurveyRow[]>();

  if (surveysError) {
    return NextResponse.json({ error: "Could not load campaign." }, { status: 500 });
  }

  const surveyList = Array.isArray(surveys) ? surveys : [];
  const surveysById = new Map(surveyList.map((item) => [item.id, item]));
  const requestedIds = parsed.generateAll
    ? surveyList.map((item) => item.id)
    : parsed.surveyIds?.length
      ? parsed.surveyIds
      : parsed.surveyId
        ? [parsed.surveyId]
        : [];

  const targetSurveys = requestedIds
    .map((surveyId) => surveysById.get(surveyId))
    .filter((survey): survey is SurveyRow => Boolean(survey));

  if (targetSurveys.length === 0) {
    return NextResponse.json({ error: "Campaign not found for this client." }, { status: 404 });
  }

  const isBatch = parsed.generateAll || targetSurveys.length > 1 || Boolean(parsed.surveyIds?.length);
  const reports: ClientReportRow[] = [];
  const failures: Array<{ surveyId: string; message: string }> = [];

  for (const survey of targetSurveys) {
    try {
      const snapshot = await buildReportSummaryForSurvey({
        supabase,
        survey,
      });
      const reportTitle = parsed.reportTitle?.trim()
        ? isBatch
          ? `${parsed.reportTitle.trim()} - ${survey.name}`
          : parsed.reportTitle.trim()
        : `DRPS report ${survey.name} (${snapshot.generatedAt.slice(0, 10)})`;

      const { data: inserted, error: insertError } = await supabase
        .from("client_reports")
        .insert({
          client_id: clientId,
          survey_id: survey.id,
          report_title: reportTitle,
          status: "ready",
          generated_by: "manager",
          summary: snapshot.summary,
        })
        .select("id,client_id,survey_id,report_title,status,generated_by,summary,created_at")
        .single<ClientReportRow>();

      if (insertError || !inserted) {
        if (isMissingTableError(insertError, "client_reports")) {
          return NextResponse.json(
            {
              error:
                "Missing report table. Apply migration 20260301201000_manager_client_workspaces.sql to enable report generation.",
            },
            { status: 412 },
          );
        }
        failures.push({
          surveyId: survey.id,
          message: "Could not save generated report.",
        });
        continue;
      }

      reports.push(inserted);
    } catch (error) {
      failures.push({
        surveyId: survey.id,
        message: error instanceof Error ? error.message : "Could not generate report.",
      });
    }
  }

  try {
    if (!isBatch && reports.length === 1) {
      await createClientNotification(supabase, {
        clientId: client.client_id,
        notificationType: "manager_report_issued",
        title: `Relatorio emitido: ${reports[0].report_title}`,
        message: "O gestor emitiu um novo relatorio e ele ja esta disponivel no workspace.",
        metadata: {
          reportId: reports[0].id,
          reportTitle: reports[0].report_title,
          surveyId: reports[0].survey_id,
          generatedBy: reports[0].generated_by,
          createdAt: reports[0].created_at,
        },
      });
    } else if (reports.length > 0) {
      await createClientNotification(supabase, {
        clientId: client.client_id,
        notificationType: "manager_report_issued",
        title: `Relatorios emitidos: ${reports.length}`,
        message: `O gestor publicou ${reports.length} relatorios para ${client.company_name}.`,
        metadata: {
          reportIds: reports.map((report) => report.id),
          surveyIds: reports.map((report) => report.survey_id).filter((surveyId): surveyId is string => Boolean(surveyId)),
          generated: reports.length,
          requested: targetSurveys.length,
          failures,
        },
      });
    }
  } catch {
    // Do not block report generation when notification persistence fails.
  }

  if (reports.length === 0) {
    return NextResponse.json(
      {
        error: "Could not save generated report.",
        failures,
      },
      { status: 500 },
    );
  }

  if (!isBatch && reports.length === 1 && failures.length === 0) {
    return NextResponse.json(
      {
        report: reports[0],
      },
      { status: 201 },
    );
  }

  return NextResponse.json(
    {
      reports,
      failures,
      generated: reports.length,
      requested: targetSurveys.length,
    },
    { status: failures.length > 0 ? 207 : 200 },
  );
}
