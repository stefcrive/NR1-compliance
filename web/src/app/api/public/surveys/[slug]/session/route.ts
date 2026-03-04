import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerEnv } from "@/lib/env";
import { createFormSessionToken, verifyFormSessionToken } from "@/lib/form-session";
import { submittedCookieNameForSurvey } from "@/lib/public-form-submit-cookie";
import { filterPublicSurveyGroups } from "@/lib/public-survey-groups";
import { isMissingTableError } from "@/lib/supabase-errors";
import { getLiveSurveyBySlug, getSurveyPublicBundle } from "@/lib/survey-repo";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type SectorConfigRow = {
  id: string;
  key: string;
  name: string;
  risk_parameter: number | string;
  access_token: string;
};

const sessionRequestSchema = z.object({
  sectorToken: z.string().trim().min(8).max(256).optional(),
});

function toRiskParameter(value: number | string): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 1;
}

function canReuseSessionToken(params: {
  hasSectorRestriction: boolean;
  matchedSector: SectorConfigRow | null;
  existingSectorId?: string;
  existingSectorKey?: string;
  existingSectorName?: string;
}): boolean {
  if (params.hasSectorRestriction) {
    return (
      !!params.matchedSector &&
      params.existingSectorId === params.matchedSector.id &&
      params.existingSectorKey === params.matchedSector.key &&
      params.existingSectorName === params.matchedSector.name
    );
  }

  return !params.existingSectorId && !params.existingSectorKey && !params.existingSectorName;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const params = await context.params;
  const survey = await getLiveSurveyBySlug(params.slug);

  if (!survey) {
    return NextResponse.json({ error: "Survey not found or not active." }, { status: 404 });
  }

  let parsedBody: z.infer<typeof sessionRequestSchema> = {};
  try {
    const rawText = await request.text();
    if (rawText.trim().length > 0) {
      const parsed = sessionRequestSchema.parse(JSON.parse(rawText));
      parsedBody = parsed;
    }
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const bundle = await getSurveyPublicBundle(survey.id);
  const supabase = getSupabaseAdminClient();

  let activeSectors: SectorConfigRow[] = [];
  const { data: sectorRows, error: sectorsError } = await supabase
    .from("survey_sectors")
    .select("id,key,name,risk_parameter,access_token")
    .eq("survey_id", survey.id)
    .eq("is_active", true)
    .returns<SectorConfigRow[]>();

  if (sectorsError && !isMissingTableError(sectorsError, "survey_sectors")) {
    return NextResponse.json({ error: "Could not load campaign sectors." }, { status: 500 });
  }

  if (Array.isArray(sectorRows)) {
    activeSectors = sectorRows;
  }

  const hasSectorRestriction = activeSectors.length > 0;
  const providedSectorToken = parsedBody.sectorToken?.trim();

  if (hasSectorRestriction && !providedSectorToken) {
    return NextResponse.json(
      { error: "Missing sector token for this campaign." },
      { status: 400 },
    );
  }

  const matchedSector =
    hasSectorRestriction && providedSectorToken
      ? activeSectors.find((item) => item.access_token === providedSectorToken) ?? null
      : null;

  if (hasSectorRestriction && !matchedSector) {
    return NextResponse.json(
      { error: "Invalid or inactive sector token." },
      { status: 401 },
    );
  }

  const env = getServerEnv();
  const cookieStore = await cookies();
  const existingToken = cookieStore.get("form_session")?.value;
  const existingSessionPayload = existingToken
    ? verifyFormSessionToken({
        token: existingToken,
        expectedSurveyId: survey.id,
        secret: env.formSessionSecret,
      })
    : null;

  const reusableSessionSid =
    existingSessionPayload &&
    canReuseSessionToken({
      hasSectorRestriction,
      matchedSector,
      existingSectorId: existingSessionPayload.sectorId,
      existingSectorKey: existingSessionPayload.sectorKey,
      existingSectorName: existingSessionPayload.sectorName,
    })
      ? existingSessionPayload.sid
      : undefined;

  const tokenData = createFormSessionToken({
    sid: reusableSessionSid,
    surveyId: survey.id,
    sectorId: matchedSector?.id,
    sectorKey: matchedSector?.key,
    sectorName: matchedSector?.name,
    sectorRiskParameter: matchedSector ? toRiskParameter(matchedSector.risk_parameter) : undefined,
    ttlMinutes: survey.session_ttl_minutes,
    secret: env.formSessionSecret,
  });

  cookieStore.set({
    name: "form_session",
    value: tokenData.token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: survey.session_ttl_minutes * 60,
  });

  const submittedCookieName = submittedCookieNameForSurvey(survey.id);
  const submittedSid = cookieStore.get(submittedCookieName)?.value;

  return NextResponse.json({
    surveyId: survey.id,
    slug: survey.public_slug,
    sessionSid: tokenData.payload.sid,
    linkType: matchedSector ? "sector" : "general",
    alreadySubmitted: submittedSid === tokenData.payload.sid,
    title: survey.name,
    likert: {
      min: survey.likert_min,
      max: survey.likert_max,
    },
    kAnonymityMin: survey.k_anonymity_min,
    turnstileSiteKey: survey.turnstile_site_key,
    lockedSector: matchedSector
      ? {
          id: matchedSector.id,
          key: matchedSector.key,
          name: matchedSector.name,
          riskParameter: toRiskParameter(matchedSector.risk_parameter),
        }
      : null,
    groups: filterPublicSurveyGroups(bundle.groups),
    questions: bundle.questions.map((question) => ({
      id: question.id,
      topicId: question.topic_id,
      code: question.question_code,
      position: question.position,
      prompt: question.prompt,
      dimension: question.dimension,
      required: question.is_required,
    })),
  });
}
