import { NextRequest, NextResponse } from "next/server";

import {
  CLIENT_SESSION_COOKIE,
  parseClientSessionToken,
  sessionCookieOptions,
} from "@/lib/auth/session";

type LogoutPayload = {
  clientSlug?: string;
};

async function readPayload(request: NextRequest): Promise<LogoutPayload> {
  try {
    const parsed = (await request.json()) as LogoutPayload;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function POST(request: NextRequest) {
  const payload = await readPayload(request);
  const session = parseClientSessionToken(request.cookies.get(CLIENT_SESSION_COOKIE)?.value);
  const payloadSlug = typeof payload.clientSlug === "string" ? payload.clientSlug.trim().toLowerCase() : "";
  const targetSlug = session?.clientSlug ?? payloadSlug;
  const redirectTo = targetSlug
    ? `/access/client?clientSlug=${encodeURIComponent(targetSlug)}`
    : "/access/client";

  const response = NextResponse.json({ redirectTo });
  response.cookies.set(CLIENT_SESSION_COOKIE, "", {
    ...sessionCookieOptions(0),
    maxAge: 0,
  });
  return response;
}
