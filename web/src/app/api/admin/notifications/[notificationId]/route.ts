import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { markManagerNotificationRead } from "@/lib/manager-notifications";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

const patchSchema = z.object({
  isRead: z.literal(true),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ notificationId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { notificationId } = await context.params;
  try {
    patchSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  try {
    const result = await markManagerNotificationRead(
      getSupabaseAdminClient(),
      notificationId,
    );

    if (result.unavailable) {
      return NextResponse.json(
        {
          error:
            "Notifications table unavailable. Apply migration 20260303090000_manager_notifications.sql.",
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
