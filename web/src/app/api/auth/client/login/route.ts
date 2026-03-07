import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { verifyPassword } from "@/lib/auth/password";
import {
  CLIENT_SESSION_COOKIE,
  CLIENT_SESSION_TTL_SECONDS,
  createClientSessionToken,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { slugify } from "@/lib/slug";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

const loginSchema = z.object({
  email: z.string().trim().email().max(160).optional(),
  password: z.string().max(200).optional(),
  clientSlug: z.string().trim().min(2).max(140).optional(),
  devBypass: z.boolean().optional(),
});

type ClientCredentialRow = {
  client_id: string;
  login_email: string;
  password_hash: string;
};

type ClientStatus = "Active" | "Pending" | "Inactive";
type BillingStatus = "up_to_date" | "pending" | "overdue" | "blocked";

type ClientRow = {
  client_id: string;
  portal_slug?: string | null;
  company_name?: string;
  status?: ClientStatus | null;
  billing_status?: BillingStatus | null;
};

type ClientWorkspace = {
  clientId: string;
  clientSlug: string;
  isBlocked: boolean;
};

function isClientBlocked(status: ClientStatus | null | undefined, billingStatus: BillingStatus | null | undefined) {
  return status === "Inactive" || billingStatus === "blocked";
}

async function loadClientById(clientId: string): Promise<ClientWorkspace | null> {
  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("clients")
    .select("client_id,portal_slug,company_name,status,billing_status")
    .eq("client_id", clientId)
    .maybeSingle<ClientRow>();

  if (result.error) {
    if (
      !isMissingColumnError(result.error, "portal_slug") &&
      !isMissingColumnError(result.error, "billing_status")
    ) {
      throw new Error("Could not load client workspace.");
    }

    const fallbackResult = await supabase
      .from("clients")
      .select("client_id,company_name,status")
      .eq("client_id", clientId)
      .maybeSingle<ClientRow>();

    if (fallbackResult.error || !fallbackResult.data) {
      throw new Error("Could not load client workspace.");
    }

    return {
      clientId: fallbackResult.data.client_id,
      clientSlug: slugify(fallbackResult.data.company_name ?? "client"),
      isBlocked: isClientBlocked(fallbackResult.data.status, null),
    };
  }

  if (!result.data) {
    return null;
  }

  return {
    clientId: result.data.client_id,
    clientSlug: result.data.portal_slug?.trim() || slugify(result.data.company_name ?? "client"),
    isBlocked: isClientBlocked(result.data.status, result.data.billing_status),
  };
}

async function loadClientBySlug(clientSlug: string): Promise<ClientWorkspace | null> {
  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("clients")
    .select("client_id,portal_slug,company_name,status,billing_status")
    .eq("portal_slug", clientSlug)
    .maybeSingle<ClientRow>();

  if (result.error) {
    if (
      !isMissingColumnError(result.error, "portal_slug") &&
      !isMissingColumnError(result.error, "billing_status")
    ) {
      throw new Error("Could not validate client workspace.");
    }

    const fallbackResult = await supabase
      .from("clients")
      .select("client_id,company_name,status")
      .returns<ClientRow[]>();

    if (fallbackResult.error) {
      throw new Error("Could not validate client workspace.");
    }

    const matched = (fallbackResult.data ?? []).find((item) => slugify(item.company_name ?? "") === clientSlug);
    if (!matched) {
      return null;
    }

    return {
      clientId: matched.client_id,
      clientSlug,
      isBlocked: isClientBlocked(matched.status, null),
    };
  }

  if (!result.data) {
    return null;
  }

  return {
    clientId: result.data.client_id,
    clientSlug: result.data.portal_slug?.trim() || slugify(result.data.company_name ?? "client"),
    isBlocked: isClientBlocked(result.data.status, result.data.billing_status),
  };
}

export async function POST(request: NextRequest) {
  let parsed: z.infer<typeof loginSchema>;
  try {
    parsed = loginSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const normalizedEmail = parsed.email?.trim().toLowerCase() ?? "";
  const normalizedSlug = parsed.clientSlug?.trim().toLowerCase() ?? "";
  const isDevBypass = parsed.devBypass === true && process.env.NODE_ENV !== "production";

  if (isDevBypass) {
    const targetSlug = normalizedSlug || "techcorp-brasil";
    let matchedClient: ClientWorkspace | null = null;
    try {
      matchedClient = await loadClientBySlug(targetSlug);
    } catch {
      return NextResponse.json({ error: "Could not validate client workspace." }, { status: 500 });
    }

    if (!matchedClient) {
      return NextResponse.json({ error: "Client workspace not found for this slug." }, { status: 404 });
    }
    if (matchedClient.isBlocked) {
      return NextResponse.json(
        { error: "Client access is blocked for this workspace." },
        { status: 403 },
      );
    }

    const token = createClientSessionToken(
      {
        clientId: matchedClient.clientId,
        clientSlug: matchedClient.clientSlug,
        email: normalizedEmail || "dev-client@nr1.local",
      },
      CLIENT_SESSION_TTL_SECONDS,
    );

    const response = NextResponse.json({
      redirectTo: `/client/${matchedClient.clientSlug}/company`,
    });
    response.cookies.set(
      CLIENT_SESSION_COOKIE,
      token,
      sessionCookieOptions(CLIENT_SESSION_TTL_SECONDS),
    );
    return response;
  }

  if (!normalizedEmail || !parsed.password) {
    return NextResponse.json({ error: "Enter email and password." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const credentialResult = await supabase
    .from("client_access_credentials")
    .select("client_id,login_email,password_hash")
    .eq("login_email", normalizedEmail)
    .maybeSingle<ClientCredentialRow>();

  if (credentialResult.error) {
    if (isMissingTableError(credentialResult.error, "client_access_credentials")) {
      return NextResponse.json(
        {
          error:
            "Client login is not available yet. Apply migration 20260304180000_auth_access_and_client_invites.sql.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Could not validate client credentials." }, { status: 500 });
  }

  if (!credentialResult.data) {
    return NextResponse.json({ error: "Invalid client credentials." }, { status: 401 });
  }

  const isPasswordValid = await verifyPassword(parsed.password, credentialResult.data.password_hash);
  if (!isPasswordValid) {
    return NextResponse.json({ error: "Invalid client credentials." }, { status: 401 });
  }

  let workspace: ClientWorkspace | null = null;
  try {
    workspace = await loadClientById(credentialResult.data.client_id);
  } catch {
    return NextResponse.json({ error: "Could not load client workspace." }, { status: 500 });
  }

  if (!workspace) {
    return NextResponse.json({ error: "Client workspace not found." }, { status: 404 });
  }

  if (normalizedSlug && normalizedSlug !== workspace.clientSlug) {
    return NextResponse.json(
      {
        error:
          "This login belongs to a different company workspace. Remove the slug or use the correct one.",
      },
      { status: 403 },
    );
  }
  if (workspace.isBlocked) {
    return NextResponse.json(
      { error: "Client access is blocked for this workspace." },
      { status: 403 },
    );
  }

  const token = createClientSessionToken(
    {
      clientId: workspace.clientId,
      clientSlug: workspace.clientSlug,
      email: normalizedEmail,
    },
    CLIENT_SESSION_TTL_SECONDS,
  );

  const response = NextResponse.json({
    redirectTo: `/client/${workspace.clientSlug}/company`,
  });
  response.cookies.set(
    CLIENT_SESSION_COOKIE,
    token,
    sessionCookieOptions(CLIENT_SESSION_TTL_SECONDS),
  );

  return response;
}
