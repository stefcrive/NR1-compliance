import type { ScoringRule } from "@/lib/scoring";

export type SurveyRow = {
  id: string;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  likert_min: number;
  likert_max: number;
  k_anonymity_min: number;
  session_ttl_minutes: number;
  turnstile_site_key: string;
  turnstile_expected_hostname: string;
  starts_at: string | null;
  closes_at: string | null;
};

export type QuestionRow = {
  id: string;
  survey_id: string;
  topic_id: number;
  question_code: string;
  position: number;
  prompt: string;
  dimension: "severity" | "probability";
  scoring_rule: ScoringRule;
  is_required: boolean;
};

export type GroupDimensionRow = {
  id: string;
  survey_id: string;
  key: string;
  label: string;
  is_required: boolean;
};

export type GroupOptionRow = {
  dimension_id: string;
  value: string;
  label: string;
  sort_order: number;
};
