import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { deriveDrps } from "@/lib/drps";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

const part1AnswerSchema = z.object({
  key: z.string().min(2),
  label: z.string().min(2),
  score: z.number().min(1).max(5),
});

const submitDrpsSchema = z.object({
  surveyId: z.string().uuid(),
  sector: z.string().min(2).max(120),
  psychologistName: z.string().min(2).max(120),
  psychologistCrp: z.string().max(50).optional(),
  companyName: z.string().min(2).max(140),
  companyCnpj: z.string().max(30).optional(),
  referencePeriod: z.string().min(4).max(80),
  part1Answers: z.array(part1AnswerSchema).min(10),
  criticalTopics: z.array(z.number().int().min(1).max(13)).default([]),
  governanceActions: z.array(z.string().min(2).max(220)).default([]),
  notes: z.string().max(5000).optional(),
});

type DrpsAssessmentRow = {
  id: string;
  survey_id: string;
  sector: string;
  psychologist_name: string;
  psychologist_crp: string | null;
  company_name: string;
  company_cnpj: string | null;
  reference_period: string;
  part1_answers: Array<{ key: string; label: string; score: number }>;
  part1_dimension_scores: {
    frequency: number;
    history: number;
    resources: number;
    resourcesRisk: number;
  };
  part1_probability_score: number;
  part1_probability_class: "low" | "medium" | "high";
  critical_topics: number[];
  recommended_programs: string[];
  governance_actions: string[];
  notes: string | null;
  created_at: string;
};

export async function GET(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const surveyId = request.nextUrl.searchParams.get("surveyId");
  if (!surveyId) {
    return NextResponse.json({ error: "Missing surveyId query param." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("drps_assessments")
    .select(
      "id,survey_id,sector,psychologist_name,psychologist_crp,company_name,company_cnpj,reference_period,part1_answers,part1_dimension_scores,part1_probability_score,part1_probability_class,critical_topics,recommended_programs,governance_actions,notes,created_at",
    )
    .eq("survey_id", surveyId)
    .order("created_at", { ascending: false })
    .returns<DrpsAssessmentRow[]>();

  if (error) {
    return NextResponse.json({ error: "Could not load DRPS assessments." }, { status: 500 });
  }

  const rows = Array.isArray(data) ? data : [];
  return NextResponse.json({
    latest: rows[0] ?? null,
    items: rows,
  });
}

export async function POST(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let parsed: z.infer<typeof submitDrpsSchema>;
  try {
    parsed = submitDrpsSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const derived = deriveDrps({
    part1Answers: parsed.part1Answers,
    criticalTopics: parsed.criticalTopics,
  });

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("drps_assessments")
    .insert({
      survey_id: parsed.surveyId,
      sector: parsed.sector,
      psychologist_name: parsed.psychologistName,
      psychologist_crp: parsed.psychologistCrp ?? null,
      company_name: parsed.companyName,
      company_cnpj: parsed.companyCnpj ?? null,
      reference_period: parsed.referencePeriod,
      part1_answers: parsed.part1Answers,
      part1_dimension_scores: derived.dimensionScores,
      part1_probability_score: derived.probabilityScore,
      part1_probability_class: derived.probabilityClass,
      critical_topics: parsed.criticalTopics,
      recommended_programs: derived.recommendedPrograms,
      governance_actions: parsed.governanceActions,
      notes: parsed.notes ?? null,
    })
    .select(
      "id,survey_id,sector,reference_period,part1_probability_score,part1_probability_class,recommended_programs,created_at",
    )
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Could not save DRPS assessment." }, { status: 500 });
  }

  return NextResponse.json(
    {
      item: data,
      derived,
    },
    { status: 201 },
  );
}
