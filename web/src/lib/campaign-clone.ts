import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type SourceQuestionRow = {
  topic_id: number;
  question_code: string;
  position: number;
  prompt: string;
  dimension: "severity" | "probability";
  scoring_rule: "direct" | "inverted";
  is_required: boolean;
  source_excel_col: string | null;
  is_active: boolean;
};

type SourceDimensionRow = {
  id: string;
  key: string;
  label: string;
  is_required: boolean;
};

type SourceOptionRow = {
  dimension_id: string;
  value: string;
  label: string;
  sort_order: number;
};

type InsertedDimensionRow = {
  id: string;
  key: string;
};

export async function cloneSurveyStructure(params: {
  sourceSurveyId: string;
  targetSurveyId: string;
}) {
  const supabase = getSupabaseAdminClient();

  const { data: sourceQuestions, error: sourceQuestionsError } = await supabase
    .from("questions")
    .select(
      "topic_id,question_code,position,prompt,dimension,scoring_rule,is_required,source_excel_col,is_active",
    )
    .eq("survey_id", params.sourceSurveyId)
    .order("position", { ascending: true })
    .returns<SourceQuestionRow[]>();

  if (sourceQuestionsError) {
    throw new Error(sourceQuestionsError.message);
  }

  if (sourceQuestions && sourceQuestions.length > 0) {
    const { error: insertQuestionsError } = await supabase.from("questions").insert(
      sourceQuestions.map((item) => ({
        survey_id: params.targetSurveyId,
        topic_id: item.topic_id,
        question_code: item.question_code,
        position: item.position,
        prompt: item.prompt,
        dimension: item.dimension,
        scoring_rule: item.scoring_rule,
        is_required: item.is_required,
        source_excel_col: item.source_excel_col,
        is_active: item.is_active,
      })),
    );

    if (insertQuestionsError) {
      throw new Error(insertQuestionsError.message);
    }
  }

  const { data: sourceDimensions, error: sourceDimensionsError } = await supabase
    .from("survey_group_dimensions")
    .select("id,key,label,is_required")
    .eq("survey_id", params.sourceSurveyId)
    .returns<SourceDimensionRow[]>();

  if (sourceDimensionsError) {
    throw new Error(sourceDimensionsError.message);
  }

  if (!sourceDimensions || sourceDimensions.length === 0) {
    return;
  }

  const { data: insertedDimensions, error: insertedDimensionsError } = await supabase
    .from("survey_group_dimensions")
    .insert(
      sourceDimensions.map((item) => ({
        survey_id: params.targetSurveyId,
        key: item.key,
        label: item.label,
        is_required: item.is_required,
      })),
    )
    .select("id,key")
    .returns<InsertedDimensionRow[]>();

  if (insertedDimensionsError) {
    throw new Error(insertedDimensionsError.message);
  }

  const { data: sourceOptions, error: sourceOptionsError } = await supabase
    .from("survey_group_options")
    .select("dimension_id,value,label,sort_order")
    .in(
      "dimension_id",
      sourceDimensions.map((item) => item.id),
    )
    .returns<SourceOptionRow[]>();

  if (sourceOptionsError) {
    throw new Error(sourceOptionsError.message);
  }

  const idByKey = new Map((insertedDimensions ?? []).map((item) => [item.key, item.id]));
  const keyByOldId = new Map(sourceDimensions.map((item) => [item.id, item.key]));

  if (sourceOptions && sourceOptions.length > 0) {
    const payload = sourceOptions
      .map((option) => {
        const key = keyByOldId.get(option.dimension_id);
        if (!key) {
          return null;
        }
        const newDimensionId = idByKey.get(key);
        if (!newDimensionId) {
          return null;
        }
        return {
          dimension_id: newDimensionId,
          value: option.value,
          label: option.label,
          sort_order: option.sort_order,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (payload.length > 0) {
      const { error: insertOptionsError } = await supabase
        .from("survey_group_options")
        .insert(payload);
      if (insertOptionsError) {
        throw new Error(insertOptionsError.message);
      }
    }
  }
}