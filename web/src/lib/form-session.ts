import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const TOKEN_HEADER = {
  alg: "HS256",
  typ: "JWT",
} as const;

export type FormSessionPayload = {
  sid: string;
  surveyId: string;
  sectorId?: string;
  sectorKey?: string;
  sectorName?: string;
  sectorRiskParameter?: number;
  iat: number;
  exp: number;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(input)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function createFormSessionToken(params: {
  sid?: string;
  surveyId: string;
  sectorId?: string;
  sectorKey?: string;
  sectorName?: string;
  sectorRiskParameter?: number;
  ttlMinutes: number;
  secret: string;
}): { token: string; payload: FormSessionPayload } {
  const now = Math.floor(Date.now() / 1000);
  const payload: FormSessionPayload = {
    sid: params.sid ?? randomUUID(),
    surveyId: params.surveyId,
    sectorId: params.sectorId,
    sectorKey: params.sectorKey,
    sectorName: params.sectorName,
    sectorRiskParameter: params.sectorRiskParameter,
    iat: now,
    exp: now + params.ttlMinutes * 60,
  };

  const headerEncoded = base64UrlEncode(JSON.stringify(TOKEN_HEADER));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signedInput = `${headerEncoded}.${payloadEncoded}`;
  const signature = sign(signedInput, params.secret);

  return {
    token: `${signedInput}.${signature}`,
    payload,
  };
}

export function verifyFormSessionToken(params: {
  token: string;
  expectedSurveyId: string;
  secret: string;
}): FormSessionPayload | null {
  const parts = params.token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [headerEncoded, payloadEncoded, signature] = parts;
  const signedInput = `${headerEncoded}.${payloadEncoded}`;
  const expectedSignature = sign(signedInput, params.secret);

  try {
    const left = Buffer.from(signature);
    const right = Buffer.from(expectedSignature);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      return null;
    }

    const payloadRaw = base64UrlDecode(payloadEncoded);
    const payload = JSON.parse(payloadRaw) as FormSessionPayload;

    if (!payload.sid || !payload.surveyId || !payload.iat || !payload.exp) {
      return null;
    }
    if (
      payload.sectorRiskParameter !== undefined &&
      (!Number.isFinite(payload.sectorRiskParameter) || payload.sectorRiskParameter <= 0)
    ) {
      return null;
    }
    if (payload.surveyId !== params.expectedSurveyId) {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
