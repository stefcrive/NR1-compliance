import {
  slotOverlapsMasterCalendar,
  type AvailabilitySlot,
} from "@/lib/availability-scheduler";
import { type ContinuousProgramSession } from "@/lib/continuous-programs";
import { type MasterCalendarEvent } from "@/lib/master-calendar";

const annualPlanMonthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
// 09:00-18:00 in America/Sao_Paulo corresponds to 12:00-21:00 UTC.
const annualPlanBusinessStartHourUtc = 12;
const annualPlanBusinessEndHourUtc = 21;

export type AssignmentSessionPlan = {
  slot: AvailabilitySlot;
  session: ContinuousProgramSession;
  sessionSequence: number;
  sessionCycle: number;
};

export function toMonthKey(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function normalizeAnnualPlanMonths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (!annualPlanMonthRegex.test(normalized)) continue;
    unique.add(normalized);
  }
  return Array.from(unique.values()).sort();
}

export function buildSequentialAnnualPlanMonths(params: {
  deployedAt: string | null | undefined;
  monthCount: number;
}): string[] {
  const safeCount = Math.max(0, Math.round(params.monthCount));
  if (safeCount === 0) return [];
  const parsedStart = params.deployedAt ? new Date(params.deployedAt) : new Date();
  const safeStart = Number.isNaN(parsedStart.getTime()) ? new Date() : parsedStart;
  const startMonth = new Date(
    Date.UTC(safeStart.getUTCFullYear(), safeStart.getUTCMonth(), 1),
  );

  const months: string[] = [];
  for (let index = 0; index < safeCount; index += 1) {
    const monthDate = new Date(
      Date.UTC(
        startMonth.getUTCFullYear(),
        startMonth.getUTCMonth() + index,
        1,
      ),
    );
    months.push(toMonthKey(monthDate));
  }
  return months;
}

function parseAnnualPlanMonthKey(
  value: string,
): { year: number; monthIndex: number } | null {
  if (!annualPlanMonthRegex.test(value)) return null;
  const [yearText, monthText] = value.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return null;
  return { year, monthIndex };
}

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function isWeekendUtc(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA < endB && endA > startB;
}

function buildAnnualPlanCandidateHoursUtc(preferredHour: number): number[] {
  const minHour = annualPlanBusinessStartHourUtc;
  const maxHour = annualPlanBusinessEndHourUtc - 1;
  const clampedPreferred = Math.min(maxHour, Math.max(minHour, preferredHour));
  const fallback: number[] = [];
  for (let hour = minHour; hour <= maxHour; hour += 1) {
    if (hour === clampedPreferred) continue;
    fallback.push(hour);
  }
  return [clampedPreferred, ...fallback];
}

function sortSlots(slots: AvailabilitySlot[]): AvailabilitySlot[] {
  return slots
    .slice()
    .sort(
      (left, right) =>
        new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
    );
}

function buildMonthSlots(params: {
  annualPlanMonths: string[];
  deployedAt: string | null;
  existingEvents: MasterCalendarEvent[];
  durationMinutes: number;
}): AvailabilitySlot[] {
  if (params.annualPlanMonths.length === 0) return [];

  const deployedDate = params.deployedAt ? new Date(params.deployedAt) : null;
  const hasDeployedDate =
    deployedDate && !Number.isNaN(deployedDate.getTime());
  const preferredDay = hasDeployedDate
    ? Math.min(28, Math.max(1, deployedDate.getUTCDate()))
    : 1;
  const preferredHour = hasDeployedDate
    ? deployedDate.getUTCHours()
    : annualPlanBusinessStartHourUtc;
  const candidateHours = buildAnnualPlanCandidateHoursUtc(preferredHour);
  const preferredMinute = 0;
  const slotDurationMs = params.durationMinutes * 60 * 1000;
  const minStart = new Date();
  minStart.setUTCDate(minStart.getUTCDate() + 1);

  const generated: AvailabilitySlot[] = [];

  for (const monthKey of params.annualPlanMonths) {
    const parsed = parseAnnualPlanMonthKey(monthKey);
    if (!parsed) continue;

    const daysInMonth = daysInUtcMonth(parsed.year, parsed.monthIndex);
    let chosen: AvailabilitySlot | null = null;
    for (let dayOffset = 0; dayOffset < daysInMonth && !chosen; dayOffset += 1) {
      const day = ((preferredDay - 1 + dayOffset) % daysInMonth) + 1;
      for (const hour of candidateHours) {
        const start = new Date(
          Date.UTC(
            parsed.year,
            parsed.monthIndex,
            day,
            hour,
            preferredMinute,
            0,
            0,
          ),
        );
        if (start.getUTCMonth() !== parsed.monthIndex) continue;
        if (isWeekendUtc(start) || start <= minStart) continue;
        const end = new Date(start.getTime() + slotDurationMs);
        const candidate = {
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
        };
        if (slotOverlapsMasterCalendar(candidate, params.existingEvents)) continue;
        const hasGeneratedOverlap = generated.some((slot) =>
          overlaps(
            new Date(slot.startsAt),
            new Date(slot.endsAt),
            start,
            end,
          ),
        );
        if (hasGeneratedOverlap) continue;
        chosen = candidate;
        break;
      }
    }
    if (chosen) {
      generated.push(chosen);
    }
  }

  return sortSlots(generated);
}

export function buildAssignmentSessionPlans(params: {
  annualPlanMonths: string[];
  deployedAt: string | null;
  sessions: ContinuousProgramSession[];
  existingEvents: MasterCalendarEvent[];
  durationMinutes?: number;
}): AssignmentSessionPlan[] {
  if (params.sessions.length === 0) return [];
  const monthSlots = buildMonthSlots({
    annualPlanMonths: normalizeAnnualPlanMonths(params.annualPlanMonths),
    deployedAt: params.deployedAt,
    existingEvents: params.existingEvents,
    durationMinutes: params.durationMinutes ?? 60,
  });

  return monthSlots.map((slot, index) => {
    const session = params.sessions[index % params.sessions.length];
    const sessionSequence = index + 1;
    const sessionCycle = Math.floor(index / params.sessions.length) + 1;
    return {
      slot,
      session,
      sessionSequence,
      sessionCycle,
    };
  });
}
