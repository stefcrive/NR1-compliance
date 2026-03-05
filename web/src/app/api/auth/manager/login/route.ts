import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  MANAGER_SESSION_COOKIE,
  MANAGER_SESSION_TTL_SECONDS,
  createManagerSessionToken,
  sessionCookieOptions,
} from "@/lib/auth/session";

const loginSchema = z.object({
  email: z.string().trim().email().max(160).optional(),
  password: z.string().max(200).optional(),
  devBypass: z.boolean().optional(),
});

const DEV_MANAGER_EMAIL = "manager@nr1.local";
const DEV_MANAGER_PASSWORD = "dev-manager";

function resolveManagerCredentials(): { email: string; password: string } {
  const managerEmail = process.env.MANAGER_LOGIN_EMAIL?.trim() ?? "";
  const managerPassword = process.env.MANAGER_LOGIN_PASSWORD ?? "";
  if (managerEmail && managerPassword) {
    return {
      email: managerEmail.toLowerCase(),
      password: managerPassword,
    };
  }

  if (process.env.NODE_ENV !== "production") {
    return {
      email: DEV_MANAGER_EMAIL,
      password: DEV_MANAGER_PASSWORD,
    };
  }

  throw new Error("Manager credentials are not configured.");
}

export async function POST(request: NextRequest) {
  let parsed: z.infer<typeof loginSchema>;
  try {
    parsed = loginSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const normalizedEmail = parsed.email?.trim().toLowerCase() ?? "";
  const isDevBypass = parsed.devBypass === true && process.env.NODE_ENV !== "production";

  let managerCredentials: { email: string; password: string };
  try {
    managerCredentials = resolveManagerCredentials();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Manager credentials are not configured.",
      },
      { status: 500 },
    );
  }

  if (!isDevBypass) {
    if (!normalizedEmail || !parsed.password) {
      return NextResponse.json({ error: "Enter email and password." }, { status: 400 });
    }

    const validEmail = normalizedEmail === managerCredentials.email;
    const validPassword = parsed.password === managerCredentials.password;

    if (!validEmail || !validPassword) {
      return NextResponse.json({ error: "Invalid manager credentials." }, { status: 401 });
    }
  }

  const sessionEmail = normalizedEmail || managerCredentials.email;
  const token = createManagerSessionToken(sessionEmail, MANAGER_SESSION_TTL_SECONDS);

  const response = NextResponse.json({ redirectTo: "/manager/clients" });
  response.cookies.set(
    MANAGER_SESSION_COOKIE,
    token,
    sessionCookieOptions(MANAGER_SESSION_TTL_SECONDS),
  );

  return response;
}
