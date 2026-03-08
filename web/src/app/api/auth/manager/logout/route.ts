import { NextResponse } from "next/server";

import { MANAGER_SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

export async function POST() {
  const response = NextResponse.json({ redirectTo: "/access/manager" });
  response.cookies.set(MANAGER_SESSION_COOKIE, "", {
    ...sessionCookieOptions(0),
    maxAge: 0,
  });
  return response;
}
