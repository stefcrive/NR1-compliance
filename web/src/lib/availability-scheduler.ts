import type { MasterCalendarEvent } from "@/lib/master-calendar";

export type AvailabilitySlot = {
  startsAt: string;
  endsAt: string;
};

type SupportedFrequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual"
  | "custom";

type BuildSuggestedSlotsParams = {
  deployedAt: string;
  scheduleFrequency?: string | null;
  scheduleAnchorDate?: string | null;
  existingEvents: MasterCalendarEvent[];
  maxSlots?: number;
  durationMinutes?: number;
  enforceCadenceSeries?: boolean;
};

const CANDIDATE_HOURS_UTC = [13, 17, 19] as const;
export const DEFAULT_ASSIGNMENT_CADENCE_SLOT_COUNT = 4;

function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function isWeekendUTC(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function nextBusinessDayUTC(date: Date): Date {
  const next = new Date(date);
  while (isWeekendUTC(next)) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function setUtcHour(date: Date, hour: number): Date {
  const next = new Date(date);
  next.setUTCHours(hour, 0, 0, 0);
  return next;
}

function addDaysUTC(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function frequencyToDays(value: string | null | undefined): number {
  const normalized = (value ?? "").toLowerCase() as SupportedFrequency;
  switch (normalized) {
    case "weekly":
      return 7;
    case "biweekly":
      return 14;
    case "monthly":
      return 30;
    case "quarterly":
      return 90;
    case "semiannual":
      return 182;
    case "annual":
      return 365;
    case "custom":
      return 21;
    default:
      return 14;
  }
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA < endB && endA > startB;
}

export function slotOverlapsMasterCalendar(
  slot: AvailabilitySlot,
  events: MasterCalendarEvent[],
  options?: { ignoreSourceClientProgramId?: string | null },
): boolean {
  const slotStart = safeDate(slot.startsAt);
  const slotEnd = safeDate(slot.endsAt);
  if (!slotStart || !slotEnd) return true;

  return events.some((event) => {
    if (event.status === "cancelled") return false;
    if (
      options?.ignoreSourceClientProgramId &&
      event.sourceClientProgramId === options.ignoreSourceClientProgramId
    ) {
      return false;
    }
    const eventStart = safeDate(event.startsAt);
    const eventEnd = safeDate(event.endsAt);
    if (!eventStart || !eventEnd) return false;
    return overlaps(slotStart, slotEnd, eventStart, eventEnd);
  });
}

export function buildSuggestedAvailabilitySlots({
  deployedAt: _deployedAt,
  scheduleFrequency,
  scheduleAnchorDate,
  existingEvents,
  maxSlots = 8,
  durationMinutes = 60,
  enforceCadenceSeries = false,
}: BuildSuggestedSlotsParams): AvailabilitySlot[] {
  void _deployedAt;
  const now = new Date();
  const minStart = addDaysUTC(now, 1);
  const intervalDays = frequencyToDays(scheduleFrequency);
  const anchor =
    safeDate(scheduleAnchorDate ? `${scheduleAnchorDate}T00:00:00.000Z` : null) ??
    startOfUtcDay(now);
  const slotDurationMs = durationMinutes * 60 * 1000;
  const slots: AvailabilitySlot[] = [];
  const seen = new Set<string>();

  for (let step = 0; step < 180 && slots.length < maxSlots; step += 1) {
    const baseDate = nextBusinessDayUTC(addDaysUTC(anchor, step * intervalDays));
    for (const hour of CANDIDATE_HOURS_UTC) {
      const start = setUtcHour(baseDate, hour);
      if (start <= minStart) continue;
      const end = new Date(start.getTime() + slotDurationMs);
      const key = start.toISOString();
      if (seen.has(key)) continue;
      const candidate: AvailabilitySlot = { startsAt: key, endsAt: end.toISOString() };
      if (slotOverlapsMasterCalendar(candidate, existingEvents)) continue;
      seen.add(key);
      slots.push(candidate);
      if (slots.length >= maxSlots || enforceCadenceSeries) break;
    }
  }

  if (enforceCadenceSeries) {
    return slots;
  }

  for (let dayOffset = 0; dayOffset < 120 && slots.length < maxSlots; dayOffset += 1) {
    const baseDate = nextBusinessDayUTC(addDaysUTC(minStart, dayOffset));
    for (const hour of CANDIDATE_HOURS_UTC) {
      const start = setUtcHour(baseDate, hour);
      const end = new Date(start.getTime() + slotDurationMs);
      const key = start.toISOString();
      if (seen.has(key)) continue;
      const candidate: AvailabilitySlot = { startsAt: key, endsAt: end.toISOString() };
      if (slotOverlapsMasterCalendar(candidate, existingEvents)) continue;
      seen.add(key);
      slots.push(candidate);
      if (slots.length >= maxSlots) break;
    }
  }

  return slots;
}
