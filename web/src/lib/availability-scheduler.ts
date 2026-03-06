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

// 09:00-18:00 in America/Sao_Paulo corresponds to 12:00-21:00 UTC.
const BUSINESS_START_HOUR_UTC = 12;
const BUSINESS_END_HOUR_UTC = 21;
const BUSINESS_STEP_MINUTES = 60;
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

function slotOverlapsSlots(slot: AvailabilitySlot, slots: AvailabilitySlot[]): boolean {
  const slotStart = safeDate(slot.startsAt);
  const slotEnd = safeDate(slot.endsAt);
  if (!slotStart || !slotEnd) return true;
  return slots.some((item) => {
    const itemStart = safeDate(item.startsAt);
    const itemEnd = safeDate(item.endsAt);
    if (!itemStart || !itemEnd) return false;
    return overlaps(slotStart, slotEnd, itemStart, itemEnd);
  });
}

function buildBusinessHourCandidatesUTC(params: {
  day: Date;
  durationMinutes: number;
  preferredHour?: number | null;
}): Date[] {
  const maxStartMinutes = BUSINESS_END_HOUR_UTC * 60 - params.durationMinutes;
  if (maxStartMinutes < BUSINESS_START_HOUR_UTC * 60) return [];

  const candidates: Date[] = [];
  for (
    let minuteOfDay = BUSINESS_START_HOUR_UTC * 60;
    minuteOfDay <= maxStartMinutes;
    minuteOfDay += BUSINESS_STEP_MINUTES
  ) {
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    const start = new Date(params.day);
    start.setUTCHours(hour, minute, 0, 0);
    candidates.push(start);
  }

  if (
    params.preferredHour === null ||
    params.preferredHour === undefined ||
    !Number.isFinite(params.preferredHour)
  ) {
    return candidates;
  }

  return candidates.sort((left, right) => {
    const leftDistance = Math.abs(left.getUTCHours() - Number(params.preferredHour));
    const rightDistance = Math.abs(right.getUTCHours() - Number(params.preferredHour));
    return leftDistance - rightDistance;
  });
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

export function findNextAvailableBusinessSlot(params: {
  startsAt: string;
  durationMinutes?: number;
  existingEvents: MasterCalendarEvent[];
  existingSlots?: AvailabilitySlot[];
  maxSearchDays?: number;
}): AvailabilitySlot | null {
  const start = safeDate(params.startsAt);
  if (!start) return null;

  const durationMinutes = params.durationMinutes ?? 60;
  const durationMs = durationMinutes * 60 * 1000;
  const preferredHour = start.getUTCHours();
  const startDay = startOfUtcDay(start);
  const existingSlots = params.existingSlots ?? [];
  const maxSearchDays = params.maxSearchDays ?? 365;

  for (let dayOffset = 0; dayOffset <= maxSearchDays; dayOffset += 1) {
    const day = startOfUtcDay(addDaysUTC(startDay, dayOffset));
    if (isWeekendUTC(day)) continue;
    const candidates = buildBusinessHourCandidatesUTC({
      day,
      durationMinutes,
      preferredHour,
    });
    for (const candidateStart of candidates) {
      if (dayOffset === 0 && candidateStart < start) continue;
      const candidate: AvailabilitySlot = {
        startsAt: candidateStart.toISOString(),
        endsAt: new Date(candidateStart.getTime() + durationMs).toISOString(),
      };
      if (slotOverlapsMasterCalendar(candidate, params.existingEvents)) continue;
      if (slotOverlapsSlots(candidate, existingSlots)) continue;
      return candidate;
    }
  }

  return null;
}

export function buildSuggestedAvailabilitySlots({
  deployedAt,
  scheduleFrequency,
  scheduleAnchorDate,
  existingEvents,
  maxSlots = 8,
  durationMinutes = 60,
  enforceCadenceSeries = false,
}: BuildSuggestedSlotsParams): AvailabilitySlot[] {
  const now = new Date();
  const minStart = addDaysUTC(now, 1);
  const deployedDate = safeDate(deployedAt);
  const intervalDays = frequencyToDays(scheduleFrequency);
  const anchor =
    safeDate(scheduleAnchorDate ? `${scheduleAnchorDate}T00:00:00.000Z` : null) ??
    startOfUtcDay(now);
  const slots: AvailabilitySlot[] = [];
  const seen = new Set<string>();

  for (let step = 0; step < 180 && slots.length < maxSlots; step += 1) {
    const baseDate = nextBusinessDayUTC(addDaysUTC(anchor, step * intervalDays));
    const candidates = buildBusinessHourCandidatesUTC({
      day: baseDate,
      durationMinutes,
      preferredHour: deployedDate?.getUTCHours(),
    });
    for (const start of candidates) {
      if (start <= minStart) continue;
      const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
      const key = start.toISOString();
      if (seen.has(key)) continue;
      const candidate: AvailabilitySlot = { startsAt: key, endsAt: end.toISOString() };
      if (slotOverlapsMasterCalendar(candidate, existingEvents)) continue;
      if (slotOverlapsSlots(candidate, slots)) continue;
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
    const candidates = buildBusinessHourCandidatesUTC({
      day: baseDate,
      durationMinutes,
      preferredHour: deployedDate?.getUTCHours(),
    });
    for (const start of candidates) {
      const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
      const key = start.toISOString();
      if (seen.has(key)) continue;
      const candidate: AvailabilitySlot = { startsAt: key, endsAt: end.toISOString() };
      if (slotOverlapsMasterCalendar(candidate, existingEvents)) continue;
      if (slotOverlapsSlots(candidate, slots)) continue;
      seen.add(key);
      slots.push(candidate);
      if (slots.length >= maxSlots) break;
    }
  }

  return slots;
}
