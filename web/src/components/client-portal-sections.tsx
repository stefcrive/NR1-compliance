"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { findProgramById } from "@/lib/programs-catalog";

type Diagnostic = {
  id: string;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  starts_at: string | null;
  closes_at: string | null;
  responses: number;
  employeeFormLink?: string;
};

type TopicRow = {
  topicId: number;
  meanSeverity: number | null;
  risk: "low" | "medium" | "high" | "critical" | null;
  riskFactor?: string;
  severity?: number;
};

type SectorRow = {
  sector: string;
  nResponses: number;
  suppressed?: boolean;
  adjustedRiskIndex: number | null;
  adjustedRiskClass: "low" | "medium" | "high" | null;
  sectorRiskIndex?: number | null;
  sectorRiskCategory?: "low" | "moderate" | "high" | "critical" | null;
  psychosocialLoadIndex?: number | null;
  riskConcentration?: number | null;
  criticalExposure?: number | null;
  criticalEmployees?: number;
  employeeCount?: number;
  riskFactors?: RiskFactorMetric[];
};

type ScoreDistribution = {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
};

type RiskFactorMetric = {
  topicId: number;
  riskFactor: string;
  severity: number;
  responses: number;
  affectedEmployees: number;
  meanExposure: number | null;
  exposureLevel: "low" | "moderate" | "high" | "critical" | null;
  prevalence: number | null;
  severityIndex: number | null;
  probability: number | null;
  probabilityBand: "rare" | "occasional" | "frequent" | "very_frequent" | null;
  riskScore: number | null;
  riskCategory: "low" | "moderate" | "high" | "critical" | null;
  concentration: number | null;
  distribution: ScoreDistribution;
};

type RiskFactorTrendSeries = {
  topicId: number;
  riskFactor: string;
  sector: string;
  points: Array<{
    period: string;
    meanExposure: number;
    stdDevExposure: number;
    prevalence: number | null;
    severityIndex: number | null;
    probability: number;
    severity: number;
    riskScore: number;
    responses: number;
  }>;
};

type TrendDetailsModalState = {
  title: string;
  subtitle: string;
  rows: RiskFactorTrendSeries["points"];
};

type DatasetSortKey = "employee_id" | "sector" | "risk_factor" | "score" | "timestamp";

type PlotInfoKey =
  | "heatmap"
  | "matrix"
  | "radar"
  | "distribution"
  | "ranking"
  | "trend";

type ClientPortalPayload = {
  client: {
    companyName: string;
    cnpj: string;
    status: string;
    billingStatus?: string;
    totalEmployees: number;
    remoteEmployees: number;
    onsiteEmployees: number;
    hybridEmployees: number;
    contractStartDate?: string | null;
    contractEndDate?: string | null;
    updatedAt?: string | null;
  };
  assignedPrograms?: Array<{
    id: string;
    programId: string;
    status: "Recommended" | "Active" | "Completed";
    deployedAt: string | null;
    programTitle: string;
    programDescription: string | null;
    targetRiskTopic: number | null;
    triggerThreshold: number | null;
    scheduleFrequency: string;
    scheduleAnchorDate: string | null;
    annualPlanMonths?: string[];
    evaluationQuestions?: string[];
    materials?: Array<{
      id: string;
      title: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      uploadedAt: string;
      storagePath: string;
      downloadUrl: string;
    }>;
  }>;
  masterCalendar?: {
    events: Array<{
      id: string;
      eventType: "drps_start" | "drps_close" | "continuous_meeting" | "blocked";
      title: string;
      startsAt: string;
      endsAt: string;
      status: "scheduled" | "completed" | "cancelled";
      sourceClientProgramId: string | null;
      details?: {
        content: string | null;
        preparationRequired: string | null;
        eventLifecycle: "provisory" | "committed";
        proposalKind: "assignment" | "reschedule" | null;
        availabilityRequestId: string | null;
      };
    }>;
    calendarEventsUnavailable: boolean;
  };
  campaigns: Diagnostic[];
  selectedCampaign: Diagnostic | null;
  dashboard: {
    totals: { responses: number; topics: number; activeSectors: number };
    riskDistribution: { low: number; medium: number; high: number; critical: number };
    topics: TopicRow[];
    sectors: SectorRow[];
    metrics?: {
      dataset: {
        totalRows: number;
        visibleRows: number;
        sample: Array<{
          employee_id: string;
          sector: string;
          risk_factor: string;
          topic_id: number;
          score: number;
          timestamp: string;
        }>;
      };
      global: {
        riskIndex: number | null;
        psychosocialLoadIndex: number | null;
        riskConcentration: number | null;
        criticalExposure: number | null;
        criticalExposureEmployees: number;
        employeesEvaluated: number;
        gravityScoreScaleMax?: number;
        gravitySeverityWeightSource?: "topic_default" | "company_risk_profile_occurrence_risk";
        companyOccurrenceRiskWeight?: number | null;
        companyRiskProfileReportId?: string | null;
      };
      riskFactors: RiskFactorMetric[];
      ranking: RiskFactorMetric[];
      riskMatrix: Array<{
        topicId: number;
        riskFactor: string;
        probability: number | null;
        severity: number;
        riskScore: number | null;
        affectedEmployees: number;
        category: "low" | "moderate" | "high" | "critical" | null;
      }>;
      heatmap: {
        columns: Array<{
          topicId: number;
          riskFactor: string;
        }>;
        rows: Array<{
          sector: string;
          nResponses: number;
          suppressed: boolean;
          sectorRiskIndex: number | null;
          cells: Array<{
            topicId: number;
            riskFactor: string;
            meanExposure: number | null;
            exposureLevel: "low" | "moderate" | "high" | "critical" | null;
          }>;
        }>;
      };
      trends: RiskFactorTrendSeries[];
      sectorRanking: Array<{
        sector: string;
        sectorRiskIndex: number | null;
        category: "low" | "moderate" | "high" | "critical" | null;
        responses: number;
      }>;
    };
  } | null;
  reports?: Array<{
    id: string;
    report_title: string;
    status: "draft" | "processing" | "ready" | "failed";
    created_at: string;
  }>;
  invoices?: Array<{
    id: string;
    amount: number;
    status: "Paid" | "Pending" | "Overdue";
    dueDate: string;
  }>;
};

type EvaluationEntry = {
  createdAt: string;
  scores: number[];
};

type SectorLink = {
  id: string;
  name: string;
  accessLink: string;
  isActive: boolean;
  submissionCount: number;
  lastSubmittedAt: string | null;
};

type SectorPayload = {
  campaign: { id: string; name: string; slug: string };
  sectors: SectorLink[];
};
const PORTAL_ANNUAL_PLAN_COLUMNS = 12;
const annualPlanMonthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;

function fmtDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

function fmtDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function fmtDuration(startValue: string, endValue: string) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "-";

  const totalMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}min`);
  return parts.join(" ");
}

function chronogramStatusBadge(value: "scheduled" | "completed" | "cancelled") {
  if (value === "completed") {
    return {
      label: "Completed",
      className: "border-[#bde4c9] bg-[#e8f8ee] text-[#1f6b3d]",
    };
  }
  if (value === "cancelled") {
    return {
      label: "Cancelled",
      className: "border-[#e2d2d2] bg-[#f8eded] text-[#8a2d2d]",
    };
  }
  return {
    label: "Scheduled",
    className: "border-[#c8dce8] bg-[#edf5fa] text-[#2c546a]",
  };
}

function fmtCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatFrequencyLabel(value: string | null | undefined) {
  if (!value) return "-";
  if (value === "weekly") return "Semanal";
  if (value === "biweekly") return "Quinzenal";
  if (value === "monthly") return "Mensal";
  if (value === "quarterly") return "Trimestral";
  if (value === "semiannual") return "Semestral";
  if (value === "annual") return "Anual";
  if (value === "custom") return "Personalizada";
  return value;
}

function toMonthKey(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function buildAnnualPlanColumns(start: Date, count = PORTAL_ANNUAL_PLAN_COLUMNS): Array<{ key: string; label: string }> {
  const columns: Array<{ key: string; label: string }> = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const formatter = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" });
  for (let index = 0; index < count; index += 1) {
    const date = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + index, 1));
    columns.push({
      key: toMonthKey(date),
      label: formatter.format(date).replace(".", ""),
    });
  }
  return columns;
}

function normalizeAnnualPlanMonths(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    const normalized = typeof item === "string" ? item.trim() : "";
    if (!annualPlanMonthRegex.test(normalized)) continue;
    unique.add(normalized);
  }
  return Array.from(unique.values()).sort();
}

function extractProgramAnnualPlanMonths(
  program: NonNullable<ClientPortalPayload["assignedPrograms"]>[number],
  events: NonNullable<ClientPortalPayload["masterCalendar"]>["events"] | undefined,
): string[] {
  const explicit = normalizeAnnualPlanMonths(program.annualPlanMonths);
  if (explicit.length > 0) return explicit;

  const fallback = new Set<string>();
  for (const event of events ?? []) {
    if (event.sourceClientProgramId !== program.id) continue;
    if (event.eventType !== "continuous_meeting") continue;
    if (event.status === "cancelled") continue;
    const start = new Date(event.startsAt);
    if (Number.isNaN(start.getTime())) continue;
    fallback.add(toMonthKey(start));
  }
  return Array.from(fallback.values()).sort();
}

function formatBytes(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "-";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function csvEscape(value: string | number | null): string {
  if (value === null) return "";
  return `"${String(value).replace(/"/g, '""')}"`;
}

function useClientPortalData(
  clientSlug: string,
  campaignId?: string,
  reloadToken = 0,
  sectorFilter?: string,
) {
  const [data, setData] = useState<ClientPortalPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    async function load() {
      setIsLoading(true);
      setError("");
      try {
        const queryParams = new URLSearchParams();
        if (campaignId) {
          queryParams.set("campaignId", campaignId);
        }
        const normalizedSectorFilter = (sectorFilter ?? "").trim();
        if (normalizedSectorFilter.length > 0) {
          queryParams.set("sector", normalizedSectorFilter);
        }
        const query = queryParams.size > 0 ? `?${queryParams.toString()}` : "";
        const response = await fetch(`/api/client/portal/${clientSlug}${query}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Could not load client data.");
        }
        const payload = (await response.json()) as ClientPortalPayload;
        if (!ignore) {
          setData(payload);
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : "Could not load client data.");
          setData(null);
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [campaignId, clientSlug, reloadToken, sectorFilter]);

  return { data, isLoading, error };
}

function questionnaireCollectionStatus(status: Diagnostic["status"]) {
  if (status === "live") return "Questionario aberto (coletando respostas)";
  if (status === "closed") return "Questionario fechado";
  if (status === "draft") return "Questionario em rascunho";
  return "Questionario arquivado";
}

function RiskBadge({ risk }: { risk: "low" | "medium" | "high" | "critical" | null | undefined }) {
  const classes =
    risk === "low"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : risk === "medium"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : risk === "high"
          ? "border-orange-200 bg-orange-50 text-orange-700"
          : risk === "critical"
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-slate-200 bg-slate-50 text-slate-600";
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${classes}`}>{risk ?? "n/a"}</span>;
}

function fmtPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function normalizeMetricLabel(
  value: "low" | "moderate" | "medium" | "high" | "critical" | "rare" | "occasional" | "frequent" | "very_frequent" | null | undefined,
) {
  if (!value) return "n/a";
  const labels: Record<string, string> = {
    low: "low",
    moderate: "moderate",
    medium: "moderate",
    high: "high",
    critical: "critical",
    rare: "rare",
    occasional: "occasional",
    frequent: "frequent",
    very_frequent: "very frequent",
  };
  return labels[value] ?? value;
}

function metricTone(
  value: "low" | "moderate" | "medium" | "high" | "critical" | "rare" | "occasional" | "frequent" | "very_frequent" | null | undefined,
) {
  if (!value) return "border-slate-200 bg-slate-50 text-slate-600";
  if (value === "low" || value === "rare") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "moderate" || value === "medium" || value === "occasional") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (value === "high" || value === "frequent") return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function metricBarTone(value: "low" | "moderate" | "medium" | "high" | "critical" | null | undefined) {
  if (!value) return "bg-slate-400";
  if (value === "low") return "bg-emerald-500";
  if (value === "moderate" || value === "medium") return "bg-amber-500";
  if (value === "high") return "bg-orange-500";
  return "bg-rose-500";
}

function heatCellColor(meanExposure: number | null) {
  if (meanExposure === null) return "bg-slate-100 text-slate-500";
  if (meanExposure <= 2) return "bg-emerald-100 text-emerald-800";
  if (meanExposure <= 3) return "bg-amber-100 text-amber-800";
  if (meanExposure <= 4) return "bg-orange-100 text-orange-800";
  return "bg-rose-100 text-rose-800";
}

function riskScoreBand(score: number | null | undefined, maxScore = 5) {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  const normalized = Math.min(1, Math.max(0, score / Math.max(maxScore, Number.EPSILON)));
  if (normalized < 0.25) return "low";
  if (normalized < 0.5) return "moderate";
  if (normalized < 0.75) return "high";
  return "critical";
}

function riskScoreTone(score: number | null | undefined, maxScore = 5) {
  return metricTone(riskScoreBand(score, maxScore));
}

function riskScoreRowTone(score: number | null | undefined, maxScore = 5) {
  const band = riskScoreBand(score, maxScore);
  if (band === "low") return "bg-emerald-50/40";
  if (band === "moderate") return "bg-amber-50/40";
  if (band === "high") return "bg-orange-50/40";
  if (band === "critical") return "bg-rose-50/40";
  return "";
}

function topicCode(topicId: number) {
  return `T${String(topicId).padStart(2, "0")}`;
}

const TOPIC_SHORT_NAMES: Record<number, string> = {
  1: "Assedio",
  2: "Suporte",
  3: "Mudancas",
  4: "Clareza",
  5: "Reconhecimento",
  6: "Autonomia",
  7: "Justica",
  8: "Traumaticos",
  9: "Subcarga",
  10: "Sobrecarga",
  11: "Relacionamentos",
  12: "Comunicacao",
  13: "Remoto/isolado",
};

function shortRiskName(label: string, topicId?: number) {
  if (topicId && TOPIC_SHORT_NAMES[topicId]) return TOPIC_SHORT_NAMES[topicId];
  const normalized = label.trim();
  const topicMatch = normalized.match(/(?:^|\b)(?:t|topico)\s*0?([1-9]|1[0-3])\b/i);
  if (topicMatch) {
    const code = Number(topicMatch[1]);
    if (TOPIC_SHORT_NAMES[code]) return TOPIC_SHORT_NAMES[code];
  }
  const aliases: Array<{ pattern: RegExp; alias: string }> = [
    { pattern: /assedio/i, alias: "Assedio" },
    { pattern: /suporte/i, alias: "Suporte" },
    { pattern: /mudanc/i, alias: "Mudancas" },
    { pattern: /clareza/i, alias: "Clareza" },
    { pattern: /reconhec/i, alias: "Reconhecimento" },
    { pattern: /autonom/i, alias: "Autonomia" },
    { pattern: /justic/i, alias: "Justica" },
    { pattern: /trauma|violent/i, alias: "Traumaticos" },
    { pattern: /subcarg|baixa demanda/i, alias: "Subcarga" },
    { pattern: /sobrecarg|excesso/i, alias: "Sobrecarga" },
    { pattern: /relacion/i, alias: "Relacionamentos" },
    { pattern: /comunic/i, alias: "Comunicacao" },
    { pattern: /remoto|isolado/i, alias: "Remoto/isolado" },
  ];
  const matched = aliases.find((entry) => entry.pattern.test(normalized));
  if (matched) return matched.alias;
  if (normalized.length <= 18) return normalized;
  return `${normalized.slice(0, 16)}...`;
}

function normalizeSectorLookupValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function parseTrendPeriodToUtcMs(period: string): number | null {
  const monthlyMatch = period.match(/^(\d{4})-(\d{2})$/);
  if (monthlyMatch) {
    const year = Number(monthlyMatch[1]);
    const month = Number(monthlyMatch[2]);
    if (month >= 1 && month <= 12) {
      return Date.UTC(year, month - 1, 1);
    }
  }

  const parsed = new Date(period);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getTime();
}

function formatTrendPeriodLabel(period: string): string {
  const monthlyMatch = period.match(/^(\d{4})-(\d{2})$/);
  if (monthlyMatch) {
    const year = Number(monthlyMatch[1]);
    const month = Number(monthlyMatch[2]);
    if (month >= 1 && month <= 12) {
      return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" })
        .format(new Date(Date.UTC(year, month - 1, 1)))
        .replace(".", "");
    }
  }

  const dayMatch = period.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dayMatch) {
    const year = Number(dayMatch[1]);
    const month = Number(dayMatch[2]);
    const day = Number(dayMatch[3]);
    return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
      new Date(Date.UTC(year, month - 1, day)),
    );
  }

  const parsed = new Date(period);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(parsed);
  }

  return period;
}

function roundMetricValue(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function weightedAverage(entries: Array<{ value: number; weight: number }>): number | null {
  const valid = entries.filter((entry) => Number.isFinite(entry.value) && Number.isFinite(entry.weight) && entry.weight > 0);
  if (valid.length === 0) return null;
  const totalWeight = valid.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return null;
  return valid.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight;
}

function weightedAverageNullable(entries: Array<{ value: number | null; weight: number }>): number | null {
  return weightedAverage(
    entries
      .filter((entry): entry is { value: number; weight: number } => entry.value !== null)
      .map((entry) => ({ value: entry.value, weight: entry.weight })),
  );
}

function aggregateTrendSeriesForAllSectors(series: RiskFactorTrendSeries[]): RiskFactorTrendSeries[] {
  if (series.length === 0) return [];

  const topicBuckets = new Map<
    number,
    {
      riskFactor: string;
      periods: Map<string, RiskFactorTrendSeries["points"]>;
    }
  >();

  for (const item of series) {
    const topicBucket = topicBuckets.get(item.topicId) ?? {
      riskFactor: item.riskFactor,
      periods: new Map<string, RiskFactorTrendSeries["points"]>(),
    };

    for (const point of item.points) {
      const list = topicBucket.periods.get(point.period) ?? [];
      list.push(point);
      topicBucket.periods.set(point.period, list);
    }

    topicBuckets.set(item.topicId, topicBucket);
  }

  return Array.from(topicBuckets.entries())
    .map(([topicId, bucket]) => {
      const points = Array.from(bucket.periods.entries())
        .map(([period, entries]) => {
          const totalResponses = entries.reduce((sum, entry) => sum + Math.max(entry.responses, 0), 0);
          if (totalResponses <= 0) return null;

          const meanExposure =
            weightedAverage(
              entries.map((entry) => ({
                value: entry.meanExposure,
                weight: entry.responses,
              })),
            ) ?? 0;

          const varianceNumerator = entries.reduce((sum, entry) => {
            const weight = Math.max(entry.responses, 0);
            if (weight <= 0) return sum;
            const within = entry.stdDevExposure ** 2;
            const between = (entry.meanExposure - meanExposure) ** 2;
            return sum + weight * (within + between);
          }, 0);
          const stdDevExposure = Math.sqrt(Math.max(0, varianceNumerator / totalResponses));

          const prevalence = weightedAverageNullable(
            entries.map((entry) => ({
              value: entry.prevalence,
              weight: entry.responses,
            })),
          );
          const severityIndex =
            weightedAverageNullable(
              entries.map((entry) => ({
                value: entry.severityIndex,
                weight: entry.responses,
              })),
            ) ?? Math.min(1, Math.max(0, meanExposure / 5));

          const severity = entries[0]?.severity ?? 3;
          const probability =
            weightedAverage(
              entries.map((entry) => ({
                value: entry.probability,
                weight: entry.responses,
              })),
            ) ??
            prevalence ??
            Math.min(1, Math.max(0, (meanExposure - 1) / 4));
          const riskScore = probability * severity;

          return {
            period,
            meanExposure: roundMetricValue(meanExposure),
            stdDevExposure: roundMetricValue(stdDevExposure),
            prevalence: prevalence === null ? null : roundMetricValue(prevalence),
            severityIndex: roundMetricValue(severityIndex),
            probability: roundMetricValue(probability),
            severity,
            riskScore: roundMetricValue(riskScore),
            responses: totalResponses,
          };
        })
        .filter((point): point is NonNullable<typeof point> => point !== null)
        .sort((left, right) => {
          const leftTime = parseTrendPeriodToUtcMs(left.period);
          const rightTime = parseTrendPeriodToUtcMs(right.period);
          if (leftTime === null && rightTime === null) return left.period.localeCompare(right.period);
          if (leftTime === null) return 1;
          if (rightTime === null) return -1;
          return leftTime - rightTime;
        });

      return {
        topicId,
        riskFactor: bucket.riskFactor,
        sector: "Aggregate",
        points,
      } as RiskFactorTrendSeries;
    })
    .filter((item) => item.points.length > 0)
    .sort((left, right) => left.topicId - right.topicId);
}

function riskGradientColorFromRatio(ratio: number): string {
  const clamped = Math.min(1, Math.max(0, ratio));
  const green = { r: 22, g: 163, b: 74 };
  const orange = { r: 245, g: 158, b: 11 };
  const red = { r: 220, g: 38, b: 38 };

  const lerp = (start: number, end: number, t: number) => Math.round(start + (end - start) * t);
  const toHex = (value: number) => value.toString(16).padStart(2, "0");

  const from = clamped <= 0.5 ? green : orange;
  const to = clamped <= 0.5 ? orange : red;
  const localT = clamped <= 0.5 ? clamped / 0.5 : (clamped - 0.5) / 0.5;

  const r = lerp(from.r, to.r, localT);
  const g = lerp(from.g, to.g, localT);
  const b = lerp(from.b, to.b, localT);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const PLOT_INFO_CONTENT: Record<
  PlotInfoKey,
  {
    title: string;
    whatItShows: string;
    howToUse: string[];
  }
> = {
  heatmap: {
    title: "Risk Heatmap",
    whatItShows:
      "Rows are sectors and columns are risk factors. Each cell is the mean exposure score (1-5) for that sector and risk.",
    howToUse: [
      "Start by scanning for orange and red cells to identify concentrated hotspots.",
      "Compare sectors in the same column to find where each risk is most intense.",
      "Prioritize interventions where high mean exposure aligns with high prevalence in the metrics table.",
    ],
  },
  matrix: {
    title: "Risk Matrix",
    whatItShows:
      "Each bubble is one risk factor. X-axis is probability of occurrence, Y-axis is observed severity (from responses), bubble size represents affected employees, and color indicates gravity class.",
    howToUse: [
      "Color (gravity) uses risk score = probability x fixed occurrence-risk weight from the company risk profile questionnaire.",
      "Y-axis (severity) uses observed mean exposure from responses.",
      "Focus first on the upper-right quadrant, where probability and observed severity are both high.",
      "Use bubble size to prioritize actions with the largest exposed population.",
      "Track movement over time: right/up means deterioration, left/down means mitigation.",
    ],
  },
  radar: {
    title: "Sector Radar Profile",
    whatItShows:
      "Overlays multiple sector profiles across all risk factors, allowing comparison of risk shape and intensity between sectors.",
    howToUse: [
      "Identify spikes to find which risk dimensions dominate each sector profile.",
      "Compare radar shape between sectors to identify localized hotspots versus systemic risks.",
      "Compare radar shape across survey cycles to check if interventions are balancing each profile.",
      "Use with matrix and prevalence to distinguish broad stress climate from isolated acute risks.",
    ],
  },
  distribution: {
    title: "Distribution Plots",
    whatItShows:
      "For each risk factor, bars show counts in scores 1 to 5, plus the factor mean and standard deviation.",
    howToUse: [
      "Look for right-skewed distributions (4-5) as early warning for chronic exposure.",
      "Look for polarized distributions to detect unequal exposure and potential subgroup harm.",
      "Use mean and sd together: high mean + high sd often indicates both severity and inequality of exposure.",
    ],
  },
  ranking: {
    title: "Critical Risk Ranking",
    whatItShows:
      "Sorted list of risk factors by risk score (probability x company occurrence-risk weight), with prevalence context.",
    howToUse: [
      "Use the top risks as immediate priorities for executive action plans.",
      "Cross-check with Heatmap Risk Index to target interventions where each top risk is concentrated.",
      "Use rank changes between cycles to evaluate intervention impact.",
    ],
  },
  trend: {
    title: "Trend Analysis",
    whatItShows:
      "Time series by risk factor and sector, tracking mean exposure and standard deviation by period.",
    howToUse: [
      "Rising mean trend indicates worsening climate and higher legal/operational exposure.",
      "Increasing sd indicates dispersion growth (unequal exposure across respondents in that sector).",
      "Flat high trend indicates persistent structural risk requiring stronger controls.",
      "Use pre/post intervention points to verify whether actions reduced exposure.",
    ],
  },
};

export function ClientCompanyDataSection({ clientSlug }: { clientSlug: string }) {
  const { data, isLoading, error } = useClientPortalData(clientSlug);

  if (isLoading) return <p className="text-sm text-[#49697a]">Loading company data...</p>;
  if (error || !data) return <p className="text-sm text-red-600">{error || "Company data unavailable."}</p>;

  const total = Math.max(data.client.totalEmployees, 1);
  const remotePct = Math.round((data.client.remoteEmployees / total) * 100);
  const onsitePct = Math.round((data.client.onsiteEmployees / total) * 100);
  const hybridPct = Math.round((data.client.hybridEmployees / total) * 100);

  return (
    <div className="space-y-6">
      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">Company Data</h2>
        <p className="mt-1 text-sm text-[#475660]">
          {data.client.companyName} | CNPJ {data.client.cnpj} | Status {data.client.status}
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <article className="rounded-2xl border border-[#dfdfdf] bg-[#f8f8f8] p-4 shadow-sm">
          <p className="text-xs text-[#4f6977]">Total employees</p>
          <p className="mt-1 text-2xl font-semibold text-[#133748]">{data.client.totalEmployees}</p>
        </article>
        <article className="rounded-2xl border border-[#dfdfdf] bg-[#f8f8f8] p-4 shadow-sm">
          <p className="text-xs text-[#4f6977]">Home office ratio</p>
          <p className="mt-1 text-2xl font-semibold text-[#133748]">{remotePct}%</p>
        </article>
        <article className="rounded-2xl border border-[#dfdfdf] bg-[#f8f8f8] p-4 shadow-sm">
          <p className="text-xs text-[#4f6977]">Presential ratio</p>
          <p className="mt-1 text-2xl font-semibold text-[#133748]">{onsitePct}%</p>
        </article>
        <article className="rounded-2xl border border-[#dfdfdf] bg-[#f8f8f8] p-4 shadow-sm">
          <p className="text-xs text-[#4f6977]">Hybrid ratio</p>
          <p className="mt-1 text-2xl font-semibold text-[#133748]">{hybridPct}%</p>
        </article>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">Metricas por setor (ultimo diagnostico DRPS)</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Department</th>
                <th className="px-2 py-2 text-left">Responses</th>
                <th className="px-2 py-2 text-left">Adjusted risk index</th>
                <th className="px-2 py-2 text-left">Risk class</th>
              </tr>
            </thead>
            <tbody>
              {(data.dashboard?.sectors ?? []).map((sector) => (
                <tr key={sector.sector} className="border-b">
                  <td className="px-2 py-2">{sector.sector}</td>
                  <td className="px-2 py-2">{sector.nResponses}</td>
                  <td className="px-2 py-2">
                    {sector.adjustedRiskIndex !== null ? sector.adjustedRiskIndex.toFixed(2) : "-"}
                  </td>
                  <td className="px-2 py-2">
                    <RiskBadge risk={sector.adjustedRiskClass} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function ClientDiagnosticStatusSection({ clientSlug }: { clientSlug: string }) {
  const router = useRouter();
  const { data, isLoading, error } = useClientPortalData(clientSlug);
  const [linksPayload, setLinksPayload] = useState<SectorPayload | null>(null);
  const [isLinksModalOpen, setIsLinksModalOpen] = useState(false);
  const [isLoadingLinksFor, setIsLoadingLinksFor] = useState<string | null>(null);
  const [copiedSectorId, setCopiedSectorId] = useState<string | null>(null);
  const [actionsError, setActionsError] = useState("");

  async function loadQuestionnaireLinks(diagnostic: Diagnostic) {
    setIsLoadingLinksFor(diagnostic.id);
    setActionsError("");
    setLinksPayload(null);
    setIsLinksModalOpen(false);
    try {
      const response = await fetch(
        `/api/client/portal/${clientSlug}/campaigns/${diagnostic.id}/sectors`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setActionsError("Falha ao carregar links do questionario.");
        return;
      }
      setLinksPayload((await response.json()) as SectorPayload);
      setCopiedSectorId(null);
      setIsLinksModalOpen(true);
    } catch {
      setActionsError("Falha ao carregar links do questionario.");
    } finally {
      setIsLoadingLinksFor(null);
    }
  }

  async function copySectorLink(sector: SectorLink) {
    if (!sector.isActive) {
      return;
    }
    await navigator.clipboard.writeText(sector.accessLink);
    setCopiedSectorId(sector.id);
    window.setTimeout(() => setCopiedSectorId(null), 1200);
  }

  async function copyAllLinks() {
    if (!linksPayload) return;
    const lines = linksPayload.sectors
      .filter((sector) => sector.isActive)
      .map((sector) => `${sector.name}: ${sector.accessLink}`);
    if (lines.length === 0) {
      setActionsError("Nenhum setor ativo para copiar.");
      return;
    }
    await navigator.clipboard.writeText(lines.join("\n"));
  }

  function exportLinksCsv() {
    if (!linksPayload) return;
    const header = ["campaign_id", "campaign_slug", "sector", "active", "submission_count", "access_link"].join(
      ",",
    );
    const rows = linksPayload.sectors.map((sector) =>
      [
        csvEscape(linksPayload.campaign.id),
        csvEscape(linksPayload.campaign.slug),
        csvEscape(sector.name),
        csvEscape(sector.isActive ? "true" : "false"),
        csvEscape(sector.submissionCount),
        csvEscape(sector.isActive ? sector.accessLink : null),
      ].join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${linksPayload.campaign.slug || linksPayload.campaign.id}-links-questionario.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function closeLinksModal() {
    setIsLinksModalOpen(false);
    setCopiedSectorId(null);
  }

  if (isLoading) return <p className="text-sm text-[#49697a]">Carregando diagnosticos DRPS...</p>;
  if (error || !data) return <p className="text-sm text-red-600">{error || "Diagnostic unavailable."}</p>;
  const openCampaigns = data.campaigns.filter((campaign) => campaign.status === "live");
  const hasClosedCampaigns = data.campaigns.some((campaign) => campaign.status === "closed");
  const resultsCampaign =
    (data.selectedCampaign &&
      (data.selectedCampaign.status === "live" || data.selectedCampaign.status === "closed")
      ? data.selectedCampaign
      : null) ??
    data.campaigns.find((campaign) => campaign.status === "live") ??
    data.campaigns.find((campaign) => campaign.status === "closed") ??
    null;
  const linksActionCampaign = data.selectedCampaign?.status === "live" ? data.selectedCampaign : openCampaigns[0] ?? null;

  return (
    <div className="space-y-6">
      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold text-[#141d24]">Diagnosticos DRPS (status e resultados)</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!resultsCampaign}
              onClick={() => {
                if (!resultsCampaign) return;
                router.push(`/client/${clientSlug}/diagnostic/${resultsCampaign.id}`);
              }}
              className="rounded-full border border-[#c8c8c8] px-3 py-1 text-xs font-semibold text-[#1b2832] disabled:cursor-not-allowed disabled:border-[#d6dde2] disabled:text-[#95a4ae]"
            >
              Ver resultados
            </button>
            <button
              type="button"
              disabled={!linksActionCampaign || isLoadingLinksFor === linksActionCampaign.id}
              onClick={() => {
                if (!linksActionCampaign) return;
                void loadQuestionnaireLinks(linksActionCampaign);
              }}
              className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73] disabled:cursor-not-allowed disabled:border-[#d6dde2] disabled:text-[#95a4ae]"
            >
              {linksActionCampaign && isLoadingLinksFor === linksActionCampaign.id
                ? "Carregando..."
                : "Gerar link questionario"}
            </button>
          </div>
        </div>
        <p className="mt-1 text-sm text-[#475660]">
          Diagnosticos DRPS atribuidos pelo gestor com status de coleta e acesso ao resultado.
        </p>
        <p className="mt-1 text-xs text-[#5a7383]">
          {data.selectedCampaign
            ? `Questionario atual: ${questionnaireCollectionStatus(data.selectedCampaign.status)}`
            : "Sem questionario selecionado."}
        </p>
      </section>

      <section className="h-auto max-h-none overflow-visible rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <div className="max-h-none overflow-x-auto overflow-y-visible">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Diagnostico</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Janela</th>
                <th className="px-2 py-2 text-left">Respostas</th>
              </tr>
            </thead>
            <tbody>
              {openCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-3 text-[#5a7383]">
                    {hasClosedCampaigns
                      ? "Nao ha questionarios abertos. Os diagnosticos existentes estao fechados."
                      : "Nenhum diagnostico DRPS atribuido."}
                  </td>
                </tr>
              ) : (
                openCampaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-b">
                    <td className="px-2 py-2">{campaign.name}</td>
                    <td className="px-2 py-2">{questionnaireCollectionStatus(campaign.status)}</td>
                    <td className="px-2 py-2">
                      {fmtDate(campaign.starts_at)} - {fmtDate(campaign.closes_at)}
                    </td>
                    <td className="px-2 py-2">{campaign.responses}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      {actionsError ? <p className="text-sm text-red-600">{actionsError}</p> : null}
      {isLinksModalOpen && linksPayload ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          onClick={closeLinksModal}
        >
          <div
            className="w-full max-w-5xl rounded-2xl border border-[#d9d9d9] bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-lg font-semibold text-[#141d24]">
                Links do questionario: {linksPayload.campaign.name}
              </h4>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyAllLinks()}
                  className="rounded-full border border-[#b9d8a5] px-3 py-1 text-xs font-semibold text-[#2d5f23]"
                >
                  Copiar todos
                </button>
                <button
                  type="button"
                  onClick={exportLinksCsv}
                  className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                >
                  Exportar CSV
                </button>
                <button
                  type="button"
                  onClick={closeLinksModal}
                  className="rounded-full border border-[#c8c8c8] px-3 py-1 text-xs font-semibold text-[#1b2832]"
                >
                  Fechar
                </button>
              </div>
            </div>
            <div className="mt-4 max-h-[65vh] overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left">Setor</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-left">Respostas</th>
                    <th className="px-2 py-2 text-left">Ultimo envio</th>
                    <th className="px-2 py-2 text-left">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {linksPayload.sectors.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-2 py-3 text-xs text-[#5a7383]">
                        Nenhum setor configurado para este diagnostico.
                      </td>
                    </tr>
                  ) : (
                    linksPayload.sectors.map((sector) => (
                      <tr key={sector.id} className="border-b">
                        <td className="px-2 py-2">{sector.name}</td>
                        <td className="px-2 py-2">{sector.isActive ? "Ativo" : "Inativo"}</td>
                        <td className="px-2 py-2">{sector.submissionCount}</td>
                        <td className="px-2 py-2">{fmtDate(sector.lastSubmittedAt)}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <input
                              readOnly
                              value={sector.isActive ? sector.accessLink : "Setor inativo (link bloqueado)"}
                              className="w-full min-w-[280px] rounded border border-[#d5e2ea] bg-[#f7fbfe] px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              disabled={!sector.isActive}
                              onClick={() => void copySectorLink(sector)}
                              className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73] disabled:cursor-not-allowed disabled:border-[#d6dde2] disabled:text-[#95a4ae]"
                            >
                              {!sector.isActive ? "Inativo" : copiedSectorId === sector.id ? "Copiado" : "Copiar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ClientDiagnosticAggregateResultsSection({
  clientSlug,
  campaignId,
  fromHistory = false,
  managerClientId,
  managerClientName,
  managerFromHome = false,
  sectorFilter,
}: {
  clientSlug: string;
  campaignId: string;
  fromHistory?: boolean;
  managerClientId?: string;
  managerClientName?: string | null;
  managerFromHome?: boolean;
  sectorFilter?: string;
}) {
  const { data: aggregateData, isLoading: isLoadingAggregateMeta } = useClientPortalData(clientSlug, campaignId, 0);
  const campaignLabel = aggregateData?.selectedCampaign?.name ?? "Resultados do diagnostico";
  const sectorOptions = useMemo(() => {
    const sectors = aggregateData?.dashboard?.sectors ?? [];
    return sectors
      .filter((sector) => sector.nResponses > 0 && !sector.suppressed)
      .slice()
      .sort((left, right) => left.sector.localeCompare(right.sector, "pt-BR"))
      .map((sector) => sector.sector);
  }, [aggregateData?.dashboard?.sectors]);
  const requestedPerSector = (sectorFilter ?? "").trim();
  const [selectedPerSector, setSelectedPerSector] = useState(() => requestedPerSector);
  const [activeResultsTab, setActiveResultsTab] = useState<"aggregate" | "per-sector">(() =>
    requestedPerSector.length > 0 ? "per-sector" : "aggregate",
  );
  const pendingScrollRestoreY = useRef<number | null>(null);

  function resolveSectorName(candidate: string): string | null {
    const normalizedCandidate = candidate.trim();
    if (!normalizedCandidate) return null;
    const candidateLookup = normalizeSectorLookupValue(normalizedCandidate);
    const matched =
      sectorOptions.find((sectorName) => normalizeSectorLookupValue(sectorName) === candidateLookup) ?? null;
    if (matched) return matched;
    return sectorOptions.length === 0 ? normalizedCandidate : null;
  }

  const effectivePerSector =
    resolveSectorName(selectedPerSector) ??
    resolveSectorName(requestedPerSector) ??
    sectorOptions[0] ??
    "";
  const managerRawDataDownloadHref = managerClientId
    ? `/api/admin/clients/${managerClientId}/campaigns/${campaignId}/responses/raw-download`
    : null;

  useEffect(() => {
    if (pendingScrollRestoreY.current === null || typeof window === "undefined") return;
    const restoreY = pendingScrollRestoreY.current;
    pendingScrollRestoreY.current = null;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: restoreY, behavior: "auto" });
    });
  }, [selectedPerSector]);

  return (
    <div className="space-y-6">
      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold text-[#141d24]">DRPS Results Report</h2>
          {managerRawDataDownloadHref ? (
            <a
              href={managerRawDataDownloadHref}
              className="rounded-full border border-[#9ec8db] bg-white px-3 py-1.5 text-xs font-semibold text-[#0f5b73] hover:bg-[#f1f8fc]"
            >
              Download raw data
            </a>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-[#475660]">
          {campaignLabel} | Aggregate and per-sector views in a single page.
        </p>
        <div className="mt-4 inline-flex rounded-full border border-[#c6d8e4] bg-white p-1">
          <button
            type="button"
            onClick={() => setActiveResultsTab("aggregate")}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              activeResultsTab === "aggregate" ? "bg-[#eaf5fb] text-[#0f5b73]" : "text-[#24485a]"
            }`}
          >
            Aggregate results
          </button>
          <button
            type="button"
            onClick={() => setActiveResultsTab("per-sector")}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              activeResultsTab === "per-sector" ? "bg-[#eaf5fb] text-[#0f5b73]" : "text-[#24485a]"
            }`}
          >
            Per-sector results
          </button>
        </div>
      </section>

      {activeResultsTab === "aggregate" ? (
        <section className="space-y-4">
          <div className="rounded-[22px] border border-[#dde8ef] bg-white p-4 shadow-sm">
            <h3 className="text-lg font-semibold text-[#123447]">Aggregate Results (all sectors)</h3>
            <p className="mt-1 text-xs text-[#567180]">
              Risk Heatmap, Sector Radar Profile, aggregate Risk Matrix, aggregate Risk Factors, Distribution Plots,
              and Response Dataset Preview.
            </p>
          </div>
          <ClientDiagnosticResultsSection
            clientSlug={clientSlug}
            campaignId={campaignId}
            fromHistory={fromHistory}
            managerClientId={managerClientId}
            managerClientName={managerClientName}
            managerFromHome={managerFromHome}
            embeddedView
          />
        </section>
      ) : (
        <section className="space-y-4">
          <div className="rounded-[22px] border border-[#dde8ef] bg-white p-4 shadow-sm">
            <div>
              <h3 className="text-lg font-semibold text-[#123447]">Per-Sector Results</h3>
              <p className="mt-1 text-xs text-[#567180]">
                Current report layout with data isolated by selected sector.
              </p>
            </div>

            {isLoadingAggregateMeta ? (
              <p className="mt-3 text-xs text-[#567180]">Loading sector selector...</p>
            ) : sectorOptions.length === 0 ? (
              <p className="mt-3 text-xs text-[#567180]">
                No sectors with eligible responses available for isolated per-sector results.
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {sectorOptions.map((sectorName) => (
                  <button
                    key={`per-sector-nav-${sectorName}`}
                    type="button"
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        pendingScrollRestoreY.current = window.scrollY;
                      }
                      setSelectedPerSector(sectorName);
                    }}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                      effectivePerSector === sectorName
                        ? "border-[#0f5b73] bg-[#e8f4f9] text-[#0f5b73]"
                        : "border-[#c7d8e2] bg-white text-[#274657]"
                    }`}
                  >
                    {sectorName}
                  </button>
                ))}
              </div>
            )}
          </div>

          {effectivePerSector ? (
            <ClientDiagnosticResultsSection
              clientSlug={clientSlug}
              campaignId={campaignId}
              fromHistory={fromHistory}
              managerClientId={managerClientId}
              managerClientName={managerClientName}
              managerFromHome={managerFromHome}
              sectorFilter={effectivePerSector}
              embeddedView
            />
          ) : null}
        </section>
      )}
    </div>
  );
}

export function ClientDiagnosticResultsSection({
  clientSlug,
  campaignId,
  fromHistory = false,
  managerClientId,
  managerClientName,
  managerFromHome = false,
  sectorFilter,
  embeddedView = false,
}: {
  clientSlug: string;
  campaignId: string;
  fromHistory?: boolean;
  managerClientId?: string;
  managerClientName?: string | null;
  managerFromHome?: boolean;
  sectorFilter?: string;
  embeddedView?: boolean;
}) {
  const normalizedSectorFilter = (sectorFilter ?? "").trim();
  const isPerSectorResults = normalizedSectorFilter.length > 0;
  const { data, isLoading, error } = useClientPortalData(
    clientSlug,
    campaignId,
    0,
    normalizedSectorFilter.length > 0 ? normalizedSectorFilter : undefined,
  );

  const campaign = data?.selectedCampaign ?? null;
  const managerBreadcrumbClientLabel = managerClientName?.trim() || data?.client.companyName || "Cliente";
  const dashboard = data?.dashboard ?? null;
  const metrics = dashboard?.metrics;
  const riskScoreScaleMax = Math.max(1, metrics?.global.gravityScoreScaleMax ?? 5);
  const gravityWeightSource = metrics?.global.gravitySeverityWeightSource ?? "topic_default";
  const companyOccurrenceRiskWeight = metrics?.global.companyOccurrenceRiskWeight ?? null;
  const lowMax = riskScoreScaleMax * 0.25;
  const moderateMax = riskScoreScaleMax * 0.5;
  const highMax = riskScoreScaleMax * 0.75;
  const participationSector = useMemo(() => {
    if (!isPerSectorResults) return null;
    const targetLookup = normalizeSectorLookupValue(normalizedSectorFilter);
    return (
      (dashboard?.sectors ?? []).find(
        (sector) => normalizeSectorLookupValue(sector.sector) === targetLookup,
      ) ?? null
    );
  }, [dashboard?.sectors, isPerSectorResults, normalizedSectorFilter]);
  const participationResponses = dashboard?.totals.responses ?? 0;
  const participationTotalEmployees = isPerSectorResults
    ? Math.max(0, participationSector?.employeeCount ?? 0)
    : Math.max(0, data?.client.totalEmployees ?? 0);
  const participationRate =
    participationTotalEmployees > 0 ? participationResponses / participationTotalEmployees : null;
  const rankedRiskFactors = useMemo(
    () =>
      (metrics?.riskFactors ?? [])
        .slice()
        .sort((left, right) => {
          const leftScore = left.riskScore ?? -1;
          const rightScore = right.riskScore ?? -1;
          if (rightScore !== leftScore) return rightScore - leftScore;
          return left.topicId - right.topicId;
        }),
    [metrics?.riskFactors],
  );
  const matrixPoints = (metrics?.riskMatrix ?? [])
    .filter((item) => item.probability !== null && item.riskScore !== null)
    .slice()
    .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0));
  const heatmap = metrics?.heatmap;
  const heatmapRows = useMemo(
    () =>
      (heatmap?.rows ?? [])
        .slice()
        .sort((left, right) => {
          const leftIndex = left.sectorRiskIndex;
          const rightIndex = right.sectorRiskIndex;
          if (leftIndex === null && rightIndex === null) return left.sector.localeCompare(right.sector);
          if (leftIndex === null) return 1;
          if (rightIndex === null) return -1;
          if (rightIndex !== leftIndex) return rightIndex - leftIndex;
          return left.sector.localeCompare(right.sector);
        }),
    [heatmap?.rows],
  );
  const rawTrends = useMemo(() => metrics?.trends ?? [], [metrics?.trends]);
  const trends = useMemo(
    () => {
      if (!isPerSectorResults) {
        return aggregateTrendSeriesForAllSectors(rawTrends);
      }

      const targetSectorLookup = normalizeSectorLookupValue(normalizedSectorFilter);
      const sectorScopedSeries = rawTrends.filter(
        (series) => normalizeSectorLookupValue(series.sector) === targetSectorLookup,
      );

      // Some payloads may include duplicate rows for the same topic/period; collapse them here.
      const sourceSeries = sectorScopedSeries.length > 0 ? sectorScopedSeries : rawTrends;
      return aggregateTrendSeriesForAllSectors(sourceSeries);
    },
    [isPerSectorResults, normalizedSectorFilter, rawTrends],
  );
  const [datasetSectorFilter, setDatasetSectorFilter] = useState(() =>
    isPerSectorResults ? normalizedSectorFilter : "all",
  );
  const [datasetSortKey, setDatasetSortKey] = useState<DatasetSortKey>("timestamp");
  const [datasetSortDirection, setDatasetSortDirection] = useState<"asc" | "desc">("desc");
  const [activePlotInfo, setActivePlotInfo] = useState<PlotInfoKey | null>(null);
  const [trendDetailsModal, setTrendDetailsModal] = useState<TrendDetailsModalState | null>(null);
  const [isolatedRadarSector, setIsolatedRadarSector] = useState<string | null>(null);
  const [selectedAggregateTrendTopicId, setSelectedAggregateTrendTopicId] = useState<number | null>(null);
  const isPerSectorRefreshing = isPerSectorResults && isLoading && Boolean(data);

  const datasetSampleRows = useMemo(() => metrics?.dataset.sample ?? [], [metrics?.dataset.sample]);
  const datasetSectorOptions = useMemo(
    () => Array.from(new Set(datasetSampleRows.map((row) => row.sector))).sort((a, b) => a.localeCompare(b)),
    [datasetSampleRows],
  );
  const resolvedPerSectorDatasetFilter = useMemo(() => {
    if (!isPerSectorResults) return "all";
    const targetLookup = normalizeSectorLookupValue(normalizedSectorFilter);
    return (
      datasetSectorOptions.find((sectorName) => normalizeSectorLookupValue(sectorName) === targetLookup) ??
      normalizedSectorFilter
    );
  }, [datasetSectorOptions, isPerSectorResults, normalizedSectorFilter]);

  const activeDatasetSectorFilter = isPerSectorResults ? resolvedPerSectorDatasetFilter : datasetSectorFilter;
  const distributionScopeLabel = isPerSectorResults ? activeDatasetSectorFilter : "all sectors";

  const datasetRows = useMemo(() => {
    const filtered = datasetSampleRows.filter(
      (row) => activeDatasetSectorFilter === "all" || row.sector === activeDatasetSectorFilter,
    );
    const sorted = filtered.slice().sort((left, right) => {
      if (datasetSortKey === "score") {
        const diff = left.score - right.score;
        return datasetSortDirection === "asc" ? diff : -diff;
      }
      const leftValue = String(left[datasetSortKey]);
      const rightValue = String(right[datasetSortKey]);
      const diff = leftValue.localeCompare(rightValue, "pt-BR", { numeric: true });
      return datasetSortDirection === "asc" ? diff : -diff;
    });
    return sorted;
  }, [activeDatasetSectorFilter, datasetSampleRows, datasetSortDirection, datasetSortKey]);

  function toggleDatasetSort(key: DatasetSortKey) {
    if (datasetSortKey === key) {
      setDatasetSortDirection((previous) => (previous === "asc" ? "desc" : "asc"));
      return;
    }
    setDatasetSortKey(key);
    setDatasetSortDirection(key === "score" ? "desc" : "asc");
  }

  const activePlotInfoContent = activePlotInfo ? PLOT_INFO_CONTENT[activePlotInfo] : null;

  const matrixModel = useMemo(() => {
    if (matrixPoints.length === 0) return null;
    const width = 520;
    const height = 360;
    const padding = { left: 58, right: 28, top: 24, bottom: 48 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const probabilityValues = matrixPoints.map((point) => point.probability ?? 0);
    const severityValues = matrixPoints.map((point) => point.severity);

    const probabilityMinRaw = Math.min(...probabilityValues);
    const probabilityMaxRaw = Math.max(...probabilityValues);
    const severityMinRaw = Math.min(...severityValues);
    const severityMaxRaw = Math.max(...severityValues);

    const probabilityPad = Math.max(0.02, (probabilityMaxRaw - probabilityMinRaw) * 0.12);
    let probabilityMin = Math.max(0, probabilityMinRaw - probabilityPad);
    let probabilityMax = Math.min(1, probabilityMaxRaw + probabilityPad);
    if (probabilityMax - probabilityMin < 0.08) {
      const center = (probabilityMinRaw + probabilityMaxRaw) / 2;
      probabilityMin = Math.max(0, center - 0.04);
      probabilityMax = Math.min(1, center + 0.04);
    }

    const severityPad = Math.max(0.15, (severityMaxRaw - severityMinRaw) * 0.12);
    let severityMin = Math.max(1, severityMinRaw - severityPad);
    let severityMax = Math.min(5, severityMaxRaw + severityPad);
    if (severityMax - severityMin < 0.6) {
      const center = (severityMinRaw + severityMaxRaw) / 2;
      severityMin = Math.max(1, center - 0.3);
      severityMax = Math.min(5, center + 0.3);
    }

    const probabilitySpan = Math.max(probabilityMax - probabilityMin, Number.EPSILON);
    const severitySpan = Math.max(severityMax - severityMin, Number.EPSILON);
    const xScale = (value: number) =>
      padding.left + ((Math.min(probabilityMax, Math.max(probabilityMin, value)) - probabilityMin) / probabilitySpan) * plotWidth;
    const yScale = (value: number) =>
      padding.top + (1 - (Math.min(severityMax, Math.max(severityMin, value)) - severityMin) / severitySpan) * plotHeight;

    const buildTicks = (min: number, max: number, count = 5) =>
      Array.from({ length: count }, (_, index) => min + ((max - min) * index) / Math.max(count - 1, 1));
    const xTickValues = buildTicks(probabilityMin, probabilityMax, 5);
    const yTickValues = buildTicks(severityMin, severityMax, 5);
    const xTicks = xTickValues.map((value) => ({ value, x: xScale(value) }));
    const yTicks = yTickValues.map((value) => ({ value, y: yScale(value) }));
    const xTickDecimals = probabilitySpan < 0.2 ? 3 : 2;
    const yTickDecimals = severitySpan < 1.2 ? 2 : 1;

    const affectedValues = matrixPoints.map((point) => point.affectedEmployees);
    const maxAffected = Math.max(...affectedValues, 1);
    const minAffected = Math.min(...affectedValues, maxAffected);
    const minRadius = 5;
    const maxRadius = 24;
    const sqrtMinAffected = Math.sqrt(minAffected);
    const sqrtMaxAffected = Math.sqrt(maxAffected);
    const sqrtAffectedSpan = Math.max(sqrtMaxAffected - sqrtMinAffected, Number.EPSILON);

    const basePoints = matrixPoints.map((point, index) => {
      const probability = point.probability ?? 0;
      const x = xScale(probability);
      const y = yScale(point.severity);
      // Bubble area should represent affected employees; normalize by visible min/max to preserve contrast.
      const normalizedAffected =
        maxAffected === minAffected
          ? 1
          : (Math.sqrt(point.affectedEmployees) - sqrtMinAffected) / sqrtAffectedSpan;
      const radius = minRadius + normalizedAffected * (maxRadius - minRadius);
      return {
        ...point,
        matrixIndex: index,
        x,
        y,
        radius,
        label: shortRiskName(point.riskFactor, point.topicId),
      };
    });

    type LabelAnchor = "start" | "middle" | "end";
    type LabelBox = { x1: number; x2: number; y1: number; y2: number };
    type LabelPlacement = {
      labelX: number;
      labelY: number;
      labelAnchor: LabelAnchor;
      box: LabelBox;
      score: number;
    };
    const labelLeftBound = padding.left + 4;
    const labelRightBound = width - padding.right - 4;
    const labelTopBound = padding.top + 8;
    const labelBottomBound = height - padding.bottom - 6;

    const estimateLabelBox = (labelX: number, labelY: number, labelAnchor: LabelAnchor, label: string): LabelBox => {
      const labelWidth = Math.max(40, Math.min(180, label.length * 7.2));
      const x1 =
        labelAnchor === "start" ? labelX : labelAnchor === "end" ? labelX - labelWidth : labelX - labelWidth / 2;
      return {
        x1,
        x2: x1 + labelWidth,
        y1: labelY - 12,
        y2: labelY + 4,
      };
    };

    const boxIntersects = (left: LabelBox, right: LabelBox): boolean =>
      !(left.x2 + 2 < right.x1 || left.x1 > right.x2 + 2 || left.y2 + 2 < right.y1 || left.y1 > right.y2 + 2);

    const circleIntersectsBox = (cx: number, cy: number, r: number, box: LabelBox): boolean => {
      const closestX = Math.max(box.x1, Math.min(cx, box.x2));
      const closestY = Math.max(box.y1, Math.min(cy, box.y2));
      const dx = cx - closestX;
      const dy = cy - closestY;
      return dx * dx + dy * dy <= r * r;
    };

    const placementOrder = basePoints
      .slice()
      .sort((left, right) => right.radius - left.radius || left.y - right.y || left.x - right.x);
    const placedBoxes: LabelBox[] = [];
    const placements = new Map<number, LabelPlacement>();

    for (const point of placementOrder) {
      const baseOffset = point.radius + 10;
      const farOffset = baseOffset + 16;
      const verticalStep = Math.max(10, point.radius * 0.75);
      const candidates: Array<{ dx: number; dy: number; anchor: LabelAnchor }> = [
        { dx: baseOffset, dy: 0, anchor: "start" },
        { dx: -baseOffset, dy: 0, anchor: "end" },
        { dx: baseOffset, dy: -verticalStep, anchor: "start" },
        { dx: baseOffset, dy: verticalStep, anchor: "start" },
        { dx: -baseOffset, dy: -verticalStep, anchor: "end" },
        { dx: -baseOffset, dy: verticalStep, anchor: "end" },
        { dx: farOffset, dy: -verticalStep * 1.3, anchor: "start" },
        { dx: farOffset, dy: verticalStep * 1.3, anchor: "start" },
        { dx: -farOffset, dy: -verticalStep * 1.3, anchor: "end" },
        { dx: -farOffset, dy: verticalStep * 1.3, anchor: "end" },
        { dx: 0, dy: -(point.radius + 14), anchor: "middle" },
        { dx: 0, dy: point.radius + 14, anchor: "middle" },
      ];

      let bestPlacement: LabelPlacement | null = null;

      for (const candidate of candidates) {
        const labelX = point.x + candidate.dx;
        const labelY = point.y + candidate.dy;
        const box = estimateLabelBox(labelX, labelY, candidate.anchor, point.label);

        let score = Math.abs(candidate.dx) * 0.02 + Math.abs(candidate.dy) * 0.04;
        if (candidate.anchor === "middle") score += 4;

        if (box.x1 < labelLeftBound) score += (labelLeftBound - box.x1) * 5;
        if (box.x2 > labelRightBound) score += (box.x2 - labelRightBound) * 5;
        if (box.y1 < labelTopBound) score += (labelTopBound - box.y1) * 4;
        if (box.y2 > labelBottomBound) score += (box.y2 - labelBottomBound) * 4;

        for (const placedBox of placedBoxes) {
          if (boxIntersects(box, placedBox)) score += 320;
        }
        for (const bubble of basePoints) {
          const bubblePadding = bubble.matrixIndex === point.matrixIndex ? bubble.radius * 0.35 : bubble.radius + 2;
          if (circleIntersectsBox(bubble.x, bubble.y, bubblePadding, box)) score += bubble.matrixIndex === point.matrixIndex ? 90 : 140;
        }

        if (!bestPlacement || score < bestPlacement.score) {
          bestPlacement = { labelX, labelY, labelAnchor: candidate.anchor, box, score };
        }
      }

      const fallbackAnchor: LabelAnchor = point.x < padding.left + plotWidth / 2 ? "start" : "end";
      const fallbackLabelX = point.x + (fallbackAnchor === "start" ? baseOffset : -baseOffset);
      const fallbackLabelY = point.y;
      const fallbackBox = estimateLabelBox(fallbackLabelX, fallbackLabelY, fallbackAnchor, point.label);
      const resolvedPlacement =
        bestPlacement ?? {
          labelX: fallbackLabelX,
          labelY: fallbackLabelY,
          labelAnchor: fallbackAnchor,
          box: fallbackBox,
          score: Number.POSITIVE_INFINITY,
        };

      placements.set(point.matrixIndex, resolvedPlacement);
      placedBoxes.push(resolvedPlacement.box);
    }

    const points = basePoints.map((point) => {
      const placement = placements.get(point.matrixIndex);
      return {
        ...point,
        labelX: placement?.labelX ?? point.x,
        labelY: placement?.labelY ?? point.y,
        labelAnchor: placement?.labelAnchor ?? "start",
      };
    });

    return {
      width,
      height,
      padding,
      plotWidth,
      plotHeight,
      xTicks,
      yTicks,
      xTickDecimals,
      yTickDecimals,
      points,
    };
  }, [matrixPoints]);

  const radarSectors = useMemo(() => {
    return (dashboard?.sectors ?? [])
      .filter((sector) => !sector.suppressed && (sector.riskFactors?.length ?? 0) > 0)
      .slice()
      .sort((a, b) => (b.sectorRiskIndex ?? 0) - (a.sectorRiskIndex ?? 0));
  }, [dashboard?.sectors]);

  const radarModel = useMemo(() => {
    if (radarSectors.length === 0) return null;
    const topicMap = new Map<number, { topicId: number; label: string }>();
    for (const sector of radarSectors) {
      for (const factor of sector.riskFactors ?? []) {
        if (!topicMap.has(factor.topicId)) {
          topicMap.set(factor.topicId, {
            topicId: factor.topicId,
            label: shortRiskName(factor.riskFactor, factor.topicId),
          });
        }
      }
    }
    const axes = Array.from(topicMap.values()).sort((a, b) => a.topicId - b.topicId);
    if (axes.length === 0) return null;

    const size = 420;
    const center = size / 2;
    const radius = 150;
    const labelRadius = radius + 22;
    const levels = [0.2, 0.4, 0.6, 0.8, 1];
    const palette = [
      { line: "#1d4ed8", fill: "#1d4ed833" },
      { line: "#0f766e", fill: "#0f766e33" },
      { line: "#b45309", fill: "#b4530933" },
      { line: "#be123c", fill: "#be123c33" },
      { line: "#6d28d9", fill: "#6d28d933" },
      { line: "#0369a1", fill: "#0369a133" },
      { line: "#3f6212", fill: "#3f621233" },
      { line: "#c2410c", fill: "#c2410c33" },
    ];

    const axisVertices = axes.map((axis, index) => {
      const angle = (-Math.PI / 2) + (2 * Math.PI * index) / axes.length;
      const axisX = center + Math.cos(angle) * radius;
      const axisY = center + Math.sin(angle) * radius;
      const baseLabelX = center + Math.cos(angle) * labelRadius;
      const baseLabelY = center + Math.sin(angle) * labelRadius;
      const cos = Math.cos(angle);
      const labelAnchor: "start" | "middle" | "end" = cos > 0.28 ? "start" : cos < -0.28 ? "end" : "middle";
      const estimatedLabelWidth = Math.max(44, Math.min(156, axis.label.length * 7.2));
      const labelPadding = 8;
      const labelX =
        labelAnchor === "start"
          ? Math.min(size - labelPadding - estimatedLabelWidth, baseLabelX)
          : labelAnchor === "end"
            ? Math.max(labelPadding + estimatedLabelWidth, baseLabelX)
            : Math.min(
                size - labelPadding - estimatedLabelWidth / 2,
                Math.max(labelPadding + estimatedLabelWidth / 2, baseLabelX),
              );
      const labelY = Math.min(size - 14, Math.max(14, baseLabelY));
      return {
        topicId: axis.topicId,
        label: axis.label,
        angle,
        axisX,
        axisY,
        labelX,
        labelY,
        labelAnchor,
      };
    });

    const axisLines = axisVertices.map((vertex) => ({
      x1: center,
      y1: center,
      x2: vertex.axisX,
      y2: vertex.axisY,
      topicId: vertex.topicId,
    }));
    const rings = levels.map((level) =>
      axisVertices
        .map((vertex) => {
          const x = center + (vertex.axisX - center) * level;
          const y = center + (vertex.axisY - center) * level;
          return `${x},${y}`;
        })
        .join(" "),
    );

    const sectorPolygons = radarSectors.map((sector, index) => {
      const colors = palette[index % palette.length];
      const factorsByTopic = new Map((sector.riskFactors ?? []).map((factor) => [factor.topicId, factor]));
      const vertices = axisVertices.map((axis) => {
        const factor = factorsByTopic.get(axis.topicId) ?? null;
        const normalizedValue = (factor?.meanExposure ?? 0) / 5;
        const x = center + Math.cos(axis.angle) * radius * normalizedValue;
        const y = center + Math.sin(axis.angle) * radius * normalizedValue;
        return {
          topicId: axis.topicId,
          x,
          y,
        };
      });
      return {
        sector: sector.sector,
        sectorRiskIndex: sector.sectorRiskIndex ?? null,
        lineColor: colors.line,
        fillColor: colors.fill,
        polygonPoints: vertices.map((vertex) => `${vertex.x},${vertex.y}`).join(" "),
        vertices,
      };
    });

    return {
      size,
      center,
      axisLines,
      rings,
      axisVertices,
      sectorPolygons,
    };
  }, [radarSectors]);

  const effectiveIsolatedRadarSector = useMemo(() => {
    if (!isolatedRadarSector) return null;
    return radarSectors.some((sector) => sector.sector === isolatedRadarSector)
      ? isolatedRadarSector
      : null;
  }, [isolatedRadarSector, radarSectors]);

  const radarVisibleSeries = useMemo(() => {
    if (!radarModel) return [];
    if (!effectiveIsolatedRadarSector) return radarModel.sectorPolygons;
    return radarModel.sectorPolygons.filter((series) => series.sector === effectiveIsolatedRadarSector);
  }, [effectiveIsolatedRadarSector, radarModel]);

  const aggregateTrendScoreModel = useMemo(() => {
    const chartWidth = 420;
    const chartHeight = 246;
    const chartPadding = { left: 44, right: 16, top: 20, bottom: 42 };
    const plotWidth = chartWidth - chartPadding.left - chartPadding.right;
    const plotHeight = chartHeight - chartPadding.top - chartPadding.bottom;
    const periodLabelByTime = new Map<number, string>();

    const parsedSeries = trends
      .map((series) => {
        const points = series.points
          .reduce<
            Array<{
              period: string;
              meanExposure: number;
              stdDevExposure: number;
              prevalence: number | null;
              severityIndex: number | null;
              probability: number;
              severity: number;
              riskScore: number;
              responses: number;
              timeMs: number;
            }>
          >((acc, point) => {
            const timeMs = parseTrendPeriodToUtcMs(point.period);
            if (timeMs === null) return acc;
            periodLabelByTime.set(timeMs, point.period);
            acc.push({
              ...point,
              timeMs,
            });
            return acc;
          }, [])
          .sort((a, b) => a.timeMs - b.timeMs);
        return {
          topicId: series.topicId,
          riskFactor: series.riskFactor,
          points,
        };
      })
      .filter((series) => series.points.length > 0);
    if (parsedSeries.length === 0) return null;

    const allTimes = Array.from(
      new Set(parsedSeries.flatMap((series) => series.points.map((point) => point.timeMs))),
    ).sort((a, b) => a - b);
    if (allTimes.length === 0) return null;

    const minX = allTimes[0];
    const maxX = allTimes[allTimes.length - 1];
    const xSpan = Math.max(maxX - minX, 1);
    const xScale = (value: number) => chartPadding.left + ((value - minX) / xSpan) * plotWidth;
    const yMin = 0;
    const yMax = riskScoreScaleMax;
    const yScale = (value: number) => chartPadding.top + (1 - (value - yMin) / Math.max(yMax - yMin, 1)) * plotHeight;

    const xTickTarget = Math.min(6, allTimes.length);
    const rawXTicks = Array.from({ length: xTickTarget }, (_, index) => {
      if (allTimes.length === 1) return allTimes[0];
      const sourceIndex = Math.round((index * (allTimes.length - 1)) / Math.max(xTickTarget - 1, 1));
      return allTimes[sourceIndex];
    });
    const xTicks = Array.from(new Set(rawXTicks))
      .map((timeMs) => ({
        timeMs,
        x: xScale(timeMs),
        label: formatTrendPeriodLabel(periodLabelByTime.get(timeMs) ?? new Date(timeMs).toISOString()),
      }))
      .sort((a, b) => a.timeMs - b.timeMs);

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((step) => {
      const value = yMin + step * (yMax - yMin);
      return {
        value,
        y: yScale(value),
        label: value.toFixed(2),
      };
    });

    const cards = parsedSeries
      .map((series) => {
        const points = series.points.map((point) => {
          const score = Math.min(riskScoreScaleMax, Math.max(0, point.riskScore));
          return {
            ...point,
            score,
            x: xScale(point.timeMs),
            y: yScale(score),
          };
        });
        if (points.length === 0) return null;

        const avgScore = points.reduce((sum, point) => sum + point.score, 0) / points.length;
        const strokeColor = riskGradientColorFromRatio(avgScore / riskScoreScaleMax);
        const latestPoint = points[points.length - 1] ?? null;

        return {
          topicId: series.topicId,
          riskFactor: series.riskFactor,
          shortRiskLabel: shortRiskName(series.riskFactor, series.topicId),
          strokeColor,
          latestScore: latestPoint?.score ?? null,
          points,
          polyline: points.map((point) => `${point.x},${point.y}`).join(" "),
        };
      })
      .filter((card): card is NonNullable<typeof card> => card !== null)
      .sort((left, right) => left.topicId - right.topicId);

    if (cards.length === 0) return null;

    return {
      width: chartWidth,
      height: chartHeight,
      padding: chartPadding,
      xAxisY: chartHeight - chartPadding.bottom,
      yAxisX: chartPadding.left,
      xTicks,
      yTicks,
      cards,
    };
  }, [riskScoreScaleMax, trends]);

  const trendDetailsModalChartModel = useMemo(() => {
    if (!trendDetailsModal) return null;

    const chartWidth = 420;
    const chartHeight = 246;
    const chartPadding = { left: 44, right: 16, top: 20, bottom: 42 };
    const plotWidth = chartWidth - chartPadding.left - chartPadding.right;
    const plotHeight = chartHeight - chartPadding.top - chartPadding.bottom;
    const periodLabelByTime = new Map<number, string>();

    const parsedPoints = trendDetailsModal.rows
      .reduce<
        Array<{
          period: string;
          meanExposure: number;
          stdDevExposure: number;
          prevalence: number | null;
          severityIndex: number | null;
          probability: number;
          severity: number;
          riskScore: number;
          responses: number;
          timeMs: number;
        }>
      >((acc, point) => {
        const timeMs = parseTrendPeriodToUtcMs(point.period);
        if (timeMs === null) return acc;
        periodLabelByTime.set(timeMs, point.period);
        acc.push({
          ...point,
          timeMs,
        });
        return acc;
      }, [])
      .sort((a, b) => a.timeMs - b.timeMs);
    if (parsedPoints.length === 0) return null;

    const allTimes = parsedPoints.map((point) => point.timeMs);
    const minX = allTimes[0];
    const maxX = allTimes[allTimes.length - 1];
    const xSpan = Math.max(maxX - minX, 1);
    const xScale = (value: number) => chartPadding.left + ((value - minX) / xSpan) * plotWidth;

    const xTickTarget = Math.min(6, allTimes.length);
    const rawXTicks = Array.from({ length: xTickTarget }, (_, index) => {
      if (allTimes.length === 1) return allTimes[0];
      const sourceIndex = Math.round((index * (allTimes.length - 1)) / Math.max(xTickTarget - 1, 1));
      return allTimes[sourceIndex];
    });
    const xTicks = Array.from(new Set(rawXTicks))
      .map((timeMs) => ({
        timeMs,
        x: xScale(timeMs),
        label: formatTrendPeriodLabel(periodLabelByTime.get(timeMs) ?? new Date(timeMs).toISOString()),
      }))
      .sort((a, b) => a.timeMs - b.timeMs);

    const basePoints = parsedPoints.map((point) => ({
      ...point,
      x: xScale(point.timeMs),
    }));

    const metricDefinitions = [
      { key: "meanExposure", title: "Mean (1-5)", yLabel: "Mean", min: 1, max: 5, decimals: 2, percent: false, showBand: true },
      { key: "prevalence", title: "Prevalence", yLabel: "Prevalence", min: 0, max: 1, decimals: 0, percent: true, showBand: false },
      { key: "severityIndex", title: "Severity idx", yLabel: "Severity idx", min: 0, max: 1, decimals: 0, percent: true, showBand: false },
      { key: "probability", title: "Prob.", yLabel: "Prob.", min: 0, max: 1, decimals: 0, percent: true, showBand: false },
      { key: "severity", title: "Weight", yLabel: "Weight", min: 1, max: riskScoreScaleMax, decimals: 2, percent: false, showBand: false },
      { key: "riskScore", title: "Score", yLabel: "Score", min: 0, max: riskScoreScaleMax, decimals: 2, percent: false, showBand: false },
    ] as const;

    function pointMetricValue(
      point: (typeof basePoints)[number],
      key: (typeof metricDefinitions)[number]["key"],
    ): number | null {
      if (key === "meanExposure") return point.meanExposure;
      if (key === "prevalence") return point.prevalence;
      if (key === "severityIndex") return point.severityIndex ?? point.meanExposure / 5;
      if (key === "probability") return point.probability;
      if (key === "severity") return point.severity;
      if (key === "riskScore") return point.riskScore;
      return null;
    }

    const charts = metricDefinitions
      .map((metric) => {
        const yScale = (value: number) =>
          chartPadding.top + (1 - (value - metric.min) / Math.max(metric.max - metric.min, 1)) * plotHeight;
        const yTicks = [0, 0.25, 0.5, 0.75, 1].map((step) => {
          const value = metric.min + step * (metric.max - metric.min);
          return {
            value,
            y: yScale(value),
            label: metric.percent ? `${Math.round(value * 100)}%` : value.toFixed(metric.decimals),
          };
        });

        const points = basePoints
          .map((point) => {
            const value = pointMetricValue(point, metric.key);
            if (value === null || value === undefined || !Number.isFinite(value)) return null;
            const clamped = Math.min(metric.max, Math.max(metric.min, value));
            return {
              ...point,
              value: clamped,
              y: yScale(clamped),
              yUpper:
                metric.showBand
                  ? yScale(Math.min(metric.max, Math.max(metric.min, point.meanExposure + point.stdDevExposure)))
                  : null,
              yLower:
                metric.showBand
                  ? yScale(Math.min(metric.max, Math.max(metric.min, point.meanExposure - point.stdDevExposure)))
                  : null,
            };
          })
          .filter((point): point is NonNullable<typeof point> => point !== null);
        if (points.length === 0) return null;

        const avgRatio =
          points.reduce((sum, point) => sum + (point.value - metric.min) / Math.max(metric.max - metric.min, 1), 0) /
          points.length;
        const strokeColor = riskGradientColorFromRatio(avgRatio);

        return {
          key: metric.key,
          title: metric.title,
          yLabel: metric.yLabel,
          min: metric.min,
          max: metric.max,
          width: chartWidth,
          height: chartHeight,
          padding: chartPadding,
          xAxisY: chartHeight - chartPadding.bottom,
          yAxisX: chartPadding.left,
          xTicks,
          yTicks,
          strokeColor,
          points,
          polyline: points.map((point) => `${point.x},${point.y}`).join(" "),
          bandPolygon:
            metric.showBand && points.length > 0
              ? `${points.map((point) => `${point.x},${point.yUpper}`).join(" ")} ${points
                  .slice()
                  .reverse()
                  .map((point) => `${point.x},${point.yLower}`)
                  .join(" ")}`
              : null,
        };
      })
      .filter((chart): chart is NonNullable<typeof chart> => chart !== null);
    if (charts.length === 0) return null;

    return { charts };
  }, [riskScoreScaleMax, trendDetailsModal]);

  if (isLoading && !data) return <p className="text-sm text-[#49697a]">Carregando resultados do diagnostico...</p>;
  if ((error && !data) || !data) return <p className="text-sm text-red-600">{error || "Resultados indisponiveis."}</p>;

  return (
    <div className="relative space-y-6">
      {isPerSectorRefreshing ? (
        <div className="pointer-events-none absolute inset-0 z-40">
          <div className="h-full w-full rounded-[26px] bg-white/55 backdrop-blur-[1px]" />
          <div className="absolute inset-x-4 top-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#b9d2df] bg-white/90 px-3 py-1 text-xs font-semibold text-[#1a4a60] shadow-sm">
              <span className="inline-block h-2.5 w-2.5 animate-ping rounded-full bg-[#0f5b73]" />
              Updating sector charts...
            </span>
          </div>
        </div>
      ) : null}
      {!embeddedView ? (
        <>
          <nav className="text-xs text-[#4f6977]">
            {managerClientId ? (
              managerFromHome ? (
                <>
                  <Link href="/manager" className="text-[#0f5b73]">
                    Home
                  </Link>{" "}
                  / <span>{campaign?.name ?? "Diagnostico"}</span> / <span>Resultados</span>
                </>
              ) : (
                <>
                  <Link href="/manager/clients" className="text-[#0f5b73]">
                    Client area
                  </Link>{" "}
                  /{" "}
                  <Link href={`/manager/clients/${managerClientId}`} className="text-[#0f5b73]">
                    {managerBreadcrumbClientLabel}
                  </Link>{" "}
                  / <span>{campaign?.name ?? "Diagnostico"}</span> / <span>Resultados</span>
                </>
              )
            ) : fromHistory ? (
              <>
                <Link href={`/client/${clientSlug}/history`} className="text-[#1b2832]">
                  Historico
                </Link>{" "}
                / <span>{campaign?.name ?? "Diagnostico"}</span>
              </>
            ) : (
              <>
                <Link href={`/client/${clientSlug}/company`} className="text-[#1b2832]">
                  Home
                </Link>{" "}
                / <span>{campaign?.name ?? "Diagnostico"}</span> / <span>Resultados</span>
              </>
            )}
          </nav>

          <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
            <h2 className="text-2xl font-semibold text-[#141d24]">{campaign?.name ?? "Resultados do diagnostico"}</h2>
            <p className="mt-1 text-sm text-[#475660]">
              Responses {dashboard?.totals.responses ?? 0} | Risks {dashboard?.totals.topics ?? 0} |
              Setores ativos {dashboard?.totals.activeSectors ?? 0}
            </p>
          </section>
        </>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <article className="rounded-[20px] border border-[#dfdfdf] bg-[#f8f8f8] p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-[#516b79]">Global Risk Index</p>
          <p className="mt-2 text-2xl font-semibold text-[#14384a]">
            {metrics?.global.riskIndex !== null && metrics?.global.riskIndex !== undefined
              ? metrics.global.riskIndex.toFixed(2)
              : "-"}
          </p>
        </article>
        <article className="rounded-[20px] border border-[#dfdfdf] bg-[#f8f8f8] p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-[#516b79]">Participation rate</p>
          <p className="mt-2 text-2xl font-semibold text-[#14384a]">{fmtPercent(participationRate)}</p>
          <p className="mt-1 text-xs text-[#587282]">
            {participationResponses}/{participationTotalEmployees} colaboradores
          </p>
        </article>
        <article className="rounded-[20px] border border-[#dfdfdf] bg-[#f8f8f8] p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-[#516b79]">Psychosocial Load Index</p>
          <p className="mt-2 text-2xl font-semibold text-[#14384a]">
            {metrics?.global.psychosocialLoadIndex !== null &&
            metrics?.global.psychosocialLoadIndex !== undefined
              ? metrics.global.psychosocialLoadIndex.toFixed(2)
              : "-"}
          </p>
        </article>
        <article className="rounded-[20px] border border-[#dfdfdf] bg-[#f8f8f8] p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-[#516b79]">Critical Exposure</p>
          <p className="mt-2 text-2xl font-semibold text-[#14384a]">
            {fmtPercent(metrics?.global.criticalExposure)}
          </p>
          <p className="mt-1 text-xs text-[#587282]">
            {metrics?.global.criticalExposureEmployees ?? 0}/{metrics?.global.employeesEvaluated ?? 0} colaboradores
          </p>
        </article>
        <article className="rounded-[20px] border border-[#dfdfdf] bg-[#f8f8f8] p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-[#516b79]">Risk Concentration (sd)</p>
          <p className="mt-2 text-2xl font-semibold text-[#14384a]">
            {metrics?.global.riskConcentration !== null && metrics?.global.riskConcentration !== undefined
              ? metrics.global.riskConcentration.toFixed(2)
              : "-"}
          </p>
        </article>
      </section>

      <section className="grid gap-4">
        <article className="flex min-h-[420px] w-full flex-col rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#141d24]">Risk Factors (core metrics)</h3>
          <p className="mt-1 text-xs text-[#55707f]">Ordered by risk ranking (highest score first).</p>
          <div className="mt-3 flex-1 overflow-auto rounded-xl border border-[#dce8ee] bg-white">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b bg-[#f5fafc]">
                  <th className="px-2 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">Risk</th>
                  <th className="px-2 py-2 text-left">Mean</th>
                  <th className="px-2 py-2 text-left">Prevalence</th>
                  <th className="px-2 py-2 text-left">Severity idx</th>
                  <th className="px-2 py-2 text-left">Prob.</th>
                  <th className="px-2 py-2 text-left">Weight</th>
                  <th className="px-2 py-2 text-left">Score</th>
                  <th className="px-2 py-2 text-left">Ranking</th>
                </tr>
              </thead>
              <tbody>
                {rankedRiskFactors.map((risk, index) => (
                  <tr
                    key={`${risk.topicId}-${risk.riskFactor}`}
                    className={`border-b ${riskScoreRowTone(risk.riskScore, riskScoreScaleMax)}`}
                  >
                    <td className="px-2 py-2 font-semibold text-[#334e5c]">#{index + 1}</td>
                    <td className="px-2 py-2">
                      {topicCode(risk.topicId)} {risk.riskFactor}
                    </td>
                    <td className="px-2 py-2">{risk.meanExposure !== null ? risk.meanExposure.toFixed(2) : "-"}</td>
                    <td className="px-2 py-2">{fmtPercent(risk.prevalence)}</td>
                    <td className="px-2 py-2">{risk.severityIndex !== null ? risk.severityIndex.toFixed(2) : "-"}</td>
                    <td className="px-2 py-2">{risk.probability !== null ? risk.probability.toFixed(2) : "-"}</td>
                    <td className="px-2 py-2">{risk.severity}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-flex min-w-[56px] justify-center rounded-full border px-2 py-0.5 font-semibold ${riskScoreTone(risk.riskScore, riskScoreScaleMax)}`}
                      >
                        {risk.riskScore !== null ? risk.riskScore.toFixed(2) : "-"}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex min-w-[220px] items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-[#ecf3f7]">
                          <div
                            className={`h-2 rounded-full ${metricBarTone(risk.riskCategory)}`}
                            style={{ width: `${((risk.riskScore ?? 0) / riskScoreScaleMax) * 100}%` }}
                          />
                        </div>
                        <span className={`rounded-full border px-2 py-0.5 ${metricTone(risk.riskCategory)}`}>
                          {normalizeMetricLabel(risk.riskCategory)}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-[#141d24]">Risk Heatmap (sector x factor)</h3>
          <button
            type="button"
            onClick={() => setActivePlotInfo("heatmap")}
            className="rounded-full border border-[#b8cfdb] px-2 py-0.5 text-xs font-semibold text-[#17465b]"
            aria-label="Heatmap info"
          >
            i
          </button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-[980px] text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Sector</th>
                <th className="px-2 py-2 text-left">Responses</th>
                <th className="px-2 py-2 text-left">Risk Index</th>
                {(heatmap?.columns ?? []).map((column) => (
                  <th key={column.topicId} className="px-2 py-2 text-left">
                    <span title={column.riskFactor}>{shortRiskName(column.riskFactor, column.topicId)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmapRows.map((row) => (
                <tr key={row.sector} className="border-b">
                  <td className="px-2 py-2 font-medium text-[#1e3947]">{row.sector}</td>
                  <td className="px-2 py-2 text-[#496879]">{row.nResponses}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`inline-flex min-w-[58px] justify-center rounded-md border px-2 py-0.5 text-xs font-semibold ${riskScoreTone(row.sectorRiskIndex, riskScoreScaleMax)}`}
                    >
                      {row.sectorRiskIndex !== null ? row.sectorRiskIndex.toFixed(2) : "n/a"}
                    </span>
                  </td>
                  {row.cells.map((cell) => (
                    <td key={`${row.sector}-${cell.topicId}`} className="px-2 py-2">
                      {row.suppressed ? (
                        <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                          n/a
                        </span>
                      ) : (
                        <span
                          className={`inline-flex min-w-[48px] justify-center rounded-md px-2 py-0.5 text-xs font-semibold ${heatCellColor(cell.meanExposure)}`}
                        >
                          {cell.meanExposure !== null ? cell.meanExposure.toFixed(2) : "-"}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="flex h-full flex-col rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-[#141d24]">Risk Matrix</h3>
            <button
              type="button"
              onClick={() => setActivePlotInfo("matrix")}
              className="rounded-full border border-[#b8cfdb] px-2 py-0.5 text-xs font-semibold text-[#17465b]"
              aria-label="Risk matrix info"
            >
              i
            </button>
          </div>
          <div className="mt-1 space-y-1">
            <p className="text-xs text-[#55707f]">x: probability | y: severity (observed from responses) | bubble: affected employees</p>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#4b6472]">
              <span className="font-semibold text-[#223845]">Gravidade (color):</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#d8e5ec] bg-white px-2 py-0.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#86efac]" />
                {`low (<${lowMax.toFixed(2)})`}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#d8e5ec] bg-white px-2 py-0.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#fde68a]" />
                {`moderate (${lowMax.toFixed(2)}-${(moderateMax - 0.01).toFixed(2)})`}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#d8e5ec] bg-white px-2 py-0.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#fdba74]" />
                {`high (${moderateMax.toFixed(2)}-${(highMax - 0.01).toFixed(2)})`}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#d8e5ec] bg-white px-2 py-0.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#fca5a5]" />
                {`critical (>=${highMax.toFixed(2)})`}
              </span>
              <span className="text-[#5f7785]">
                {`gravity score = probability x ${
                  gravityWeightSource === "company_risk_profile_occurrence_risk"
                    ? `company occurrence-risk weight (${companyOccurrenceRiskWeight?.toFixed(2) ?? "-"})`
                    : "default topic weight"
                }`}
              </span>
            </div>
          </div>
          <div className="mt-3 flex-1 overflow-x-auto">
            {matrixModel ? (
              <svg viewBox={`0 0 ${matrixModel.width} ${matrixModel.height}`} className="h-[380px] w-full min-w-[520px]">
                {matrixModel.xTicks.map((tick) => {
                  return (
                    <line
                      key={`x-${tick.value}`}
                      x1={tick.x}
                      y1={matrixModel.padding.top}
                      x2={tick.x}
                      y2={matrixModel.height - matrixModel.padding.bottom}
                      stroke="#dce7ee"
                      strokeDasharray="4 6"
                    />
                  );
                })}
                {matrixModel.yTicks.map((tick) => {
                  return (
                    <line
                      key={`y-${tick.value}`}
                      x1={matrixModel.padding.left}
                      y1={tick.y}
                      x2={matrixModel.width - matrixModel.padding.right}
                      y2={tick.y}
                      stroke="#dce7ee"
                      strokeDasharray="4 6"
                    />
                  );
                })}
                <line
                  x1={matrixModel.padding.left}
                  y1={matrixModel.height - matrixModel.padding.bottom}
                  x2={matrixModel.width - matrixModel.padding.right}
                  y2={matrixModel.height - matrixModel.padding.bottom}
                  stroke="#64748b"
                  strokeWidth="1.2"
                />
                <line
                  x1={matrixModel.padding.left}
                  y1={matrixModel.padding.top}
                  x2={matrixModel.padding.left}
                  y2={matrixModel.height - matrixModel.padding.bottom}
                  stroke="#64748b"
                  strokeWidth="1.2"
                />
                {matrixModel.xTicks.map((tick) => {
                  return (
                    <text
                      key={`xt-${tick.value}`}
                      x={tick.x}
                      y={matrixModel.height - matrixModel.padding.bottom + 14}
                      textAnchor="middle"
                      className="fill-[#475569] text-[12px]"
                    >
                      {tick.value.toFixed(matrixModel.xTickDecimals)}
                    </text>
                  );
                })}
                {matrixModel.yTicks.map((tick) => {
                  return (
                    <text
                      key={`yt-${tick.value}`}
                      x={matrixModel.padding.left - 8}
                      y={tick.y + 3}
                      textAnchor="end"
                      className="fill-[#475569] text-[12px]"
                    >
                      {tick.value.toFixed(matrixModel.yTickDecimals)}
                    </text>
                  );
                })}
                <text
                  x={(matrixModel.padding.left + (matrixModel.width - matrixModel.padding.right)) / 2}
                  y={matrixModel.height - 2}
                  textAnchor="middle"
                  className="fill-[#334155] text-[14px] font-semibold"
                >
                  Probability of occurrence
                </text>
                <text
                  x={12}
                  y={matrixModel.height / 2}
                  textAnchor="middle"
                  transform={`rotate(-90 12 ${matrixModel.height / 2})`}
                  className="fill-[#334155] text-[14px] font-semibold"
                >
                  Severity (observed)
                </text>
                {matrixModel.points.map((point) => (
                  <g key={`${point.topicId}-${point.riskFactor}`}>
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={point.radius}
                      fill={
                        point.category === "critical"
                          ? "#fca5a5"
                          : point.category === "high"
                            ? "#fdba74"
                            : point.category === "moderate"
                              ? "#fde68a"
                              : "#86efac"
                      }
                      stroke="#334155"
                      strokeWidth="1"
                      fillOpacity="0.8"
                    />
                    <line x1={point.x} y1={point.y} x2={point.labelX} y2={point.labelY} stroke="#64748b" strokeWidth="0.7" />
                    <text
                      x={point.labelX}
                      y={point.labelY}
                      textAnchor={point.labelAnchor}
                      className="fill-[#1f2937] text-[13px] font-semibold"
                    >
                      {point.label}
                    </text>
                  </g>
                ))}
              </svg>
            ) : (
              <p className="text-sm text-[#5b7482]">No matrix data available.</p>
            )}
          </div>
        </article>

        <article className="flex h-full flex-col rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-[#141d24]">Sector Radar Profile</h3>
            <button
              type="button"
              onClick={() => setActivePlotInfo("radar")}
              className="rounded-full border border-[#b8cfdb] px-2 py-0.5 text-xs font-semibold text-[#17465b]"
              aria-label="Radar info"
            >
              i
            </button>
          </div>
          <p className="mt-1 text-xs text-[#55707f]">
            {radarSectors.length > 0
              ? `${radarSectors.length} sectors plotted (sorted by sector risk index)`
              : "No eligible sector"}
          </p>
          {radarModel ? (
            <p className="mt-1 text-[11px] text-[#6b8290]">
              {effectiveIsolatedRadarSector
                ? `Isolated sector: ${effectiveIsolatedRadarSector} (click again in legend to reset)`
                : "Click a legend item to isolate one sector on the radar."}
            </p>
          ) : null}
          <div className="mt-3 flex-1 overflow-x-auto">
            {radarModel ? (
              <svg viewBox={`0 0 ${radarModel.size} ${radarModel.size}`} className="mx-auto h-[420px] w-[420px]">
                {radarModel.rings.map((ring, index) => (
                  <polygon
                    key={`ring-${index}`}
                    points={ring}
                    fill="none"
                    stroke="#dbe7ef"
                    strokeWidth="1"
                  />
                ))}
                {radarModel.axisLines.map((axis) => (
                  <line
                    key={`axis-${axis.topicId}`}
                    x1={axis.x1}
                    y1={axis.y1}
                    x2={axis.x2}
                    y2={axis.y2}
                    stroke="#dbe7ef"
                    strokeWidth="1"
                  />
                ))}
                {radarVisibleSeries.map((series) => (
                  <g key={`radar-sector-${series.sector}`}>
                    <polygon
                      points={series.polygonPoints}
                      fill={series.fillColor}
                      stroke={series.lineColor}
                      strokeWidth="2"
                    />
                    {series.vertices.map((vertex) => (
                      <circle
                        key={`vertex-${series.sector}-${vertex.topicId}`}
                        cx={vertex.x}
                        cy={vertex.y}
                        r={2.5}
                        fill={series.lineColor}
                      />
                    ))}
                  </g>
                ))}
                {radarModel.axisVertices.map((vertex) => (
                  <g key={`axis-label-${vertex.topicId}`}>
                    <text
                      x={vertex.labelX}
                      y={vertex.labelY}
                      textAnchor={vertex.labelAnchor}
                      dominantBaseline="middle"
                      className="fill-[#334155] text-[14px] font-semibold"
                    >
                      {vertex.label}
                    </text>
                  </g>
                ))}
              </svg>
            ) : (
              <p className="text-sm text-[#5b7482]">No radar data available.</p>
            )}
          </div>
          {radarModel ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[#4b6472]">
              <span className="font-semibold text-[#223845]">Legend:</span>
              {radarModel.sectorPolygons.map((series) => (
                <button
                  type="button"
                  key={`legend-${series.sector}`}
                  onClick={() =>
                    setIsolatedRadarSector((previous) =>
                      previous === series.sector ? null : series.sector,
                    )
                  }
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                    effectiveIsolatedRadarSector === series.sector
                      ? "border-[#17465b] bg-[#e9f5fb]"
                      : effectiveIsolatedRadarSector
                        ? "border-[#d8e5ec] opacity-60"
                        : "border-[#d8e5ec]"
                  }`}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full border"
                    style={{ backgroundColor: series.fillColor, borderColor: series.lineColor }}
                  />
                  <span className="font-medium text-[#2a4452]">{series.sector}</span>
                  <span className="text-[#5c7482]">
                    ({series.sectorRiskIndex !== null ? series.sectorRiskIndex.toFixed(2) : "-"})
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </article>
      </section>

      <section className="grid gap-4">
        <article className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-[#141d24]">{`Distribution Plots (${distributionScopeLabel})`}</h3>
            <button
              type="button"
              onClick={() => setActivePlotInfo("distribution")}
              className="rounded-full border border-[#b8cfdb] px-2 py-0.5 text-xs font-semibold text-[#17465b]"
              aria-label="Distribution info"
            >
              i
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(metrics?.riskFactors ?? []).map((risk) => {
              const maxCount = Math.max(
                risk.distribution[1],
                risk.distribution[2],
                risk.distribution[3],
                risk.distribution[4],
                risk.distribution[5],
                1,
              );
              return (
                <div key={`distribution-${risk.topicId}`} className="rounded-xl border border-[#dce8ee] bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-[#1f3a48]" title={risk.riskFactor}>
                      {shortRiskName(risk.riskFactor, risk.topicId)}
                    </p>
                    <span className="text-[11px] text-[#5d7786]">n={risk.responses}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-[#5d7786]">
                    <span>mean {risk.meanExposure !== null ? risk.meanExposure.toFixed(2) : "-"}</span>
                    <span>sd {risk.concentration !== null ? risk.concentration.toFixed(2) : "-"}</span>
                  </div>
                  <div className="mt-2 flex h-20 items-end gap-1.5">
                    {[1, 2, 3, 4, 5].map((score) => {
                      const count = risk.distribution[score as 1 | 2 | 3 | 4 | 5];
                      const height = count === 0 ? 2 : Math.max(6, (count / maxCount) * 62);
                      const barColor =
                        score <= 2
                          ? "bg-emerald-500"
                          : score === 3
                            ? "bg-amber-500"
                            : score === 4
                              ? "bg-orange-500"
                              : "bg-rose-500";
                      return (
                        <div key={`bar-${risk.topicId}-${score}`} className="flex flex-1 flex-col items-center gap-1">
                          <div className={`w-full rounded-t ${barColor}`} style={{ height: `${height}px` }} />
                          <span className="text-[10px] text-[#5e7686]">{score}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-[#141d24]">Trend Analysis</h3>
          <button
            type="button"
            onClick={() => setActivePlotInfo("trend")}
            className="rounded-full border border-[#b8cfdb] px-2 py-0.5 text-xs font-semibold text-[#17465b]"
            aria-label="Trend info"
          >
            i
          </button>
        </div>
        <p className="mt-2 text-xs text-[#5b7482]">
          {isPerSectorResults
            ? "Per-sector view: score timeseries for all risks. Use `Details` on a chart to open the parameter gridcharts."
            : "Aggregate view: score timeseries for all risks. Use `Details` on a chart to open the parameter gridcharts."}
        </p>
        {aggregateTrendScoreModel ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {aggregateTrendScoreModel.cards.map((card, cardIndex) => (
              <article
                key={`aggregate-trend-${card.topicId}-${card.riskFactor}-${cardIndex}`}
                className={`rounded-xl border bg-white p-2.5 ${
                  selectedAggregateTrendTopicId === card.topicId ? "border-[#7fb6cd]" : "border-[#dce8ee]"
                }`}
                onClick={() => setSelectedAggregateTrendTopicId(card.topicId)}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-[#274353]" title={card.riskFactor}>
                    {card.shortRiskLabel}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full border border-[#d8e5ec] bg-[#f5fafc] px-2 py-0.5 text-[11px] font-semibold text-[#315364]">
                      score {card.latestScore !== null ? card.latestScore.toFixed(2) : "-"}
                    </span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedAggregateTrendTopicId(card.topicId);
                        setTrendDetailsModal({
                          title: card.riskFactor,
                          subtitle: isPerSectorResults
                            ? `${activeDatasetSectorFilter} | risk parameters over time`
                            : "Aggregate risk parameters over time",
                          rows: card.points,
                        });
                      }}
                      className="rounded-full border border-[#b8cfdb] px-2 py-0.5 text-[11px] font-semibold text-[#17465b]"
                    >
                      Details
                    </button>
                  </div>
                </div>
                <div className="mt-2 overflow-x-auto">
                  <svg
                    viewBox={`0 0 ${aggregateTrendScoreModel.width} ${aggregateTrendScoreModel.height}`}
                    className="h-[220px] w-full min-w-[360px]"
                  >
                    {aggregateTrendScoreModel.yTicks.map((tick) => (
                      <g key={`aggregate-trend-${card.topicId}-y-${tick.value}`}>
                        <line
                          x1={aggregateTrendScoreModel.padding.left}
                          y1={tick.y}
                          x2={aggregateTrendScoreModel.width - aggregateTrendScoreModel.padding.right}
                          y2={tick.y}
                          stroke="#dce7ee"
                          strokeDasharray="4 6"
                        />
                        <text
                          x={aggregateTrendScoreModel.padding.left - 6}
                          y={tick.y + 4}
                          textAnchor="end"
                          className="fill-[#5d7482] text-[11px]"
                        >
                          {tick.label}
                        </text>
                      </g>
                    ))}
                    {aggregateTrendScoreModel.xTicks.map((tick) => (
                      <g key={`aggregate-trend-${card.topicId}-x-${tick.timeMs}`}>
                        <line
                          x1={tick.x}
                          y1={aggregateTrendScoreModel.padding.top}
                          x2={tick.x}
                          y2={aggregateTrendScoreModel.xAxisY}
                          stroke="#eef4f8"
                          strokeDasharray="2 6"
                        />
                        <text
                          x={tick.x}
                          y={aggregateTrendScoreModel.height - 24}
                          textAnchor="middle"
                          className="fill-[#415564] text-[11px]"
                        >
                          {tick.label}
                        </text>
                      </g>
                    ))}
                    <line
                      x1={aggregateTrendScoreModel.padding.left}
                      y1={aggregateTrendScoreModel.xAxisY}
                      x2={aggregateTrendScoreModel.width - aggregateTrendScoreModel.padding.right}
                      y2={aggregateTrendScoreModel.xAxisY}
                      stroke="#93a9b5"
                      strokeWidth="1.2"
                    />
                    <line
                      x1={aggregateTrendScoreModel.yAxisX}
                      y1={aggregateTrendScoreModel.padding.top}
                      x2={aggregateTrendScoreModel.yAxisX}
                      y2={aggregateTrendScoreModel.xAxisY}
                      stroke="#93a9b5"
                      strokeWidth="1.2"
                    />
                    <polyline fill="none" stroke={card.strokeColor} strokeWidth="3.2" points={card.polyline} />
                    {card.points.map((point) => (
                      <circle
                        key={`aggregate-trend-${card.topicId}-${point.timeMs}`}
                        cx={point.x}
                        cy={point.y}
                        r={4}
                        fill={card.strokeColor}
                      />
                    ))}
                    <text
                      x={(aggregateTrendScoreModel.padding.left + aggregateTrendScoreModel.width - aggregateTrendScoreModel.padding.right) / 2}
                      y={aggregateTrendScoreModel.height - 6}
                      textAnchor="middle"
                      className="fill-[#4b6674] text-[12px] font-semibold"
                    >
                      Time
                    </text>
                    <text
                      x={11}
                      y={aggregateTrendScoreModel.padding.top + (aggregateTrendScoreModel.xAxisY - aggregateTrendScoreModel.padding.top) / 2}
                      textAnchor="middle"
                      className="fill-[#4b6674] text-[12px] font-semibold"
                      transform={`rotate(-90 11 ${aggregateTrendScoreModel.padding.top + (aggregateTrendScoreModel.xAxisY - aggregateTrendScoreModel.padding.top) / 2})`}
                    >
                      Score
                    </text>
                  </svg>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-[#5b7482]">No trend data available.</p>
        )}
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">Response Dataset Preview</h3>
        <p className="mt-1 text-xs text-[#55707f]">
          rows: {datasetRows.length} (sample up to 120 rows, anonymized employee id)
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          {!isPerSectorResults ? (
            <label className="flex items-center gap-2 text-[#466271]">
              <span>Filter sector</span>
              <select
                value={datasetSectorFilter}
                onChange={(event) => setDatasetSectorFilter(event.target.value)}
                className="rounded-lg border border-[#c9dbe6] bg-white px-2 py-1 text-xs text-[#1f3a48]"
              >
                <option value="all">All sectors</option>
                {datasetSectorOptions.map((sector) => (
                  <option key={`filter-${sector}`} value={sector}>
                    {sector}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="rounded-full border border-[#d3e2eb] bg-white px-2 py-1 text-[#4c6675]">
              Sector: {activeDatasetSectorFilter}
            </span>
          )}
          <span className="rounded-full border border-[#d3e2eb] bg-white px-2 py-1 text-[#4c6675]">
            Sort: {datasetSortKey} ({datasetSortDirection})
          </span>
        </div>
        <div className="mt-3 max-h-[360px] overflow-auto rounded-xl border border-[#dbe8ee] bg-white">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b bg-[#f5fafc]">
                <th className="px-2 py-2 text-left">
                  <button type="button" onClick={() => toggleDatasetSort("employee_id")} className="font-semibold">
                    employee_id {datasetSortKey === "employee_id" ? (datasetSortDirection === "asc" ? "^" : "v") : ""}
                  </button>
                </th>
                <th className="px-2 py-2 text-left">
                  <button type="button" onClick={() => toggleDatasetSort("sector")} className="font-semibold">
                    sector {datasetSortKey === "sector" ? (datasetSortDirection === "asc" ? "^" : "v") : ""}
                  </button>
                </th>
                <th className="px-2 py-2 text-left">
                  <button type="button" onClick={() => toggleDatasetSort("risk_factor")} className="font-semibold">
                    risk_factor {datasetSortKey === "risk_factor" ? (datasetSortDirection === "asc" ? "^" : "v") : ""}
                  </button>
                </th>
                <th className="px-2 py-2 text-left">
                  <button type="button" onClick={() => toggleDatasetSort("score")} className="font-semibold">
                    score {datasetSortKey === "score" ? (datasetSortDirection === "asc" ? "^" : "v") : ""}
                  </button>
                </th>
                <th className="px-2 py-2 text-left">
                  <button type="button" onClick={() => toggleDatasetSort("timestamp")} className="font-semibold">
                    timestamp {datasetSortKey === "timestamp" ? (datasetSortDirection === "asc" ? "^" : "v") : ""}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {datasetRows.map((row, index) => (
                <tr key={`${row.employee_id}-${row.topic_id}-${index}`} className="border-b">
                  <td className="px-2 py-2 font-mono text-[11px] text-[#38576a]">{row.employee_id.slice(0, 8)}</td>
                  <td className="px-2 py-2">{row.sector}</td>
                  <td className="px-2 py-2">{row.risk_factor}</td>
                  <td className="px-2 py-2">{row.score.toFixed(2)}</td>
                  <td className="px-2 py-2">{row.timestamp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {trendDetailsModal ? (
        <div
          className="fixed inset-0 z-[55] flex items-center justify-center bg-black/35 p-4"
          onClick={() => setTrendDetailsModal(null)}
        >
          <div
            className="w-full max-w-4xl rounded-2xl border border-[#d8e5ec] bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-xl font-semibold text-[#163447]">{trendDetailsModal.title}</h4>
                <p className="mt-1 text-sm text-[#3f5f6f]">{trendDetailsModal.subtitle}</p>
              </div>
              <button
                type="button"
                className="rounded-full border border-[#bfd4df] px-3 py-1 text-xs font-semibold text-[#20495d]"
                onClick={() => setTrendDetailsModal(null)}
              >
                Close
              </button>
            </div>
            {trendDetailsModalChartModel ? (
              <div className="mt-4 max-h-[70vh] overflow-auto pr-1">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {trendDetailsModalChartModel.charts.map((chart) => (
                    <article key={`trend-details-chart-${chart.key}`} className="rounded-xl border border-[#dce8ee] bg-white p-2.5">
                      <p className="text-sm font-semibold text-[#274353]">{chart.title}</p>
                      <div className="mt-2 overflow-x-auto">
                        <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="h-[220px] w-full min-w-[360px]">
                          {chart.yTicks.map((tick) => (
                            <g key={`trend-details-${chart.key}-y-${tick.value}`}>
                              <line
                                x1={chart.padding.left}
                                y1={tick.y}
                                x2={chart.width - chart.padding.right}
                                y2={tick.y}
                                stroke="#dce7ee"
                                strokeDasharray="4 6"
                              />
                              <text
                                x={chart.padding.left - 6}
                                y={tick.y + 4}
                                textAnchor="end"
                                className="fill-[#5d7482] text-[11px]"
                              >
                                {tick.label}
                              </text>
                            </g>
                          ))}
                          {chart.xTicks.map((tick) => (
                            <g key={`trend-details-${chart.key}-x-${tick.timeMs}`}>
                              <line
                                x1={tick.x}
                                y1={chart.padding.top}
                                x2={tick.x}
                                y2={chart.xAxisY}
                                stroke="#eef4f8"
                                strokeDasharray="2 6"
                              />
                              <text x={tick.x} y={chart.height - 24} textAnchor="middle" className="fill-[#415564] text-[11px]">
                                {tick.label}
                              </text>
                            </g>
                          ))}
                          <line
                            x1={chart.padding.left}
                            y1={chart.xAxisY}
                            x2={chart.width - chart.padding.right}
                            y2={chart.xAxisY}
                            stroke="#93a9b5"
                            strokeWidth="1.2"
                          />
                          <line
                            x1={chart.yAxisX}
                            y1={chart.padding.top}
                            x2={chart.yAxisX}
                            y2={chart.xAxisY}
                            stroke="#93a9b5"
                            strokeWidth="1.2"
                          />
                          {chart.bandPolygon ? <polygon points={chart.bandPolygon} fill="#94a3b81f" /> : null}
                          <polyline fill="none" stroke={chart.strokeColor} strokeWidth="3.2" points={chart.polyline} />
                          {chart.points.map((point) => (
                            <circle
                              key={`trend-details-${chart.key}-${point.timeMs}`}
                              cx={point.x}
                              cy={point.y}
                              r={4}
                              fill={chart.strokeColor}
                            />
                          ))}
                          <text
                            x={(chart.padding.left + chart.width - chart.padding.right) / 2}
                            y={chart.height - 6}
                            textAnchor="middle"
                            className="fill-[#4b6674] text-[12px] font-semibold"
                          >
                            Time
                          </text>
                          <text
                            x={11}
                            y={chart.padding.top + (chart.xAxisY - chart.padding.top) / 2}
                            textAnchor="middle"
                            className="fill-[#4b6674] text-[12px] font-semibold"
                            transform={`rotate(-90 11 ${chart.padding.top + (chart.xAxisY - chart.padding.top) / 2})`}
                          >
                            {chart.yLabel}
                          </text>
                        </svg>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-[#5b7482]">No trend data available for modal charts.</p>
            )}
          </div>
        </div>
      ) : null}

      {activePlotInfoContent ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          onClick={() => setActivePlotInfo(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-[#d8e5ec] bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h4 className="text-xl font-semibold text-[#163447]">{activePlotInfoContent.title}</h4>
              <button
                type="button"
                onClick={() => setActivePlotInfo(null)}
                className="rounded-full border border-[#c7d8e2] px-3 py-1 text-xs font-semibold text-[#204455]"
              >
                Close
              </button>
            </div>
            <p className="mt-3 text-sm text-[#3f5f6f]">{activePlotInfoContent.whatItShows}</p>
            <h5 className="mt-4 text-sm font-semibold uppercase tracking-[0.1em] text-[#2f4d5e]">How to use</h5>
            <ol className="mt-2 space-y-2 text-sm text-[#3f5f6f]">
              {activePlotInfoContent.howToUse.map((item, index) => (
                <li key={`${activePlotInfoContent.title}-${index}`}>
                  {index + 1}. {item}
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ClientProgramsListSection({ clientSlug }: { clientSlug: string }) {
  const { data, isLoading, error } = useClientPortalData(clientSlug);
  const annualPlanColumns = useMemo(
    () => buildAnnualPlanColumns(new Date(), PORTAL_ANNUAL_PLAN_COLUMNS),
    [],
  );

  if (isLoading) return <p className="text-sm text-[#49697a]">Carregando processos continuos...</p>;
  if (error || !data) return <p className="text-sm text-red-600">{error || "Processos indisponiveis."}</p>;

  const assigned = data.assignedPrograms ?? [];

  return (
    <div className="space-y-6">
      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">Programas Continuos (Campanhas)</h2>
        <p className="mt-1 text-sm text-[#475660]">
          Campanhas preventivas e interventivas atribuidas pelo gestor.
        </p>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">Plano anual de implementacao</h3>
        <p className="mt-1 text-xs text-[#55707f]">
          Visualizacao somente leitura do cronograma definido pelo gestor.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-[1050px] text-xs">
            <thead>
              <tr className="border-b bg-white">
                <th className="px-2 py-2 text-left font-semibold text-[#244354]">Programa</th>
                {annualPlanColumns.map((column) => (
                  <th
                    key={`portal-annual-col-${column.key}`}
                    className="px-1 py-2 text-center font-semibold text-[#244354]"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assigned.length === 0 ? (
                <tr>
                  <td colSpan={annualPlanColumns.length + 1} className="px-2 py-3 text-xs text-[#5a7383]">
                    Nenhum processo continuo atribuido.
                  </td>
                </tr>
              ) : (
                assigned.map((assignment) => {
                  const selectedMonths = new Set(
                    extractProgramAnnualPlanMonths(assignment, data.masterCalendar?.events),
                  );
                  return (
                    <tr key={`portal-annual-row-${assignment.id}`} className="border-b border-[#dbe7ef]">
                      <td className="px-2 py-2">
                        <Link
                          href={`/client/${clientSlug}/programs/${assignment.programId}?assignmentId=${assignment.id}`}
                          className="font-medium text-[#0f5b73] hover:underline"
                        >
                          {assignment.programTitle}
                        </Link>
                        <p className="text-[11px] text-[#5a7383]">Status {assignment.status}</p>
                      </td>
                      {annualPlanColumns.map((column) => {
                        const isSelected = selectedMonths.has(column.key);
                        return (
                          <td key={`${assignment.id}-${column.key}`} className="px-1 py-2 text-center">
                            <span
                              className={`inline-flex h-7 w-9 items-center justify-center rounded border text-[10px] font-semibold ${
                                isSelected
                                  ? "border-[#87b493] bg-[#d9f0df] text-[#1f5f2c]"
                                  : "border-[#c5d8e4] bg-white text-[#4f6977]"
                              }`}
                            >
                              {isSelected ? "OK" : "-"}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {assigned.length === 0 ? (
          <p className="text-sm text-[#5a7383]">Nenhum processo continuo atribuido.</p>
        ) : (
          assigned.map((assignment) => (
            <article key={assignment.id} className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.15em] text-[#55707f]">{assignment.id}</p>
              <h3 className="mt-1 text-xl font-semibold text-[#141d24]">{assignment.programTitle}</h3>
              {assignment.programDescription ? (
                <p className="mt-1 text-sm text-[#3e5b6b]">{assignment.programDescription}</p>
              ) : null}
              <p className="mt-2 text-xs text-[#55707f]">
                {assignment.status} | Aplicado em {fmtDate(assignment.deployedAt)} | Frequencia{" "}
                {assignment.scheduleFrequency || "-"}
              </p>
              <Link
                href={`/client/${clientSlug}/programs/${assignment.programId}?assignmentId=${assignment.id}`}
                className="mt-4 inline-flex rounded-full border border-[#c8c8c8] px-4 py-2 text-xs font-semibold text-[#1b2832]"
              >
                Abrir detalhes
              </Link>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

export function ClientReportsSection({ clientSlug }: { clientSlug: string }) {
  const { data, isLoading, error } = useClientPortalData(clientSlug);
  const [downloadingReportId, setDownloadingReportId] = useState<string | null>(null);
  const [reportFeedback, setReportFeedback] = useState("");

  async function downloadReport(reportId: string) {
    setDownloadingReportId(reportId);
    setReportFeedback("");
    try {
      const response = await fetch(`/api/client/portal/${clientSlug}/reports/${reportId}/download`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        fileName?: string;
        report?: {
          id: string;
          title: string;
          status: string;
          createdAt: string;
          summary: Record<string, unknown>;
        };
      };
      if (!response.ok || !body.report) {
        throw new Error(body.error ?? "Nao foi possivel baixar o relatorio.");
      }

      const blob = new Blob(
        [
          JSON.stringify(
            {
              id: body.report.id,
              title: body.report.title,
              status: body.report.status,
              createdAt: body.report.createdAt,
              summary: body.report.summary,
            },
            null,
            2,
          ),
        ],
        { type: "application/json;charset=utf-8" },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = body.fileName ?? `${body.report.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setReportFeedback("Relatorio baixado com sucesso.");
    } catch (downloadError) {
      setReportFeedback(
        downloadError instanceof Error ? downloadError.message : "Nao foi possivel baixar o relatorio.",
      );
    } finally {
      setDownloadingReportId(null);
    }
  }

  if (isLoading) return <p className="text-sm text-[#49697a]">Carregando relatorios...</p>;
  if (error || !data) return <p className="text-sm text-red-600">{error || "Relatorios indisponiveis."}</p>;
  const completedCampaigns = data.campaigns.filter(
    (campaign) => campaign.status === "closed" || campaign.status === "archived",
  );

  return (
    <div className="space-y-6">
      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">Reports</h2>
        <p className="mt-1 text-sm text-[#475660]">Tabelas de relatorios DRPS e processos continuos.</p>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">DRPS concluidos</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Diagnostico</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Janela</th>
                <th className="px-2 py-2 text-left">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {completedCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-3 text-xs text-[#5a7383]">
                    Sem diagnosticos DRPS concluidos para este cliente.
                  </td>
                </tr>
              ) : (
                completedCampaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-b">
                    <td className="px-2 py-2">{campaign.name}</td>
                    <td className="px-2 py-2">{questionnaireCollectionStatus(campaign.status)}</td>
                    <td className="px-2 py-2">
                      {fmtDate(campaign.starts_at)} - {fmtDate(campaign.closes_at)}
                    </td>
                    <td className="px-2 py-2">
                      <Link
                        href={`/client/${clientSlug}/diagnostic/${campaign.id}`}
                        className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                      >
                        Ver resultados
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">Relatorios DRPS</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Titulo</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Data</th>
                <th className="px-2 py-2 text-left">Acao</th>
              </tr>
            </thead>
            <tbody>
              {(data.reports ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-3 text-xs text-[#5a7383]">
                    Sem relatorios DRPS para este cliente.
                  </td>
                </tr>
              ) : (
                (data.reports ?? []).map((report) => (
                  <tr key={report.id} className="border-b">
                    <td className="px-2 py-2">{report.report_title}</td>
                    <td className="px-2 py-2">{report.status}</td>
                    <td className="px-2 py-2">{fmtDateTime(report.created_at)}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => void downloadReport(report.id)}
                        disabled={downloadingReportId === report.id}
                        className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73] disabled:opacity-50"
                      >
                        {downloadingReportId === report.id ? "Baixando..." : "Baixar"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {reportFeedback ? <p className="mt-3 text-sm text-[#0f5b73]">{reportFeedback}</p> : null}
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">Processos continuos</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Programa</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Aplicado em</th>
                <th className="px-2 py-2 text-left">Frequencia</th>
                <th className="px-2 py-2 text-left">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {(data.assignedPrograms ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-xs text-[#5a7383]">
                    Nenhum processo continuo atribuido.
                  </td>
                </tr>
              ) : (
                (data.assignedPrograms ?? []).map((program) => (
                  <tr key={program.id} className="border-b">
                    <td className="px-2 py-2">{program.programTitle}</td>
                    <td className="px-2 py-2">{program.status}</td>
                    <td className="px-2 py-2">{fmtDateTime(program.deployedAt)}</td>
                    <td className="px-2 py-2">{program.scheduleFrequency || "-"}</td>
                    <td className="px-2 py-2">
                      <Link
                        href={`/client/${clientSlug}/programs/${program.programId}?assignmentId=${program.id}`}
                        className="rounded-full border border-[#c8c8c8] px-3 py-1 text-xs font-semibold text-[#1b2832]"
                      >
                        Abrir
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function ClientContractsInvoicesSection({ clientSlug }: { clientSlug: string }) {
  const { data, isLoading, error } = useClientPortalData(clientSlug);

  if (isLoading) return <p className="text-sm text-[#49697a]">Carregando contratos e invoices...</p>;
  if (error || !data) return <p className="text-sm text-red-600">{error || "Contratos indisponiveis."}</p>;

  return (
    <div className="space-y-6">
      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">Contracts and invoces</h2>
        <p className="mt-1 text-sm text-[#475660]">
          Financeiro: {data.client.billingStatus ?? "-"} | Contrato:{" "}
          {fmtDate(data.client.contractStartDate ?? null)} - {fmtDate(data.client.contractEndDate ?? null)}
        </p>
        <p className="mt-1 text-xs text-[#5a7383]">Ultima atualizacao: {fmtDateTime(data.client.updatedAt)}</p>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">Contracts invoces</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Invoice ID</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Valor</th>
                <th className="px-2 py-2 text-left">Vencimento</th>
              </tr>
            </thead>
            <tbody>
              {(data.invoices ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-3 text-xs text-[#5a7383]">
                    Nenhum invoice registrado para este cliente.
                  </td>
                </tr>
              ) : (
                (data.invoices ?? []).map((invoice) => (
                  <tr key={invoice.id} className="border-b">
                    <td className="px-2 py-2">{invoice.id}</td>
                    <td className="px-2 py-2">{invoice.status}</td>
                    <td className="px-2 py-2">{fmtCurrency(invoice.amount)}</td>
                    <td className="px-2 py-2">{fmtDate(invoice.dueDate)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function ClientProgramDetailsSection({
  clientSlug,
  programId,
}: {
  clientSlug: string;
  programId: string;
}) {
  const searchParams = useSearchParams();
  const fromHistory = searchParams.get("from") === "history";
  const { data, isLoading, error } = useClientPortalData(clientSlug);
  const fallbackProgram = findProgramById(programId);
  const requestedAssignmentId = searchParams.get("assignmentId");
  const assignedFromApi = useMemo(
    () => {
      const assignedPrograms = data?.assignedPrograms ?? [];
      if (requestedAssignmentId) {
        const byId = assignedPrograms.find((item) => item.id === requestedAssignmentId) ?? null;
        if (byId) return byId;
      }
      return assignedPrograms.find((item) => item.programId === programId) ?? null;
    },
    [data?.assignedPrograms, programId, requestedAssignmentId],
  );
  const hasAssignment = Boolean(assignedFromApi);
  const displayTitle = assignedFromApi?.programTitle ?? fallbackProgram?.name ?? "Programa";
  const displaySummary = assignedFromApi?.programDescription ?? fallbackProgram?.summary ?? null;
  const evaluationQuestions = useMemo(() => {
    const fromApi = (assignedFromApi?.evaluationQuestions ?? [])
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (fromApi.length > 0) return fromApi;
    return fallbackProgram?.evaluationQuestions ?? [];
  }, [assignedFromApi?.evaluationQuestions, fallbackProgram?.evaluationQuestions]);
  const materials = useMemo(() => {
    const fromApi = assignedFromApi?.materials ?? [];
    if (fromApi.length > 0) return fromApi;
    return (fallbackProgram?.materials ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      fileName: item.title,
      mimeType: "application/octet-stream",
      sizeBytes: 0,
      uploadedAt: "",
      storagePath: "",
      downloadUrl: item.downloadUrl,
    }));
  }, [assignedFromApi?.materials, fallbackProgram?.materials]);
  const assignmentMeetings = useMemo(() => {
    if (!assignedFromApi) return [] as NonNullable<ClientPortalPayload["masterCalendar"]>["events"];
    return (data?.masterCalendar?.events ?? [])
      .filter(
        (item) =>
          item.eventType === "continuous_meeting" && item.sourceClientProgramId === assignedFromApi.id,
      )
      .slice()
      .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
  }, [assignedFromApi, data?.masterCalendar?.events]);
  const committedAssignmentMeetings = useMemo(() => {
    return assignmentMeetings.filter(
      (item) => item.details?.eventLifecycle === "committed" && item.status !== "cancelled",
    );
  }, [assignmentMeetings]);
  const nextMeeting = useMemo(() => {
    return (
      committedAssignmentMeetings.find((item) => item.status === "scheduled") ??
      committedAssignmentMeetings[0] ??
      null
    );
  }, [committedAssignmentMeetings]);
  const evaluationScopeId = requestedAssignmentId ?? programId;
  const storageKey = `nr1-program-evals:${clientSlug}:${evaluationScopeId}`;
  const [scores, setScores] = useState<Record<number, number>>({});
  const [entries, setEntries] = useState<EvaluationEntry[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as EvaluationEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [evaluationError, setEvaluationError] = useState("");

  const averageByQuestion = useMemo(() => {
    if (evaluationQuestions.length === 0 || entries.length === 0) return [] as number[];
    return evaluationQuestions.map((_, index) => {
      const values = entries.map((entry) => entry.scores[index]).filter((value) => typeof value === "number");
      if (values.length === 0) return 0;
      return values.reduce((acc, value) => acc + value, 0) / values.length;
    });
  }, [entries, evaluationQuestions]);

  const overallAverage = useMemo(() => {
    if (averageByQuestion.length === 0) return 0;
    return averageByQuestion.reduce((acc, value) => acc + value, 0) / averageByQuestion.length;
  }, [averageByQuestion]);

  function submitEvaluation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (evaluationQuestions.length === 0) return;
    const answers = evaluationQuestions.map((_, index) => scores[index] ?? 0);
    if (answers.some((value) => value < 1 || value > 5)) {
      setEvaluationError("Answer all evaluation questions from 1 to 5.");
      return;
    }
    const nextEntries = [...entries, { createdAt: new Date().toISOString(), scores: answers }];
    setEntries(nextEntries);
    localStorage.setItem(storageKey, JSON.stringify(nextEntries));
    setScores({});
    setEvaluationError("");
  }

  if (isLoading) {
    return <p className="text-sm text-[#49697a]">Carregando detalhes do processo...</p>;
  }

  if (error || !data) {
    return <p className="text-sm text-red-600">{error || "Detalhes indisponiveis."}</p>;
  }

  if (!hasAssignment) {
    return <p className="text-sm text-red-600">Program not assigned for this client.</p>;
  }

  return (
    <div className="space-y-6">
      <nav className="text-xs text-[#4f6977]">
        {fromHistory ? (
          <>
            <Link href={`/client/${clientSlug}/history`} className="text-[#1b2832]">
              Historico
            </Link>{" "}
            / <span>{displayTitle}</span>
          </>
        ) : (
          <>
            <Link href={`/client/${clientSlug}/programs`} className="text-[#1b2832]">
              Programas Continuos
            </Link>{" "}
            / <span>{displayTitle}</span>
          </>
        )}
      </nav>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">{displayTitle}</h2>
        {displaySummary ? <p className="mt-1 text-sm text-[#475660]">{displaySummary}</p> : null}
        <p className="mt-2 text-xs text-[#55707f]">
          {assignedFromApi
            ? `${assignedFromApi.status} | Aplicado em ${fmtDate(assignedFromApi.deployedAt)}`
            : "-"}
        </p>
      </section>

      {assignedFromApi ? (
        <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#141d24]">Dados do processo continuo</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <tbody>
                <tr className="border-b">
                  <td className="px-2 py-2 font-semibold text-[#3e5b6b]">ID atribuicao</td>
                  <td className="px-2 py-2">{assignedFromApi.id}</td>
                </tr>
                <tr className="border-b">
                  <td className="px-2 py-2 font-semibold text-[#3e5b6b]">Status</td>
                  <td className="px-2 py-2">{assignedFromApi.status}</td>
                </tr>
                <tr className="border-b">
                  <td className="px-2 py-2 font-semibold text-[#3e5b6b]">Aplicado em</td>
                  <td className="px-2 py-2">{fmtDate(assignedFromApi.deployedAt)}</td>
                </tr>
                <tr className="border-b">
                  <td className="px-2 py-2 font-semibold text-[#3e5b6b]">Frequencia</td>
                  <td className="px-2 py-2">{formatFrequencyLabel(assignedFromApi.scheduleFrequency)}</td>
                </tr>
                <tr className="border-b">
                  <td className="px-2 py-2 font-semibold text-[#3e5b6b]">Data ancora</td>
                  <td className="px-2 py-2">{fmtDate(assignedFromApi.scheduleAnchorDate)}</td>
                </tr>
                <tr className="border-b">
                  <td className="px-2 py-2 font-semibold text-[#3e5b6b]">Topico de risco alvo</td>
                  <td className="px-2 py-2">{assignedFromApi.targetRiskTopic ?? "-"}</td>
                </tr>
                <tr className="border-b">
                  <td className="px-2 py-2 font-semibold text-[#3e5b6b]">Threshold gatilho</td>
                  <td className="px-2 py-2">{assignedFromApi.triggerThreshold ?? "-"}</td>
                </tr>
                <tr>
                  <td className="px-2 py-2 font-semibold text-[#3e5b6b]">Proxima reuniao</td>
                  <td className="px-2 py-2">{nextMeeting ? fmtDateTime(nextMeeting.startsAt) : "-"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {assignedFromApi ? (
        <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#141d24]">Cronograma (reunioes no calendario)</h3>
          <div className="mt-3 overflow-x-auto rounded-xl border border-[#d8e4ee]">
            <table className="min-w-full text-xs">
              <thead className="bg-[#f3f8fb]">
                <tr className="border-b border-[#d8e4ee]">
                  <th className="px-3 py-2 text-left font-semibold text-[#244354]">Data/hora</th>
                  <th className="px-3 py-2 text-left font-semibold text-[#244354]">Duracao</th>
                  <th className="px-3 py-2 text-left font-semibold text-[#244354]">Status</th>
                  <th className="px-3 py-2 text-left font-semibold text-[#244354]">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {committedAssignmentMeetings.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-xs text-[#5a7383]">
                      Nenhuma reuniao commitada para esta atribuicao no momento.
                    </td>
                  </tr>
                ) : (
                  committedAssignmentMeetings.map((item) => {
                    const status = chronogramStatusBadge(item.status);
                    return (
                      <tr key={item.id} className="border-b border-[#e2edf3] bg-[#ebf6fd]">
                        <td className="px-3 py-2 text-[#123447]">{fmtDateTime(item.startsAt)}</td>
                        <td className="px-3 py-2 text-[#123447]">{fmtDuration(item.startsAt, item.endsAt)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${status.className}`}
                          >
                            {status.label}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/client/${clientSlug}/history/events/${item.id}`}
                            className="inline-flex items-center justify-center rounded-full border border-[#9ec8db] px-3 py-1 font-semibold text-[#0f5b73]"
                          >
                            Event record
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {hasAssignment ? (
        <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#141d24]">Materiais para download</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {materials.length === 0 ? (
              <li className="rounded-xl border border-[#e3edf3] px-3 py-2 text-[#5a7383]">
                Nenhum material disponivel para este programa.
              </li>
            ) : (
              materials.map((item) => (
                <li key={item.id} className="flex items-center justify-between rounded-xl border border-[#e3edf3] px-3 py-2">
                  <span>
                    {item.title}{" "}
                    <span className="text-xs text-[#54707f]">
                      ({item.fileName} {item.sizeBytes > 0 ? `| ${formatBytes(item.sizeBytes)}` : ""})
                    </span>
                  </span>
                  <a
                    href={item.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-[#c8c8c8] px-3 py-1 text-xs font-semibold text-[#1b2832]"
                  >
                    Download
                  </a>
                </li>
              ))
            )}
          </ul>
        </section>
      ) : null}

      {evaluationQuestions.length > 0 ? (
        <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#141d24]">Questionario de avaliacao</h3>
          <form onSubmit={submitEvaluation} className="mt-3 space-y-4">
            {evaluationQuestions.map((question, index) => (
              <label key={question} className="block space-y-1">
                <span className="text-sm text-[#475660]">{question}</span>
                <select
                  value={scores[index] ?? ""}
                  onChange={(event) =>
                    setScores((prev) => ({ ...prev, [index]: Number(event.target.value || 0) }))
                  }
                  className="w-full rounded-xl border border-[#c9dce8] px-3 py-2 text-sm"
                >
                  <option value="">Select score</option>
                  <option value="1">1 - Very low</option>
                  <option value="2">2 - Low</option>
                  <option value="3">3 - Medium</option>
                  <option value="4">4 - Good</option>
                  <option value="5">5 - Excellent</option>
                </select>
              </label>
            ))}
            {evaluationError ? <p className="text-sm text-red-600">{evaluationError}</p> : null}
            <button
              type="submit"
              className="rounded-full bg-[#131313] px-4 py-2 text-sm font-semibold text-white"
            >
              Submit evaluation
            </button>
          </form>
        </section>
      ) : null}

      {evaluationQuestions.length > 0 ? (
        <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#141d24]">Effectiveness metrics</h3>
          <p className="mt-1 text-sm text-[#475660]">Submissions: {entries.length}</p>
          <p className="mt-1 text-sm text-[#475660]">
            Overall average: {entries.length ? overallAverage.toFixed(2) : "-"} / 5.00
          </p>
          <div className="mt-4 space-y-3">
            {evaluationQuestions.map((question, index) => {
              const avg = averageByQuestion[index] ?? 0;
              return (
                <div key={question} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-[#475660]">{question}</span>
                    <span className="font-semibold text-[#141d24]">
                      {entries.length ? avg.toFixed(2) : "-"}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[#edf3f7]">
                    <div className="h-2 rounded-full bg-[#131313]" style={{ width: `${(avg / 5) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}



