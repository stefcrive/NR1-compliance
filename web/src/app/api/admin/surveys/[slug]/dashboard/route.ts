import { NextRequest, NextResponse } from "next/server";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { classifyScore, resolveRisk } from "@/lib/risk";
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

function enrichTopicRow(row: TopicAggregateRow) {
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

  const groupKey = request.nextUrl.searchParams.get("groupKey");
  const supabase = getSupabaseAdminClient();

  const { data: globalRows, error: globalError } = await supabase
    .rpc("get_topic_aggregates", {
      p_survey_id: survey.id,
      p_group_key: null,
      p_group_value: null,
    })
    .returns<TopicAggregateRow[]>();

  if (globalError) {
    return NextResponse.json({ error: "Could not load topic aggregates." }, { status: 500 });
  }

  const globalData = Array.isArray(globalRows) ? globalRows : [];
  const result = {
    survey: {
      id: survey.id,
      slug: survey.public_slug,
      name: survey.name,
      kAnonymityMin: survey.k_anonymity_min,
    },
    global: globalData.map(enrichTopicRow),
    groups: [] as Array<{
      groupKey: string;
      groupValue: string;
      nResponses: number;
      suppressed: boolean;
      topics: ReturnType<typeof enrichTopicRow>[];
    }>,
  };

  if (!groupKey) {
    return NextResponse.json(result);
  }

  const { data: groupCounts, error: groupCountsError } = await supabase
    .rpc("get_group_counts", {
      p_survey_id: survey.id,
      p_group_key: groupKey,
    })
    .returns<GroupCountRow[]>();

  if (groupCountsError) {
    return NextResponse.json({ error: "Could not load group breakdown." }, { status: 500 });
  }

  const groupCountData = Array.isArray(groupCounts) ? groupCounts : [];

  for (const group of groupCountData) {
    const suppressed = group.n_responses < survey.k_anonymity_min;
    if (suppressed) {
      result.groups.push({
        groupKey,
        groupValue: group.group_value,
        nResponses: group.n_responses,
        suppressed: true,
        topics: [],
      });
      continue;
    }

    const { data: topicRows, error: topicError } = await supabase
      .rpc("get_topic_aggregates", {
        p_survey_id: survey.id,
        p_group_key: groupKey,
        p_group_value: group.group_value,
      })
      .returns<TopicAggregateRow[]>();

    if (topicError) {
      return NextResponse.json({ error: "Could not load grouped aggregates." }, { status: 500 });
    }

    const topicData = Array.isArray(topicRows) ? topicRows : [];
    result.groups.push({
      groupKey,
      groupValue: group.group_value,
      nResponses: group.n_responses,
      suppressed: false,
      topics: topicData.map(enrichTopicRow),
    });
  }

  return NextResponse.json(result);
}
