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
  created_at?: string | null;
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

function plusDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function sortByStart(events: MasterCalendarEvent[]): MasterCalendarEvent[] {
  return events.slice().sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

type DrpsAggregateBucket = {
  event: MasterCalendarEvent;
  campaignNames: Set<string>;
  count: number;
};

function toDayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toAggregateKey(clientId: string | null, startsAt: Date, endsAt: Date) {
  return `${clientId ?? "unlinked"}:${toDayKey(startsAt)}:${toDayKey(endsAt)}`;
}

function toDrpsWindowTitle(campaignName: string, count: number): string {
  if (count > 1) return `Janela DRPS (${count} setores)`;
  return `Janela DRPS: ${campaignName}`;
}

function toDrpsWindowContent(campaignNames: Set<string>): string | null {
  const ordered = Array.from(campaignNames.values())
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .sort((left, right) => left.localeCompare(right, "pt-BR"));
  if (ordered.length === 0) return null;
  return `Subcampanhas por setor:\n${ordered.map((name) => `- ${name}`).join("\n")}`;
}

function pushOrAggregateDrpsWindow(
  buckets: Map<string, DrpsAggregateBucket>,
  key: string,
  campaignName: string,
  candidate: MasterCalendarEvent,
) {
  const existing = buckets.get(key);
  if (!existing) {
    const campaignNames = new Set<string>();
    campaignNames.add(campaignName);
    candidate.title = toDrpsWindowTitle(campaignName, 1);
    candidate.details.content = toDrpsWindowContent(campaignNames);
    buckets.set(key, { event: candidate, campaignNames, count: 1 });
    return;
  }

  existing.count += 1;
  existing.campaignNames.add(campaignName);
  existing.event.title = toDrpsWindowTitle(campaignName, existing.count);
  existing.event.details.content = toDrpsWindowContent(existing.campaignNames);

  const existingStart = new Date(existing.event.startsAt).getTime();
  const candidateStart = new Date(candidate.startsAt).getTime();
  if (Number.isFinite(candidateStart) && (!Number.isFinite(existingStart) || candidateStart < existingStart)) {
    existing.event.startsAt = candidate.startsAt;
  }

  const existingEnd = new Date(existing.event.endsAt).getTime();
  const candidateEnd = new Date(candidate.endsAt).getTime();
  if (Number.isFinite(candidateEnd) && (!Number.isFinite(existingEnd) || candidateEnd > existingEnd)) {
    existing.event.endsAt = candidate.endsAt;
  }
}

function resolveCampaignWindow(campaign: CampaignCalendarRow): { startsAt: Date; endsAt: Date } | null {
  const start = toDate(campaign.starts_at);
  const close = toDate(campaign.closes_at);
  const createdAt = toDate(campaign.created_at);
  if (start) {
    if (close && close.getTime() > start.getTime()) {
      return { startsAt: start, endsAt: close };
    }
    return { startsAt: start, endsAt: plusDays(start, 7) };
  }
  if (close) {
    return { startsAt: plusDays(close, -7), endsAt: close };
  }
  if (createdAt) {
    return { startsAt: createdAt, endsAt: plusDays(createdAt, 7) };
  }
  return null;
}

export function buildDrpsCalendarEvents(
  campaigns: CampaignCalendarRow[],
  clientNameById?: Map<string, string>,
): MasterCalendarEvent[] {
  const buckets = new Map<string, DrpsAggregateBucket>();

  for (const campaign of campaigns) {
    const clientId = campaign.client_id ?? null;
    const clientName = clientId ? clientNameById?.get(clientId) ?? null : null;
    const campaignName = campaign.name.trim() || "Campanha sem nome";
    const window = resolveCampaignWindow(campaign);
    if (!window) continue;
    const event = {
      id: `drps-start-${campaign.id}`,
      clientId,
      clientName,
      eventType: "drps_start",
      title: toDrpsWindowTitle(campaignName, 1),
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      status: "scheduled",
      sourceClientProgramId: null,
      details: {
        content: null,
        preparationRequired: null,
        eventLifecycle: "committed",
        proposalKind: null,
        availabilityRequestId: null,
      },
    } satisfies MasterCalendarEvent;
    pushOrAggregateDrpsWindow(
      buckets,
      toAggregateKey(clientId, window.startsAt, window.endsAt),
      campaignName,
      event,
    );
  }

  return sortByStart(Array.from(buckets.values(), (bucket) => bucket.event));
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
