import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getServerEnv } from "@/lib/env";
import { verifyFormSessionToken } from "@/lib/form-session";
import { extractTrustedIp, hashIp } from "@/lib/ip";
import { submittedCookieMaxAgeSeconds, submittedCookieNameForSurvey } from "@/lib/public-form-submit-cookie";
import { filterPublicSurveyGroups, sanitizePublicGroupValues } from "@/lib/public-survey-groups";
import { correctedScore } from "@/lib/scoring";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getLiveSurveyBySlug, getSurveyPublicBundle } from "@/lib/survey-repo";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { verifyTurnstileToken } from "@/lib/turnstile";

const submitSchema = z.object({
  campaignId: z.string().uuid().optional(),
  turnstileToken: z.string().trim().optional(),
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        value: z.number(),
      }),
    )
    .min(1),
  groups: z.record(z.string(), z.string()).optional(),
});

type RateLimitResult = {
  allowed: boolean;
  minute_hits: number;
  hour_hits: number;
};

type SectorSessionRow = {
  id: string;
  key: string;
  name: string;
  risk_parameter: number | string;
};

function toRiskParameter(value: number | string): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 1;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const params = await context.params;
  const survey = await getLiveSurveyBySlug(params.slug);

  if (!survey) {
    return NextResponse.json({ error: "Survey not found or not active." }, { status: 404 });
  }

  let parsedBody: z.infer<typeof submitSchema>;
  try {
    parsedBody = submitSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (parsedBody.campaignId && parsedBody.campaignId !== survey.id) {
    return NextResponse.json({ error: "Campaign mismatch." }, { status: 400 });
  }

  const token = request.cookies.get("form_session")?.value;
  if (!token) {
    return NextResponse.json({ error: "Missing form session." }, { status: 401 });
  }

  const env = getServerEnv();
  const formSession = verifyFormSessionToken({
    token,
    expectedSurveyId: survey.id,
    secret: env.formSessionSecret,
  });
  if (!formSession) {
    return NextResponse.json({ error: "Invalid or expired form session." }, { status: 401 });
  }

  const submittedCookieName = submittedCookieNameForSurvey(survey.id);
  const submittedSessionSid = request.cookies.get(submittedCookieName)?.value;
  if (submittedSessionSid === formSession.sid) {
    return NextResponse.json(
      { error: "This form session has already been submitted." },
      { status: 409 },
    );
  }

  const supabase = getSupabaseAdminClient();
  const { data: existingRows, error: existingRowsError } = await supabase
    .from("responses")
    .select("id")
    .eq("survey_id", survey.id)
    .eq("session_sid", formSession.sid)
    .limit(1)
    .returns<Array<{ id: string }>>();

  if (existingRowsError && !isMissingTableError(existingRowsError, "responses")) {
    return NextResponse.json({ error: "Could not verify submission state." }, { status: 500 });
  }
  if ((existingRows ?? []).length > 0) {
    return NextResponse.json(
      { error: "This form session has already been submitted." },
      { status: 409 },
    );
  }

  const clientIp = extractTrustedIp(request.headers);
  const ipHash = hashIp(clientIp, env.ipHashSecret);

  const turnstile = await verifyTurnstileToken({
    token: parsedBody.turnstileToken ?? "",
    expectedHostname: survey.turnstile_expected_hostname,
    remoteIp: clientIp,
  });
  if (!turnstile.success) {
    return NextResponse.json(
      { error: "Turnstile verification failed.", codes: turnstile.errorCodes },
      { status: 401 },
    );
  }

  let activeSectors: SectorSessionRow[] = [];
  const { data: activeSectorRows, error: activeSectorError } = await supabase
    .from("survey_sectors")
    .select("id,key,name,risk_parameter")
    .eq("survey_id", survey.id)
    .eq("is_active", true)
    .returns<SectorSessionRow[]>();

  const sectorFeatureAvailable = !isMissingTableError(activeSectorError, "survey_sectors");
  if (activeSectorError && sectorFeatureAvailable) {
    return NextResponse.json({ error: "Could not validate sector configuration." }, { status: 500 });
  }

  if (Array.isArray(activeSectorRows)) {
    activeSectors = activeSectorRows;
  }

  const hasSectorRestriction = activeSectors.length > 0;
  const matchedSector =
    hasSectorRestriction && formSession.sectorId
      ? activeSectors.find(
          (item) =>
            item.id === formSession.sectorId &&
            item.key === formSession.sectorKey &&
            item.name === formSession.sectorName,
        ) ?? null
      : null;

  if (hasSectorRestriction && !matchedSector) {
    return NextResponse.json({ error: "Missing or invalid sector session context." }, { status: 401 });
  }

  const { data: rateLimitRows, error: rateLimitError } = await supabase
    .rpc("check_rate_limit", {
      p_survey_id: survey.id,
      p_ip_hash: ipHash,
      p_burst_limit: 5,
      p_hour_limit: 30,
    })
    .returns<RateLimitResult[]>();

  if (rateLimitError) {
    return NextResponse.json({ error: "Rate limit check failed." }, { status: 500 });
  }

  const rateLimitData = Array.isArray(rateLimitRows) ? rateLimitRows : [];
  const rateLimit = rateLimitData[0];
  if (!rateLimit || !rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "Too many submissions from this network. Please try again later.",
        minuteHits: rateLimit?.minute_hits ?? null,
        hourHits: rateLimit?.hour_hits ?? null,
      },
      { status: 429 },
    );
  }

  const bundle = await getSurveyPublicBundle(survey.id);
  const publicGroups = filterPublicSurveyGroups(bundle.groups);
  const questionById = new Map(bundle.questions.map((question) => [question.id, question]));

  const groupValues = sanitizePublicGroupValues(parsedBody.groups ?? {});
  for (const groupDefinition of publicGroups) {
    const selected =
      groupDefinition.key === "sector" && matchedSector
        ? matchedSector.name
        : groupValues[groupDefinition.key];
    if (groupDefinition.isRequired && !selected) {
      return NextResponse.json(
        { error: `Missing required group field: ${groupDefinition.key}` },
        { status: 400 },
      );
    }

    if (selected) {
      if (groupDefinition.key === "sector" && matchedSector) {
        continue;
      }
      const isKnownValue = groupDefinition.options.some((option) => option.value === selected);
      if (!isKnownValue) {
        return NextResponse.json(
          { error: `Invalid value for group field: ${groupDefinition.key}` },
          { status: 400 },
        );
      }
    }
  }

  const effectiveGroupValues: Record<string, string | number> = {
    ...groupValues,
  };
  if (matchedSector) {
    effectiveGroupValues.sector = matchedSector.name;
    effectiveGroupValues.sector_key = matchedSector.key;
    effectiveGroupValues.sector_risk_parameter =
      formSession.sectorRiskParameter ?? toRiskParameter(matchedSector.risk_parameter);
  }

  const submittedQuestionIds = new Set<string>();
  for (const answer of parsedBody.answers) {
    if (submittedQuestionIds.has(answer.questionId)) {
      return NextResponse.json({ error: "Duplicate question in payload." }, { status: 400 });
    }
    submittedQuestionIds.add(answer.questionId);
  }

  const requiredQuestionIds = bundle.questions
    .filter((question) => question.is_required)
    .map((question) => question.id);

  for (const questionId of requiredQuestionIds) {
    if (!submittedQuestionIds.has(questionId)) {
      return NextResponse.json({ error: "Missing required answers." }, { status: 400 });
    }
  }

  let normalizedAnswers: Array<{ questionId: string; raw: number; corrected: number }>;
  try {
    normalizedAnswers = parsedBody.answers.map((answer) => {
      const question = questionById.get(answer.questionId);
      if (!question) {
        throw new Error("Question does not belong to survey.");
      }
      if (
        answer.value < survey.likert_min ||
        answer.value > survey.likert_max ||
        !Number.isFinite(answer.value)
      ) {
        throw new Error("Answer value out of range.");
      }

      const corrected = correctedScore({
        raw: answer.value,
        scoringRule: question.scoring_rule,
        likertMin: survey.likert_min,
        likertMax: survey.likert_max,
      });

      return {
        questionId: answer.questionId,
        raw: answer.value,
        corrected,
      };
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid answers." },
      { status: 400 },
    );
  }

  const responsePayload: {
    survey_id: string;
    submitted_at: string;
    session_sid: string;
    ip_hash: string;
    group_values: Record<string, string | number>;
    answers_json: Array<{ question_id: string; value: number }>;
    sector_id?: string | null;
  } = {
    survey_id: survey.id,
    submitted_at: new Date().toISOString(),
    session_sid: formSession.sid,
    ip_hash: ipHash,
    group_values: effectiveGroupValues,
    answers_json: parsedBody.answers.map((answer) => ({
      question_id: answer.questionId,
      value: answer.value,
    })),
  };

  if (sectorFeatureAvailable) {
    responsePayload.sector_id = matchedSector?.id ?? null;
  }

  let { data: responseInserted, error: responseError } = await supabase
    .from("responses")
    .insert(responsePayload)
    .select("id,submitted_at")
    .single<{ id: string; submitted_at: string }>();

  if (responseError && isMissingColumnError(responseError, "sector_id")) {
    const fallbackPayload = {
      survey_id: survey.id,
      submitted_at: responsePayload.submitted_at,
      session_sid: responsePayload.session_sid,
      ip_hash: responsePayload.ip_hash,
      group_values: responsePayload.group_values,
      answers_json: responsePayload.answers_json,
    };

    const fallbackResult = await supabase
      .from("responses")
      .insert(fallbackPayload)
      .select("id,submitted_at")
      .single<{ id: string; submitted_at: string }>();

    responseInserted = fallbackResult.data ?? null;
    responseError = fallbackResult.error;
  }

  if (responseError || !responseInserted) {
    return NextResponse.json({ error: "Could not save response." }, { status: 500 });
  }

  const { error: answersError } = await supabase.from("answers").insert(
    normalizedAnswers.map((answer) => ({
      response_id: responseInserted.id,
      question_id: answer.questionId,
      raw_value: answer.raw,
      corrected_value: answer.corrected,
    })),
  );

  if (answersError) {
    await supabase.from("responses").delete().eq("id", responseInserted.id);
    return NextResponse.json({ error: "Could not save answers." }, { status: 500 });
  }

  if (matchedSector) {
    await supabase.rpc("bump_sector_submission", {
      p_sector_id: matchedSector.id,
    });
  }

  const response = NextResponse.json({
    ok: true,
    submittedAt: responseInserted.submitted_at,
  });
  response.cookies.set({
    name: submittedCookieName,
    value: formSession.sid,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: submittedCookieMaxAgeSeconds(survey.closes_at),
  });
  return response;
}
