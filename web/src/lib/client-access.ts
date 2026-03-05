import { randomBytes } from "node:crypto";

import { isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export type ClientInvitationStatus =
  | "pending"
  | "accepted"
  | "expired"
  | "revoked"
  | "none"
  | "unavailable";

export type ClientAccessSummary = {
  hasCredentials: boolean;
  loginEmail: string | null;
  invitationStatus: ClientInvitationStatus;
  invitationLink: string | null;
  invitationExpiresAt: string | null;
  invitationAcceptedAt: string | null;
};

type InvitationRow = {
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

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdminClient>;

const DEFAULT_INVITATION_TTL_DAYS = 14;

export function resolveRequestOrigin(request: { nextUrl?: { origin?: string }; headers: Headers }): string {
  const nextOrigin = request.nextUrl?.origin?.trim();
  if (nextOrigin) {
    return nextOrigin;
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) {
    return "http://localhost:3000";
  }
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export function buildClientInvitationLink(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/access/client/onboarding?token=${encodeURIComponent(token)}`;
}

function inferInvitationStatus(invitation: InvitationRow | null): ClientInvitationStatus {
  if (!invitation) {
    return "none";
  }

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

export async function loadClientAccessSummary(
  supabase: SupabaseAdminClient,
  clientId: string,
  origin: string,
): Promise<{ summary: ClientAccessSummary; warning: string | null }> {
  const [credentialResult, invitationResult] = await Promise.all([
    supabase
      .from("client_access_credentials")
      .select("client_id,login_email")
      .eq("client_id", clientId)
      .maybeSingle<CredentialRow>(),
    supabase
      .from("client_access_invitations")
      .select("client_id,invitation_token,status,expires_at,accepted_at,revoked_at")
      .eq("client_id", clientId)
      .maybeSingle<InvitationRow>(),
  ]);

  const credentialsMissing = isMissingTableError(
    credentialResult.error,
    "client_access_credentials",
  );
  const invitationsMissing = isMissingTableError(
    invitationResult.error,
    "client_access_invitations",
  );

  if (credentialResult.error && !credentialsMissing) {
    return {
      summary: {
        hasCredentials: false,
        loginEmail: null,
        invitationStatus: "unavailable",
        invitationLink: null,
        invitationExpiresAt: null,
        invitationAcceptedAt: null,
      },
      warning: "Could not load client credential status.",
    };
  }

  if (invitationResult.error && !invitationsMissing) {
    return {
      summary: {
        hasCredentials: Boolean(credentialResult.data),
        loginEmail: credentialResult.data?.login_email ?? null,
        invitationStatus: "unavailable",
        invitationLink: null,
        invitationExpiresAt: null,
        invitationAcceptedAt: null,
      },
      warning: "Could not load client invitation status.",
    };
  }

  if (credentialsMissing || invitationsMissing) {
    return {
      summary: {
        hasCredentials: false,
        loginEmail: null,
        invitationStatus: "unavailable",
        invitationLink: null,
        invitationExpiresAt: null,
        invitationAcceptedAt: null,
      },
      warning:
        "Client access tables are missing. Apply migration 20260304180000_auth_access_and_client_invites.sql.",
    };
  }

  const invitation = invitationResult.data ?? null;
  const invitationStatus = inferInvitationStatus(invitation);
  const showInvitationLink = invitationStatus === "pending" || invitationStatus === "expired";

  return {
    summary: {
      hasCredentials: Boolean(credentialResult.data),
      loginEmail: credentialResult.data?.login_email ?? null,
      invitationStatus,
      invitationLink:
        showInvitationLink && invitation?.invitation_token
          ? buildClientInvitationLink(origin, invitation.invitation_token)
          : null,
      invitationExpiresAt: invitation?.expires_at ?? null,
      invitationAcceptedAt: invitation?.accepted_at ?? null,
    },
    warning: null,
  };
}

export async function issueClientInvitation(
  supabase: SupabaseAdminClient,
  clientId: string,
  origin: string,
  ttlDays = DEFAULT_INVITATION_TTL_DAYS,
): Promise<{
  invitationLink: string | null;
  invitationExpiresAt: string | null;
  invitationStatus: ClientInvitationStatus;
  warning: string | null;
}> {
  const invitationToken = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("client_access_invitations")
    .upsert(
      {
        client_id: clientId,
        invitation_token: invitationToken,
        status: "pending",
        expires_at: expiresAt,
        accepted_at: null,
        accepted_email: null,
        revoked_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id" },
    )
    .select("invitation_token,expires_at,status")
    .single<{ invitation_token: string; expires_at: string; status: "pending" }>();

  if (error) {
    if (isMissingTableError(error, "client_access_invitations")) {
      return {
        invitationLink: null,
        invitationExpiresAt: null,
        invitationStatus: "unavailable",
        warning:
          "Client created, but invitation tables are missing. Apply migration 20260304180000_auth_access_and_client_invites.sql.",
      };
    }
    return {
      invitationLink: null,
      invitationExpiresAt: null,
      invitationStatus: "unavailable",
      warning: "Client created, but could not generate the invitation link.",
    };
  }

  return {
    invitationLink: buildClientInvitationLink(origin, data.invitation_token),
    invitationExpiresAt: data.expires_at,
    invitationStatus: data.status,
    warning: null,
  };
}
