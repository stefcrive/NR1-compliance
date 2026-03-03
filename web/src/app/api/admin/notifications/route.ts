import { NextRequest, NextResponse } from "next/server";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { loadManagerNotifications } from "@/lib/manager-notifications";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const rawLimit = request.nextUrl.searchParams.get("limit");
  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : 12;
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 12;
  const unreadOnly = request.nextUrl.searchParams.get("unread") === "1";

  try {
    const loaded = await loadManagerNotifications(getSupabaseAdminClient(), {
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
