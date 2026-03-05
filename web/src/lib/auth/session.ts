import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_TOKEN_VERSION = "v1";

export const MANAGER_SESSION_COOKIE = "nr1_manager_session";
export const CLIENT_SESSION_COOKIE = "nr1_client_session";

export const MANAGER_SESSION_TTL_SECONDS = 60 * 60 * 12;
export const CLIENT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

type BaseSession = {
  role: "manager" | "client";
  exp: number;
};

export type ManagerSession = BaseSession & {
  role: "manager";
  email: string;
};

export type ClientSession = BaseSession & {
  role: "client";
  clientId: string;
  clientSlug: string;
  email: string;
};

function getSessionSecret(): string {
  const authSessionSecret = process.env.AUTH_SESSION_SECRET?.trim();
  if (authSessionSecret) {
    return authSessionSecret;
  }

  const fallbackSecret = process.env.FORM_SESSION_SECRET?.trim();
  if (fallbackSecret) {
    return fallbackSecret;
  }

  throw new Error("Missing AUTH_SESSION_SECRET or FORM_SESSION_SECRET.");
}

function sign(input: string): string {
  return createHmac("sha256", getSessionSecret()).update(input).digest("base64url");
}

function encodePayload(payload: BaseSession & Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload<T>(encoded: string): T | null {
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

function buildToken(payload: BaseSession & Record<string, unknown>): string {
  const payloadEncoded = encodePayload(payload);
  const signature = sign(payloadEncoded);
  return `${SESSION_TOKEN_VERSION}.${payloadEncoded}.${signature}`;
}

function parseToken(token: string): BaseSession | null {
  const [version, payloadEncoded, signature] = token.split(".");
  if (version !== SESSION_TOKEN_VERSION || !payloadEncoded || !signature) {
    return null;
  }

  const expectedSignature = sign(payloadEncoded);
  const provided = Buffer.from(signature, "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  const payload = decodePayload<BaseSession>(payloadEncoded);
  if (!payload || typeof payload.exp !== "number" || payload.exp <= Date.now()) {
    return null;
  }

  if (payload.role !== "manager" && payload.role !== "client") {
    return null;
  }

  return payload;
}

export function createManagerSessionToken(
  email: string,
  maxAgeSeconds = MANAGER_SESSION_TTL_SECONDS,
): string {
  const payload: ManagerSession = {
    role: "manager",
    email,
    exp: Date.now() + maxAgeSeconds * 1000,
  };

  return buildToken(payload);
}

export function parseManagerSessionToken(token: string | undefined): ManagerSession | null {
  if (!token) {
    return null;
  }

  const payload = parseToken(token);
  if (!payload || payload.role !== "manager") {
    return null;
  }

  const typedPayload = decodePayload<ManagerSession>(token.split(".")[1] ?? "");
  if (!typedPayload || typeof typedPayload.email !== "string" || !typedPayload.email.trim()) {
    return null;
  }

  return typedPayload;
}

export function createClientSessionToken(
  input: { clientId: string; clientSlug: string; email: string },
  maxAgeSeconds = CLIENT_SESSION_TTL_SECONDS,
): string {
  const payload: ClientSession = {
    role: "client",
    clientId: input.clientId,
    clientSlug: input.clientSlug,
    email: input.email,
    exp: Date.now() + maxAgeSeconds * 1000,
  };

  return buildToken(payload);
}

export function parseClientSessionToken(token: string | undefined): ClientSession | null {
  if (!token) {
    return null;
  }

  const payload = parseToken(token);
  if (!payload || payload.role !== "client") {
    return null;
  }

  const typedPayload = decodePayload<ClientSession>(token.split(".")[1] ?? "");
  if (
    !typedPayload ||
    typeof typedPayload.clientId !== "string" ||
    !typedPayload.clientId.trim() ||
    typeof typedPayload.clientSlug !== "string" ||
    !typedPayload.clientSlug.trim() ||
    typeof typedPayload.email !== "string" ||
    !typedPayload.email.trim()
  ) {
    return null;
  }

  return typedPayload;
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
