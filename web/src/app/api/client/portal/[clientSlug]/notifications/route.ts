import { NextRequest, NextResponse } from "next/server";

import { loadClientNotifications } from "@/lib/client-notifications";
import { slugify } from "@/lib/slug";
import { isMissingColumnError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ClientRow = {
  client_id: string;
  company_name: string;
  portal_slug: string;
};

type LegacyClientRow = {
  client_id: string;
  company_name: string;
};

async function loadClientBySlug(clientSlug: string): Promise<ClientRow | null> {
  const supabase = getSupabaseAdminClient();
  const modernResult = await supabase
    .from("clients")
    .select("client_id,company_name,portal_slug")
    .eq("portal_slug", clientSlug)
    .maybeSingle<ClientRow>();

  if (!modernResult.error) {
    return modernResult.data ?? null;
  }

  if (!isMissingColumnError(modernResult.error, "portal_slug")) {
    throw modernResult.error;
  }

  const legacyResult = await supabase
    .from("clients")
    .select("client_id,company_name")
    .returns<LegacyClientRow[]>();
  if (legacyResult.error) {
    throw legacyResult.error;
  }

  const matched = (legacyResult.data ?? []).find(
    (row) => slugify(row.company_name) === clientSlug,
  );
  if (!matched) return null;

  return {
    client_id: matched.client_id,
    company_name: matched.company_name,
    portal_slug: slugify(matched.company_name),
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientSlug: string }> },
) {
  const { clientSlug } = await context.params;
  const rawLimit = request.nextUrl.searchParams.get("limit");
  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : 12;
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 12;
  const unreadOnly = request.nextUrl.searchParams.get("unread") === "1";

  try {
    const client = await loadClientBySlug(clientSlug);
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const loaded = await loadClientNotifications(getSupabaseAdminClient(), {
      clientId: client.client_id,
      limit,
      unreadOnly,
    });
    return NextResponse.json({
      notifications: loaded.notifications,
      notificationsUnavailable: loaded.unavailable,
    });
  } catch {
    return NextResponse.json({ error: "Could not load notifications." }, { status: 500 });
  }
}
