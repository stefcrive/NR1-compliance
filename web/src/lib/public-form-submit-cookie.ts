const SUBMITTED_COOKIE_PREFIX = "form_submitted_";
const FALLBACK_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export function submittedCookieNameForSurvey(surveyId: string): string {
  const safeId = surveyId.replace(/[^a-zA-Z0-9]/g, "");
  return `${SUBMITTED_COOKIE_PREFIX}${safeId}`;
}

export function submittedCookieMaxAgeSeconds(closesAt: string | null): number {
  if (!closesAt) {
    return FALLBACK_MAX_AGE_SECONDS;
  }

  const closesAtMs = Date.parse(closesAt);
  if (!Number.isFinite(closesAtMs)) {
    return FALLBACK_MAX_AGE_SECONDS;
  }

  const ttlSeconds = Math.ceil((closesAtMs - Date.now()) / 1000);
  if (ttlSeconds <= 0) {
    return FALLBACK_MAX_AGE_SECONDS;
  }

  return Math.min(ttlSeconds, FALLBACK_MAX_AGE_SECONDS);
}
