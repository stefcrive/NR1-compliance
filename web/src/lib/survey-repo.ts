import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import type {
  GroupDimensionRow,
  GroupOptionRow,
  QuestionRow,
  SurveyRow,
} from "@/lib/types";

export type SurveyForPublic = {
  survey: SurveyRow;
  questions: QuestionRow[];
  groups: Array<{
    key: string;
    label: string;
    isRequired: boolean;
    options: Array<{ value: string; label: string }>;
  }>;
};

export async function getLiveSurveyBySlug(
  slug: string,
): Promise<SurveyRow | null> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("surveys")
    .select(
      "id,name,public_slug,status,likert_min,likert_max,k_anonymity_min,session_ttl_minutes,turnstile_site_key,turnstile_expected_hostname,starts_at,closes_at",
    )
    .eq("public_slug", slug)
    .eq("status", "live")
    .maybeSingle<SurveyRow>();

  if (error) {
    throw new Error(`Failed to fetch survey: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  const now = Date.now();
  if (data.starts_at && Date.parse(data.starts_at) > now) {
    return null;
  }
  if (data.closes_at && Date.parse(data.closes_at) < now) {
    return null;
  }

  return data;
}

export async function getSurveyPublicBundle(
  surveyId: string,
): Promise<Omit<SurveyForPublic, "survey">> {
  const supabase = getSupabaseAdminClient();

  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .select(
      "id,survey_id,topic_id,question_code,position,prompt,dimension,scoring_rule,is_required",
    )
    .eq("survey_id", surveyId)
    .eq("is_active", true)
    .order("position", { ascending: true })
    .returns<QuestionRow[]>();

  if (questionsError) {
    throw new Error(`Failed to fetch questions: ${questionsError.message}`);
  }

  const { data: dimensions, error: dimensionsError } = await supabase
    .from("survey_group_dimensions")
    .select("id,survey_id,key,label,is_required")
    .eq("survey_id", surveyId)
    .order("created_at", { ascending: true })
    .returns<GroupDimensionRow[]>();

  if (dimensionsError) {
    throw new Error(`Failed to fetch group dimensions: ${dimensionsError.message}`);
  }

  const dimensionIds = (dimensions ?? []).map((item) => item.id);
  let options: GroupOptionRow[] = [];
  if (dimensionIds.length > 0) {
    const { data: optionRows, error: optionsError } = await supabase
      .from("survey_group_options")
      .select("dimension_id,value,label,sort_order")
      .in("dimension_id", dimensionIds)
      .order("sort_order", { ascending: true })
      .returns<GroupOptionRow[]>();

    if (optionsError) {
      throw new Error(`Failed to fetch group options: ${optionsError.message}`);
    }
    options = optionRows ?? [];
  }

  const optionsByDimension = new Map<string, GroupOptionRow[]>();
  for (const option of options) {
    const list = optionsByDimension.get(option.dimension_id) ?? [];
    list.push(option);
    optionsByDimension.set(option.dimension_id, list);
  }

  return {
    questions: questions ?? [],
    groups: (dimensions ?? []).map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      isRequired: dimension.is_required,
      options: (optionsByDimension.get(dimension.id) ?? []).map((option) => ({
        value: option.value,
        label: option.label,
      })),
    })),
  };
}
