import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { markClientNotificationRead } from "@/lib/client-notifications";
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

const patchSchema = z.object({
  isRead: z.literal(true),
});

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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ clientSlug: string; notificationId: string }> },
) {
  const { clientSlug, notificationId } = await context.params;

  try {
    patchSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  try {
    const client = await loadClientBySlug(clientSlug);
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const result = await markClientNotificationRead(getSupabaseAdminClient(), {
      clientId: client.client_id,
      notificationId,
    });

    if (result.unavailable) {
      return NextResponse.json(
        {
          error:
            "Notifications table unavailable. Apply migration 20260304133000_client_notifications.sql.",
        },
        { status: 412 },
      );
    }

    if (!result.updated) {
      return NextResponse.json({ error: "Notification not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not update notification." }, { status: 500 });
  }
}
