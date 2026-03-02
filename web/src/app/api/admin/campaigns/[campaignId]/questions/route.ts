import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

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

const updateCampaignQuestionsSchema = z.object({
  prompts: z.array(z.string().trim().min(3).max(800)).min(1).max(300),
});

function buildQuestionCode(baseCode: string, index: number) {
  const normalizedBase = baseCode.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 28) || "q";
  return `${normalizedBase}-${index + 1}-${randomUUID().slice(0, 6)}`;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ campaignId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { campaignId } = await context.params;
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("questions")
    .select(
      "id,survey_id,topic_id,question_code,position,prompt,dimension,scoring_rule,is_required,is_active",
    )
    .eq("survey_id", campaignId)
    .order("position", { ascending: true })
    .returns<QuestionRow[]>();

  if (error) {
    return NextResponse.json({ error: "Could not load campaign questions." }, { status: 500 });
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

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ campaignId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { campaignId } = await context.params;
  let parsed: z.infer<typeof updateCampaignQuestionsSchema>;
  try {
    parsed = updateCampaignQuestionsSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const prompts = parsed.prompts.map((item) => item.trim()).filter((item) => item.length > 0);
  if (prompts.length === 0) {
    return NextResponse.json({ error: "Question list is empty." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data: existing, error: loadError } = await supabase
    .from("questions")
    .select(
      "id,survey_id,topic_id,question_code,position,prompt,dimension,scoring_rule,is_required,is_active",
    )
    .eq("survey_id", campaignId)
    .order("position", { ascending: true })
    .returns<QuestionRow[]>();

  if (loadError) {
    return NextResponse.json({ error: "Could not load campaign questions." }, { status: 500 });
  }

  if (!existing || existing.length === 0) {
    return NextResponse.json({ error: "Campaign has no base questions to edit." }, { status: 404 });
  }

  const updatedCount = Math.min(existing.length, prompts.length);
  let deactivatedCount = 0;

  for (let i = 0; i < existing.length; i += 1) {
    const question = existing[i];
    const isWithinUpdatedRange = i < updatedCount;
    const payload = isWithinUpdatedRange
      ? {
          prompt: prompts[i],
          position: i + 1,
          is_active: true,
        }
      : {
          is_active: false,
        };
    const { error: updateError } = await supabase.from("questions").update(payload).eq("id", question.id);
    if (updateError) {
      return NextResponse.json({ error: "Could not update campaign questions." }, { status: 500 });
    }
    if (!isWithinUpdatedRange) {
      deactivatedCount += 1;
    }
  }

  const insertedPrompts = prompts.slice(existing.length);
  let insertedCount = 0;
  if (insertedPrompts.length > 0) {
    const templateBase = existing.at(-1) ?? existing[0];
    const payload = insertedPrompts.map((prompt, offset) => {
      const position = existing.length + offset + 1;
      return {
        survey_id: campaignId,
        topic_id: templateBase.topic_id,
        question_code: buildQuestionCode(templateBase.question_code, position),
        position,
        prompt,
        dimension: templateBase.dimension,
        scoring_rule: templateBase.scoring_rule,
        is_required: templateBase.is_required,
        is_active: true,
      };
    });
    const { error: insertError } = await supabase.from("questions").insert(payload);
    if (insertError) {
      return NextResponse.json({ error: "Could not append campaign questions." }, { status: 500 });
    }
    insertedCount = insertedPrompts.length;
  }

  return NextResponse.json({
    updated: updatedCount,
    deactivated: deactivatedCount,
    inserted: insertedCount,
    activeQuestions: prompts.length,
  });
}
