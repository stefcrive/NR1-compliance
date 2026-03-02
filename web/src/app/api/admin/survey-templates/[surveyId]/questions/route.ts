import { NextRequest, NextResponse } from "next/server";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type QuestionRow = {
  id: string;
  survey_id: string;
  topic_id: number;
  question_code: string;
  position: number;
  prompt: string;
  dimension: "severity" | "probability";
  scoring_rule: "direct" | "inverted";
  is_required: boolean;
  is_active: boolean;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ surveyId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { surveyId } = await context.params;
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("questions")
    .select(
      "id,survey_id,topic_id,question_code,position,prompt,dimension,scoring_rule,is_required,is_active",
    )
    .eq("survey_id", surveyId)
    .order("position", { ascending: true })
    .returns<QuestionRow[]>();

  if (error) {
    return NextResponse.json({ error: "Could not load survey questions." }, { status: 500 });
  }

  return NextResponse.json({
    questions: (data ?? []).map((item) => ({
      id: item.id,
      surveyId: item.survey_id,
      topicId: item.topic_id,
      questionCode: item.question_code,
      position: item.position,
      prompt: item.prompt,
      dimension: item.dimension,
      scoringRule: item.scoring_rule,
      isRequired: item.is_required,
      isActive: item.is_active,
    })),
  });
}
