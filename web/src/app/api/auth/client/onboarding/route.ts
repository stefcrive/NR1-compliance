import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { hashPassword } from "@/lib/auth/password";
import {
  CLIENT_SESSION_COOKIE,
  CLIENT_SESSION_TTL_SECONDS,
  createClientSessionToken,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { slugify } from "@/lib/slug";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

const tokenSchema = z.string().trim().min(16).max(200).regex(/^[a-zA-Z0-9]+$/);

const createCredentialsSchema = z.object({
  token: tokenSchema,
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(200),
});

type InvitationRow = {
  id: string;
  client_id: string;
  invitation_token: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

type CredentialRow = {
  client_id: string;
  login_email: string;
};

type ClientRow = {
  client_id: string;
  company_name: string;
  portal_slug?: string | null;
  status?: "Active" | "Pending" | "Inactive" | null;
  billing_status?: "up_to_date" | "pending" | "overdue" | "blocked" | null;
};

type InvitationState = {
  invitation: InvitationRow;
  clientId: string;
  companyName: string;
  clientSlug: string;
  isBlocked: boolean;
  hasCredentials: boolean;
  loginEmail: string | null;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
};

function inferInvitationStatus(invitation: InvitationRow): InvitationState["status"] {
  if (invitation.revoked_at || invitation.status === "revoked") {
    return "revoked";
  }
  if (invitation.accepted_at || invitation.status === "accepted") {
    return "accepted";
  }

  const expiresAtMs = Date.parse(invitation.expires_at);
  if (Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) {
    return "expired";
  }

  if (invitation.status === "expired") {
    return "expired";
  }

  return "pending";
}

function isClientBlocked(
  status: "Active" | "Pending" | "Inactive" | null | undefined,
  billingStatus: "up_to_date" | "pending" | "overdue" | "blocked" | null | undefined,
) {
  return status === "Inactive" || billingStatus === "blocked";
}

async function loadClientById(
  clientId: string,
): Promise<{ companyName: string; clientSlug: string; isBlocked: boolean } | null> {
  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("clients")
    .select("client_id,company_name,portal_slug,status,billing_status")
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
      companyName: fallbackResult.data.company_name,
      clientSlug: slugify(fallbackResult.data.company_name),
      isBlocked: isClientBlocked(fallbackResult.data.status, null),
    };
  }

  if (!result.data) {
    return null;
  }

  return {
    companyName: result.data.company_name,
    clientSlug: result.data.portal_slug?.trim() || slugify(result.data.company_name),
    isBlocked: isClientBlocked(result.data.status, result.data.billing_status),
  };
}

async function loadInvitationState(token: string): Promise<InvitationState | null> {
  const supabase = getSupabaseAdminClient();
  const invitationResult = await supabase
    .from("client_access_invitations")
    .select("id,client_id,invitation_token,status,expires_at,accepted_at,revoked_at")
    .eq("invitation_token", token)
    .maybeSingle<InvitationRow>();

  if (invitationResult.error) {
    if (isMissingTableError(invitationResult.error, "client_access_invitations")) {
      throw new Error(
        "Client onboarding is not available yet. Apply migration 20260304180000_auth_access_and_client_invites.sql.",
      );
    }
    throw new Error("Could not validate invitation token.");
  }

  if (!invitationResult.data) {
    return null;
  }

  const clientWorkspace = await loadClientById(invitationResult.data.client_id);
  if (!clientWorkspace) {
    return null;
  }

  const credentialResult = await supabase
    .from("client_access_credentials")
    .select("client_id,login_email")
    .eq("client_id", invitationResult.data.client_id)
    .maybeSingle<CredentialRow>();

  if (credentialResult.error) {
    if (isMissingTableError(credentialResult.error, "client_access_credentials")) {
      throw new Error(
        "Client onboarding is not available yet. Apply migration 20260304180000_auth_access_and_client_invites.sql.",
      );
    }
    throw new Error("Could not validate existing client credentials.");
  }

  return {
    invitation: invitationResult.data,
    clientId: invitationResult.data.client_id,
    companyName: clientWorkspace.companyName,
    clientSlug: clientWorkspace.clientSlug,
    isBlocked: clientWorkspace.isBlocked,
    hasCredentials: Boolean(credentialResult.data),
    loginEmail: credentialResult.data?.login_email ?? null,
    status: inferInvitationStatus(invitationResult.data),
    expiresAt: invitationResult.data.expires_at,
  };
}

export async function GET(request: NextRequest) {
  const tokenValue = request.nextUrl.searchParams.get("token") ?? "";
  const parsedToken = tokenSchema.safeParse(tokenValue);
  if (!parsedToken.success) {
    return NextResponse.json({ error: "Invalid invitation token." }, { status: 400 });
  }

  let invitationState: InvitationState | null = null;
  try {
    invitationState = await loadInvitationState(parsedToken.data);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not validate invitation token.",
      },
      { status: 500 },
    );
  }

  if (!invitationState) {
    return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
  }

  return NextResponse.json({
    invitation: {
      companyName: invitationState.companyName,
      clientSlug: invitationState.clientSlug,
      status: invitationState.status,
      isBlocked: invitationState.isBlocked,
      expiresAt: invitationState.expiresAt,
      hasCredentials: invitationState.hasCredentials,
      loginEmail: invitationState.loginEmail,
    },
  });
}

export async function POST(request: NextRequest) {
  let parsed: z.infer<typeof createCredentialsSchema>;
  try {
    parsed = createCredentialsSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const normalizedEmail = parsed.email.trim().toLowerCase();

  let invitationState: InvitationState | null = null;
  try {
    invitationState = await loadInvitationState(parsed.token);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not validate invitation token.",
      },
      { status: 500 },
    );
  }

  if (!invitationState) {
    return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
  }
  if (invitationState.isBlocked) {
    return NextResponse.json(
      { error: "Client access is blocked for this workspace." },
      { status: 403 },
    );
  }

  if (invitationState.status === "revoked") {
    return NextResponse.json({ error: "This invitation was revoked by the manager." }, { status: 409 });
  }

  if (invitationState.status === "expired") {
    return NextResponse.json({ error: "This invitation expired. Ask the manager for a new link." }, { status: 409 });
  }

  if (invitationState.status === "accepted" || invitationState.hasCredentials) {
    return NextResponse.json(
      {
        error: "Credentials already created for this company. Use the client login page.",
      },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(parsed.password);
  const supabase = getSupabaseAdminClient();

  const insertCredentialResult = await supabase.from("client_access_credentials").insert({
    client_id: invitationState.clientId,
    login_email: normalizedEmail,
    password_hash: passwordHash,
    updated_at: new Date().toISOString(),
  });

  if (insertCredentialResult.error) {
    if (insertCredentialResult.error.code === "23505") {
      return NextResponse.json(
        {
          error: "This email is already used by another client account.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Could not save client credentials." }, { status: 500 });
  }

  const updateInvitationResult = await supabase
    .from("client_access_invitations")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
      accepted_email: normalizedEmail,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invitationState.invitation.id);
  const warning = updateInvitationResult.error
    ? "Credentials created, but failed to finalize invitation status."
    : null;

  const token = createClientSessionToken(
    {
      clientId: invitationState.clientId,
      clientSlug: invitationState.clientSlug,
      email: normalizedEmail,
    },
    CLIENT_SESSION_TTL_SECONDS,
  );

  const response = NextResponse.json({
    redirectTo: `/client/${invitationState.clientSlug}/company-risk-profile?from=onboarding`,
    warning: warning ?? undefined,
  });
  response.cookies.set(
    CLIENT_SESSION_COOKIE,
    token,
    sessionCookieOptions(CLIENT_SESSION_TTL_SECONDS),
  );

  return response;
}
