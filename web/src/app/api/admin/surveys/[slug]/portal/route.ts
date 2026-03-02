import { NextRequest, NextResponse } from "next/server";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { classifyScore, resolveRisk } from "@/lib/risk";
import { isMissingTableError } from "@/lib/supabase-errors";
import { getLiveSurveyBySlug } from "@/lib/survey-repo";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

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

type TimeseriesRow = {
  day: string;
  response_count: number;
};

type DrpsSnapshotRow = {
  id: string;
  sector: string;
  reference_period: string;
  part1_probability_score: number;
  part1_probability_class: "low" | "medium" | "high";
  recommended_programs: string[];
  governance_actions: string[];
  created_at: string;
};

type SectorConfigRow = {
  id: string;
  key: string;
  name: string;
  risk_parameter: number | string;
  access_token: string;
  is_active: boolean;
  submission_count: number;
  last_submitted_at: string | null;
};

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

function toRiskParameter(value: number | string): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 1;
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

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const params = await context.params;
  const survey = await getLiveSurveyBySlug(params.slug);
  if (!survey) {
    return NextResponse.json({ error: "Survey not found." }, { status: 404 });
  }

  const supabase = getSupabaseAdminClient();

  const [globalResult, sectorCountsResult, timeseriesResult, latestDrpsResult, sectorConfigResult] =
    await Promise.all([
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
        .rpc("get_response_timeseries", {
          p_survey_id: survey.id,
          p_days: 30,
        })
        .returns<TimeseriesRow[]>(),
      supabase
        .from("drps_assessments")
        .select(
          "id,sector,reference_period,part1_probability_score,part1_probability_class,recommended_programs,governance_actions,created_at",
        )
        .eq("survey_id", survey.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .returns<DrpsSnapshotRow[]>(),
      supabase
        .from("survey_sectors")
        .select("id,key,name,risk_parameter,access_token,is_active,submission_count,last_submitted_at")
        .eq("survey_id", survey.id)
        .eq("is_active", true)
        .returns<SectorConfigRow[]>(),
    ]);

  if (
    globalResult.error ||
    sectorCountsResult.error ||
    timeseriesResult.error ||
    latestDrpsResult.error
  ) {
    return NextResponse.json({ error: "Could not load portal data." }, { status: 500 });
  }

  if (sectorConfigResult.error && !isMissingTableError(sectorConfigResult.error, "survey_sectors")) {
    return NextResponse.json({ error: "Could not load sector settings." }, { status: 500 });
  }

  const globalRows = Array.isArray(globalResult.data) ? globalResult.data : [];
  const normalizedGlobal = globalRows.map(normalizeTopic);

  const riskDistribution = {
    low: normalizedGlobal.filter((item) => item.risk === "low").length,
    medium: normalizedGlobal.filter((item) => item.risk === "medium").length,
    high: normalizedGlobal.filter((item) => item.risk === "high").length,
    critical: normalizedGlobal.filter((item) => item.risk === "critical").length,
  };

  const sectorCounts = Array.isArray(sectorCountsResult.data) ? sectorCountsResult.data : [];
  const countBySectorName = new Map<string, number>();
  for (const row of sectorCounts) {
    countBySectorName.set(row.group_value, row.n_responses);
  }

  const configuredSectors = Array.isArray(sectorConfigResult.data) ? sectorConfigResult.data : [];
  const configByName = new Map(configuredSectors.map((item) => [item.name, item]));

  const allSectorNames = Array.from(
    new Set([
      ...configuredSectors.map((item) => item.name),
      ...sectorCounts.map((item) => item.group_value),
    ]),
  );

  const groupBreakdown = [] as Array<{
    sector: string;
    sectorId: string | null;
    sectorKey: string | null;
    riskParameter: number;
    accessLink: string | null;
    submissionCount: number;
    lastSubmittedAt: string | null;
    nResponses: number;
    suppressed: boolean;
    adjustedRiskIndex: number | null;
    adjustedRiskClass: "low" | "medium" | "high" | null;
    topics: ReturnType<typeof normalizeTopic>[];
  }>;

  for (const sectorName of allSectorNames) {
    const config = configByName.get(sectorName);
    const nResponses = countBySectorName.get(sectorName) ?? 0;
    const suppressed = nResponses > 0 && nResponses < survey.k_anonymity_min;
    const riskParameter = config ? toRiskParameter(config.risk_parameter) : 1;

    if (suppressed || nResponses === 0) {
      groupBreakdown.push({
        sector: sectorName,
        sectorId: config?.id ?? null,
        sectorKey: config?.key ?? null,
        riskParameter,
        accessLink: config
          ? `${request.nextUrl.origin}/s/${survey.public_slug}?token=${encodeURIComponent(config.access_token)}`
          : null,
        submissionCount: config?.submission_count ?? 0,
        lastSubmittedAt: config?.last_submitted_at ?? null,
        nResponses,
        suppressed,
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
      return NextResponse.json({ error: "Could not load sector breakdown." }, { status: 500 });
    }

    const rows = Array.isArray(groupedResult.data) ? groupedResult.data : [];
    const normalizedTopics = rows.map(normalizeTopic);
    const adjustedRisk = computeAdjustedSectorRisk(normalizedTopics, riskParameter);

    groupBreakdown.push({
      sector: sectorName,
      sectorId: config?.id ?? null,
      sectorKey: config?.key ?? null,
      riskParameter,
      accessLink: config
        ? `${request.nextUrl.origin}/s/${survey.public_slug}?token=${encodeURIComponent(config.access_token)}`
        : null,
      submissionCount: config?.submission_count ?? 0,
      lastSubmittedAt: config?.last_submitted_at ?? null,
      nResponses,
      suppressed: false,
      adjustedRiskIndex: adjustedRisk.adjustedRiskIndex,
      adjustedRiskClass: adjustedRisk.adjustedRiskClass,
      topics: normalizedTopics,
    });
  }

  groupBreakdown.sort((a, b) => {
    if (b.nResponses !== a.nResponses) {
      return b.nResponses - a.nResponses;
    }
    return a.sector.localeCompare(b.sector, "pt-BR");
  });

  const responseTimeseries = Array.isArray(timeseriesResult.data) ? timeseriesResult.data : [];
  const latestDrps = Array.isArray(latestDrpsResult.data) ? latestDrpsResult.data[0] ?? null : null;

  return NextResponse.json({
    survey: {
      id: survey.id,
      name: survey.name,
      slug: survey.public_slug,
      kAnonymityMin: survey.k_anonymity_min,
    },
    totals: {
      responses: globalRows[0]?.n_responses ?? 0,
      topics: normalizedGlobal.length,
      activeSectors: configuredSectors.length,
    },
    riskDistribution,
    topics: normalizedGlobal,
    responseTimeseries,
    sectors: groupBreakdown,
    drps: latestDrps,
  });
}
