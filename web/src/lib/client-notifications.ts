import type { SupabaseClient } from "@supabase/supabase-js";

import { isMissingTableError } from "@/lib/supabase-errors";

export type ClientNotificationType =
  | "manager_drps_assigned"
  | "manager_program_assigned"
  | "manager_report_issued";

type ClientNotificationRow = {
  notification_id: string;
  client_id: string;
  notification_type: ClientNotificationType;
  title: string;
  message: string;
  metadata: unknown;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
};

export type ClientNotification = {
  id: string;
  clientId: string;
  notificationType: ClientNotificationType;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

export async function createClientNotification(
  supabase: SupabaseClient,
  payload: {
    clientId: string;
    notificationType: ClientNotificationType;
    title: string;
    message: string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ unavailable: boolean }> {
  const insertResult = await supabase.from("client_notifications").insert({
    client_id: payload.clientId,
    notification_type: payload.notificationType,
    title: payload.title,
    message: payload.message,
    metadata: payload.metadata ?? {},
    is_read: false,
  });

  if (insertResult.error) {
    if (isMissingTableError(insertResult.error, "client_notifications")) {
      return { unavailable: true };
    }
    throw insertResult.error;
  }

  return { unavailable: false };
}

export async function loadClientNotifications(
  supabase: SupabaseClient,
  options: {
    clientId: string;
    limit?: number;
    unreadOnly?: boolean;
  },
): Promise<{ notifications: ClientNotification[]; unavailable: boolean }> {
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const query = supabase
    .from("client_notifications")
    .select(
      "notification_id,client_id,notification_type,title,message,metadata,is_read,read_at,created_at",
    )
    .eq("client_id", options.clientId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const result = await (options.unreadOnly ? query.eq("is_read", false) : query).returns<
    ClientNotificationRow[]
  >();

  if (result.error) {
    if (isMissingTableError(result.error, "client_notifications")) {
      return { notifications: [], unavailable: true };
    }
    throw result.error;
  }

  const notifications = (result.data ?? []).map((row) => ({
    id: row.notification_id,
    clientId: row.client_id,
    notificationType: row.notification_type,
    title: row.title,
    message: row.message,
    metadata: row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {},
    isRead: row.is_read,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));

  return { notifications, unavailable: false };
}

export async function markClientNotificationRead(
  supabase: SupabaseClient,
  payload: { clientId: string; notificationId: string },
) {
  const nowIso = new Date().toISOString();
  const result = await supabase
    .from("client_notifications")
    .update({ is_read: true, read_at: nowIso })
    .eq("client_id", payload.clientId)
    .eq("notification_id", payload.notificationId)
    .select("notification_id")
    .maybeSingle<{ notification_id: string }>();

  if (result.error) {
    if (isMissingTableError(result.error, "client_notifications")) {
      return { updated: false, unavailable: true };
    }
    throw result.error;
  }

  return {
    updated: Boolean(result.data),
    unavailable: false,
  };
}
