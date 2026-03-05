import type { SupabaseClient } from "@supabase/supabase-js";

import { isMissingTableError } from "@/lib/supabase-errors";

export type MasterCalendarEventType =
  | "drps_start"
  | "drps_close"
  | "continuous_meeting"
  | "blocked";

export type CalendarEventLifecycle = "provisory" | "committed";
export type CalendarEventProposalKind = "assignment" | "reschedule" | null;

export type MasterCalendarEventDetails = {
  content: string | null;
  preparationRequired: string | null;
  eventLifecycle: CalendarEventLifecycle;
  proposalKind: CalendarEventProposalKind;
  availabilityRequestId: string | null;
};

export type MasterCalendarEvent = {
  id: string;
  clientId: string | null;
  clientName: string | null;
  eventType: MasterCalendarEventType;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "completed" | "cancelled";
  sourceClientProgramId: string | null;
  details: MasterCalendarEventDetails;
};

type CampaignCalendarRow = {
  id: string;
  client_id?: string | null;
  name: string;
  starts_at?: string | null;
  closes_at?: string | null;
};

type CalendarEventRow = {
  event_id: string;
  client_id: string | null;
  source_client_program_id?: string | null;
  event_type: "continuous_meeting" | "blocked";
  title: string;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "completed" | "cancelled";
  metadata?: unknown;
};

function normalizeDetailText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeLifecycle(value: unknown): CalendarEventLifecycle {
  return value === "provisory" ? "provisory" : "committed";
}

function normalizeProposalKind(value: unknown): CalendarEventProposalKind {
  if (value === "assignment" || value === "reschedule") return value;
  return null;
}

export function extractCalendarEventDetails(metadata: unknown): MasterCalendarEventDetails {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {
      content: null,
      preparationRequired: null,
      eventLifecycle: "committed",
      proposalKind: null,
      availabilityRequestId: null,
    };
  }

  const record = metadata as Record<string, unknown>;
  const availabilityRequestIdRaw =
    record.availabilityRequestId ?? record.availability_request_id ?? null;
  return {
    content: normalizeDetailText(record.content) ?? normalizeDetailText(record.notes),
    preparationRequired:
      normalizeDetailText(record.preparationRequired) ??
      normalizeDetailText(record.preparation_required),
    eventLifecycle: normalizeLifecycle(record.eventLifecycle),
    proposalKind: normalizeProposalKind(record.proposalKind),
    availabilityRequestId:
      typeof availabilityRequestIdRaw === "string" && availabilityRequestIdRaw.trim().length > 0
        ? availabilityRequestIdRaw
        : null,
  };
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function plusOneHour(value: Date): Date {
  return new Date(value.getTime() + 60 * 60 * 1000);
}

function plusDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function sortByStart(events: MasterCalendarEvent[]): MasterCalendarEvent[] {
  return events.slice().sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

export function buildDrpsCalendarEvents(
  campaigns: CampaignCalendarRow[],
  clientNameById?: Map<string, string>,
): MasterCalendarEvent[] {
  const events: MasterCalendarEvent[] = [];

  for (const campaign of campaigns) {
    const clientId = campaign.client_id ?? null;
    const clientName = clientId ? clientNameById?.get(clientId) ?? null : null;
    const start = toDate(campaign.starts_at);
    const close = toDate(campaign.closes_at);
    const closeOrDefault =
      close && start && close.getTime() > start.getTime()
        ? close
        : start
          ? plusDays(start, 7)
          : close;

    if (start) {
      events.push({
        id: `drps-start-${campaign.id}`,
        clientId,
        clientName,
        eventType: "drps_start",
        title: `Inicio DRPS: ${campaign.name}`,
        startsAt: start.toISOString(),
        endsAt: (closeOrDefault ?? plusOneHour(start)).toISOString(),
        status: "scheduled",
        sourceClientProgramId: null,
        details: {
          content: null,
          preparationRequired: null,
          eventLifecycle: "committed",
          proposalKind: null,
          availabilityRequestId: null,
        },
      });
    }

    if (closeOrDefault) {
      events.push({
        id: `drps-close-${campaign.id}`,
        clientId,
        clientName,
        eventType: "drps_close",
        title: `Fechamento DRPS: ${campaign.name}`,
        startsAt: closeOrDefault.toISOString(),
        endsAt: plusOneHour(closeOrDefault).toISOString(),
        status: "scheduled",
        sourceClientProgramId: null,
        details: {
          content: null,
          preparationRequired: null,
          eventLifecycle: "committed",
          proposalKind: null,
          availabilityRequestId: null,
        },
      });
    }
  }

  return sortByStart(events);
}

export async function loadStoredCalendarEvents(
  supabase: SupabaseClient,
  options?: { clientId?: string },
): Promise<{ events: MasterCalendarEvent[]; unavailable: boolean }> {
  const query = supabase
    .from("calendar_events")
    .select("event_id,client_id,source_client_program_id,event_type,title,starts_at,ends_at,status,metadata")
    .order("starts_at", { ascending: true });

  const scoped = options?.clientId ? query.eq("client_id", options.clientId) : query;
  const result = await scoped.returns<CalendarEventRow[]>();

  if (result.error) {
    if (isMissingTableError(result.error, "calendar_events")) {
      return { events: [], unavailable: true };
    }
    throw result.error;
  }

  const events = (result.data ?? []).map((row) => ({
    id: row.event_id,
    clientId: row.client_id,
    clientName: null,
    eventType: row.event_type,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    sourceClientProgramId: row.source_client_program_id ?? null,
    details: extractCalendarEventDetails(row.metadata),
  })) satisfies MasterCalendarEvent[];

  return { events: sortByStart(events), unavailable: false };
}

export function withClientNames(
  events: MasterCalendarEvent[],
  clientNameById: Map<string, string>,
): MasterCalendarEvent[] {
  return events.map((event) => ({
    ...event,
    clientName: event.clientId ? clientNameById.get(event.clientId) ?? null : null,
  }));
}

export function mergeAndSortMasterCalendarEvents(
  drpsEvents: MasterCalendarEvent[],
  storedEvents: MasterCalendarEvent[],
): MasterCalendarEvent[] {
  return sortByStart([...drpsEvents, ...storedEvents]);
}
