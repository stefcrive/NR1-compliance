import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ClientShell } from "@/components/client-shell";
import { CLIENT_SESSION_COOKIE, parseClientSessionToken } from "@/lib/auth/session";
import { slugify } from "@/lib/slug";
import { isMissingColumnError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ClientAccessRow = {
  client_id: string;
  company_name: string;
  portal_slug?: string | null;
  status: "Active" | "Pending" | "Inactive";
  billing_status?: "up_to_date" | "pending" | "overdue" | "blocked" | null;
};

type AccessGate = {
  exists: boolean;
  blocked: boolean;
};

function isBlocked(
  status: ClientAccessRow["status"] | null | undefined,
  billingStatus: ClientAccessRow["billing_status"] | null | undefined,
) {
  return status === "Inactive" || billingStatus === "blocked";
}

async function loadClientAccessGate(clientSlug: string): Promise<AccessGate> {
  const supabase = getSupabaseAdminClient();
  const modernResult = await supabase
    .from("clients")
    .select("client_id,company_name,portal_slug,status,billing_status")
    .eq("portal_slug", clientSlug)
    .maybeSingle<ClientAccessRow>();

  if (!modernResult.error) {
    if (!modernResult.data) return { exists: false, blocked: false };
    return {
      exists: true,
      blocked: isBlocked(modernResult.data.status, modernResult.data.billing_status),
    };
  }

  const portalSlugMissing = isMissingColumnError(modernResult.error, "portal_slug");
  const billingStatusMissing = isMissingColumnError(modernResult.error, "billing_status");
  if (!portalSlugMissing && !billingStatusMissing) {
    throw modernResult.error;
  }

  if (portalSlugMissing) {
    const legacyResult = await supabase
      .from("clients")
      .select("client_id,company_name,status")
      .returns<ClientAccessRow[]>();
    if (legacyResult.error) {
      throw legacyResult.error;
    }
    const matched = (legacyResult.data ?? []).find((row) => slugify(row.company_name) === clientSlug);
    if (!matched) {
      return { exists: false, blocked: false };
    }
    return {
      exists: true,
      blocked: isBlocked(matched.status, null),
    };
  }

  const billingFallbackResult = await supabase
    .from("clients")
    .select("client_id,company_name,portal_slug,status")
    .eq("portal_slug", clientSlug)
    .maybeSingle<ClientAccessRow>();
  if (billingFallbackResult.error) {
    throw billingFallbackResult.error;
  }
  if (!billingFallbackResult.data) {
    return { exists: false, blocked: false };
  }
  return {
    exists: true,
    blocked: isBlocked(billingFallbackResult.data.status, null),
  };
}

export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const cookieStore = await cookies();
  const session = parseClientSessionToken(cookieStore.get(CLIENT_SESSION_COOKIE)?.value);

  if (!session || session.clientSlug !== clientSlug) {
    redirect(`/access/client?clientSlug=${encodeURIComponent(clientSlug)}`);
  }
  try {
    const accessGate = await loadClientAccessGate(clientSlug);
    if (!accessGate.exists) {
      redirect(`/access/client?clientSlug=${encodeURIComponent(clientSlug)}`);
    }
    if (accessGate.blocked) {
      redirect(`/access/client?clientSlug=${encodeURIComponent(clientSlug)}&blocked=1`);
    }
  } catch {
    redirect(`/access/client?clientSlug=${encodeURIComponent(clientSlug)}`);
  }

  return <ClientShell clientSlug={clientSlug}>{children}</ClientShell>;
}
