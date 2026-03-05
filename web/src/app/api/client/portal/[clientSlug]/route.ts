import { NextRequest, NextResponse } from "next/server";

import {
  buildDrpsCalendarEvents,
  loadStoredCalendarEvents,
  mergeAndSortMasterCalendarEvents,
  type MasterCalendarEvent,
} from "@/lib/master-calendar";
import {
  DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS,
  DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY,
  type ContinuousProgramMaterial,
} from "@/lib/continuous-programs";
import { classifyScore, resolveRisk } from "@/lib/risk";
import { slugify } from "@/lib/slug";
import { isMissingColumnError, isMissingFunctionError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildAccessLink, toRiskParameter } from "@/lib/survey-sectors";

type ClientRow = {
  client_id: string;
  company_name: string;
  cnpj: string;
  status: "Active" | "Pending" | "Inactive";
  billing_status: "up_to_date" | "pending" | "overdue" | "blocked";
  portal_slug: string;
  total_employees: number;
  remote_employees: number;
  onsite_employees: number;
  hybrid_employees: number;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  updated_at: string | null;
};

type LegacyClientRow = {
  client_id: string;
  company_name: string;
  cnpj: string;
  status: "Active" | "Pending" | "Inactive";
  total_employees: number;
};

type CampaignRow = {
  id: string;
  client_id: string | null;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  k_anonymity_min: number;
  starts_at: string | null;
  closes_at: string | null;
  created_at: string;
  responses?: number;
};

type TopicAggregateRow = {
  topic_id: number;
  n_responses: number;
  mean_severity: number | null;
  mean_probability: number | null;
};

type GroupCountRow = {
  group_value: string;
  n_responses: number;
};

type TimeseriesRow = {
  day: string;
  response_count: number;
};

type DrpsSnapshotRow = {
  id: string;
  sector: string;
  reference_period: string;
  part1_probability_score: number;
  part1_probability_class: "low" | "medium" | "high";
  recommended_programs: string[];
  governance_actions: string[];
  created_at: string;
};

type SectorConfigRow = {
  id: string;
  key: string;
  name: string;
  risk_parameter: number | string;
  access_token: string;
  is_active: boolean;
  submission_count: number;
  last_submitted_at: string | null;
};

type ReportRow = {
  id: string;
  survey_id: string | null;
  report_title: string;
  status: "draft" | "processing" | "ready" | "failed";
  created_at: string;
  summary: Record<string, unknown>;
};

type InvoiceRow = {
  invoice_id: string;
  client_id: string;
  amount: number | string;
  status: "Paid" | "Pending" | "Overdue";
  due_date: string;
};

type ClientProgramRow = {
  client_program_id: string;
  program_id: string;
  status: "Recommended" | "Active" | "Completed";
  deployed_at?: string | null;
  schedule_frequency_override?: string | null;
  schedule_anchor_date_override?: string | null;
  annual_plan_months?: unknown;
};

type ProgramRow = {
  program_id: string;
  title: string;
  description: string | null;
  target_risk_topic: number | string;
  trigger_threshold: number | string;
  schedule_frequency?: string | null;
  schedule_anchor_date?: string | null;
  evaluation_questions?: unknown;
  materials?: unknown;
};

type AvailabilityRequestRow = {
  request_id: string;
  client_program_id: string;
  status: "pending" | "submitted" | "scheduled" | "closed";
  requested_at: string;
  due_at: string | null;
  suggested_slots: unknown;
  selected_slots: unknown;
  submitted_at: string | null;
};

type AvailabilitySlot = {
  startsAt: string;
  endsAt: string;
};
const annualPlanMonthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
const DRPS_COLLECTION_WINDOW_DAYS = 7;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

type ResponseRawRow = {
  id: string;
  survey_id: string;
  submitted_at: string;
  group_values: Record<string, unknown> | null;
};

type CampaignResponseRow = {
  survey_id: string | null;
};

type LegacyCampaignResponseRow = {
  campaign_id: string | null;
};

type QuestionTopicRow = {
  id: string;
  topic_id: number;
};

type AnswerScoreRow = {
  response_id: string;
  question_id: string;
  corrected_value: number | string;
};

type RiskExposureLevel = "low" | "moderate" | "high" | "critical";
type ProbabilityBand = "rare" | "occasional" | "frequent" | "very_frequent";
type RiskMatrixClass = "low" | "moderate" | "high" | "critical";

type ScoreDistribution = {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
};

type ResponseRiskDatasetRow = {
  employeeId: string;
  sector: string;
  topicId: number;
  riskFactor: string;
  score: number;
  scoreBucket: 1 | 2 | 3 | 4 | 5;
  timestamp: string;
};

type RiskFactorMetric = {
  topicId: number;
  riskFactor: string;
  severity: number;
  responses: number;
  affectedEmployees: number;
  meanExposure: number | null;
  exposureLevel: RiskExposureLevel | null;
  prevalence: number | null;
  severityIndex: number | null;
  probability: number | null;
  probabilityBand: ProbabilityBand | null;
  riskScore: number | null;
  riskCategory: RiskMatrixClass | null;
  concentration: number | null;
  distribution: ScoreDistribution;
};

type RiskFactorTrendPoint = {
  period: string;
  meanExposure: number;
  stdDevExposure: number;
  prevalence: number | null;
  severityIndex: number | null;
  probability: number;
  severity: number;
  riskScore: number;
  responses: number;
};

type RiskFactorTrendSeries = {
  topicId: number;
  riskFactor: string;
  sector: string;
  points: RiskFactorTrendPoint[];
};

type SectorRiskFactorTimeseriesRow = {
  sector_name: string;
  topic_id: number;
  period_start: string;
  response_count: number;
  mean_exposure: number | string;
  std_dev_exposure: number | string;
};

type CriticalExposureStats = {
  rate: number | null;
  employees: number;
  criticalEmployees: number;
};

type SectorMetricSnapshot = {
  sector: string;
  nResponses: number;
  suppressed: boolean;
  sectorRiskIndex: number | null;
  sectorRiskCategory: RiskMatrixClass | null;
  psychosocialLoadIndex: number | null;
  riskConcentration: number | null;
  criticalExposure: number | null;
  criticalEmployees: number;
  employeeCount: number;
  riskFactors: RiskFactorMetric[];
};

const TOPIC_PROFILES: Record<number, { label: string; severity: number }> = {
  1: { label: "Assedio", severity: 5 },
  2: { label: "Falta de suporte", severity: 4 },
  3: { label: "Gestao de mudancas", severity: 3 },
  4: { label: "Clareza de papel", severity: 3 },
  5: { label: "Reconhecimento", severity: 3 },
  6: { label: "Autonomia", severity: 3 },
  7: { label: "Justica organizacional", severity: 4 },
  8: { label: "Eventos traumaticos", severity: 5 },
  9: { label: "Subcarga", severity: 2 },
  10: { label: "Sobrecarga", severity: 4 },
  11: { label: "Relacionamentos", severity: 4 },
  12: { label: "Comunicacao", severity: 3 },
  13: { label: "Trabalho remoto/isolado", severity: 3 },
};

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toNumber(value: number | string): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function safeMean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function safeStdDev(values: number[]): number | null {
  if (values.length === 0) return null;
  const mean = safeMean(values);
  if (mean === null) return null;
  const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(Math.max(variance, 0));
}

function exposureLevelFromMean(meanExposure: number | null): RiskExposureLevel | null {
  if (meanExposure === null) return null;
  if (meanExposure <= 2) return "low";
  if (meanExposure <= 3) return "moderate";
  if (meanExposure <= 4) return "high";
  return "critical";
}

function probabilityBandFromValue(probability: number | null): ProbabilityBand | null {
  if (probability === null) return null;
  if (probability < 0.25) return "rare";
  if (probability < 0.5) return "occasional";
  if (probability < 0.75) return "frequent";
  return "very_frequent";
}

function matrixClassFromRiskScore(score: number | null): RiskMatrixClass | null {
  if (score === null) return null;
  if (score < 1.5) return "low";
  if (score < 2.5) return "moderate";
  if (score < 3.5) return "high";
  return "critical";
}

function emptyDistribution(): ScoreDistribution {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

function toTopicLabel(topicId: number): string {
  return TOPIC_PROFILES[topicId]?.label ?? `Topico ${topicId}`;
}

function toTopicSeverity(topicId: number): number {
  return TOPIC_PROFILES[topicId]?.severity ?? 3;
}

function toScoreBucket(score: number): 1 | 2 | 3 | 4 | 5 {
  const normalized = Math.round(clamp(score, 1, 5));
  if (normalized <= 1) return 1;
  if (normalized === 2) return 2;
  if (normalized === 3) return 3;
  if (normalized === 4) return 4;
  return 5;
}

function resolveSector(groupValues: Record<string, unknown> | null): string {
  if (!groupValues) return "Sem setor";
  const sector = typeof groupValues.sector === "string" ? groupValues.sector.trim() : "";
  return sector.length > 0 ? sector : "Sem setor";
}

function toMonthlyPeriod(isoDatetime: string): string {
  const parsed = new Date(isoDatetime);
  if (Number.isNaN(parsed.getTime())) {
    return "n/a";
  }
  const month = parsed.getUTCMonth() + 1;
  return `${parsed.getUTCFullYear()}-${String(month).padStart(2, "0")}`;
}

function computeCriticalExposure(rows: ResponseRiskDatasetRow[]): CriticalExposureStats {
  if (rows.length === 0) {
    return {
      rate: null,
      employees: 0,
      criticalEmployees: 0,
    };
  }

  const criticalCountByEmployee = new Map<string, number>();
  const allEmployees = new Set<string>();

  for (const row of rows) {
    allEmployees.add(row.employeeId);
    if (row.score >= 4) {
      criticalCountByEmployee.set(row.employeeId, (criticalCountByEmployee.get(row.employeeId) ?? 0) + 1);
    }
  }

  const employees = allEmployees.size;
  if (employees === 0) {
    return {
      rate: null,
      employees: 0,
      criticalEmployees: 0,
    };
  }

  let criticalEmployees = 0;
  for (const employeeId of allEmployees) {
    if ((criticalCountByEmployee.get(employeeId) ?? 0) >= 3) {
      criticalEmployees += 1;
    }
  }

  return {
    rate: round(criticalEmployees / employees),
    employees,
    criticalEmployees,
  };
}

function computeCompositeIndex(
  metrics: RiskFactorMetric[],
  selector: (metric: RiskFactorMetric) => number | null,
): number | null {
  if (metrics.length === 0) return null;
  const sum = metrics.reduce((acc, metric) => acc + (selector(metric) ?? 0), 0);
  return round(sum / metrics.length);
}

function buildResponseRiskDataset(params: {
  responses: ResponseRawRow[];
  answers: AnswerScoreRow[];
  questionTopicById: Map<string, number>;
}): ResponseRiskDatasetRow[] {
  const responseContextById = new Map<
    string,
    {
      employeeId: string;
      sector: string;
      timestamp: string;
    }
  >();

  for (const response of params.responses) {
    responseContextById.set(response.id, {
      employeeId: response.id,
      sector: resolveSector(response.group_values),
      timestamp: toMonthlyPeriod(response.submitted_at),
    });
  }

  const aggregateByEmployeeTopic = new Map<
    string,
    {
      employeeId: string;
      sector: string;
      topicId: number;
      timestamp: string;
      sum: number;
      count: number;
    }
  >();

  for (const answer of params.answers) {
    const context = responseContextById.get(answer.response_id);
    if (!context) continue;

    const topicId = params.questionTopicById.get(answer.question_id);
    if (!topicId) continue;

    const numericScore = toNumber(answer.corrected_value);
    if (numericScore === null) continue;

    const key = `${context.employeeId}:${topicId}`;
    const entry = aggregateByEmployeeTopic.get(key);
    if (!entry) {
      aggregateByEmployeeTopic.set(key, {
        employeeId: context.employeeId,
        sector: context.sector,
        topicId,
        timestamp: context.timestamp,
        sum: numericScore,
        count: 1,
      });
      continue;
    }

    entry.sum += numericScore;
    entry.count += 1;
  }

  const rows: ResponseRiskDatasetRow[] = [];
  for (const entry of aggregateByEmployeeTopic.values()) {
    const meanScore = entry.count > 0 ? entry.sum / entry.count : 0;
    const normalizedScore = round(clamp(meanScore, 1, 5));
    rows.push({
      employeeId: entry.employeeId,
      sector: entry.sector,
      topicId: entry.topicId,
      riskFactor: toTopicLabel(entry.topicId),
      score: normalizedScore,
      scoreBucket: toScoreBucket(normalizedScore),
      timestamp: entry.timestamp,
    });
  }

  return rows;
}

function buildRiskFactorMetrics(rows: ResponseRiskDatasetRow[], topicIds: number[]): RiskFactorMetric[] {
  const rowsByTopic = new Map<number, ResponseRiskDatasetRow[]>();
  for (const row of rows) {
    const list = rowsByTopic.get(row.topicId) ?? [];
    list.push(row);
    rowsByTopic.set(row.topicId, list);
  }

  return topicIds.map((topicId) => {
    const topicRows = rowsByTopic.get(topicId) ?? [];
    const distribution = emptyDistribution();
    let affectedEmployees = 0;
    const scores: number[] = [];

    for (const row of topicRows) {
      distribution[row.scoreBucket] += 1;
      scores.push(row.score);
      if (row.score >= 4) {
        affectedEmployees += 1;
      }
    }

    const responses = topicRows.length;
    const meanExposureRaw = safeMean(scores);
    const meanExposure = meanExposureRaw === null ? null : round(meanExposureRaw);
    const prevalence = responses > 0 ? round(affectedEmployees / responses) : null;
    const severityIndex =
      responses > 0
        ? round(
            (distribution[1] + distribution[2] * 2 + distribution[3] * 3 + distribution[4] * 4 + distribution[5] * 5) /
              (5 * responses),
          )
        : null;
    const probability =
      meanExposure === null ? null : round(clamp((meanExposure - 1) / 4, 0, 1));
    const severity = toTopicSeverity(topicId);
    const riskScore = probability === null ? null : round(probability * severity);
    const concentrationRaw = safeStdDev(scores);
    const concentration = concentrationRaw === null ? null : round(concentrationRaw);

    return {
      topicId,
      riskFactor: toTopicLabel(topicId),
      severity,
      responses,
      affectedEmployees,
      meanExposure,
      exposureLevel: exposureLevelFromMean(meanExposure),
      prevalence,
      severityIndex,
      probability,
      probabilityBand: probabilityBandFromValue(probability),
      riskScore,
      riskCategory: matrixClassFromRiskScore(riskScore),
      concentration,
      distribution,
    };
  });
}

function buildTrendSeries(
  rows: ResponseRiskDatasetRow[],
  topicIds: number[],
  sector = "Global",
): RiskFactorTrendSeries[] {
  const topicSet = new Set(topicIds);
  const aggregateByTopicAndPeriod = new Map<
    string,
    {
      topicId: number;
      period: string;
      scores: number[];
      affectedEmployees: number;
      distribution: ScoreDistribution;
    }
  >();

  for (const row of rows) {
    if (!topicSet.has(row.topicId)) continue;
    const period = toMonthlyPeriod(row.timestamp);
    const key = `${row.topicId}:${period}`;
    const entry = aggregateByTopicAndPeriod.get(key);
    if (!entry) {
      aggregateByTopicAndPeriod.set(key, {
        topicId: row.topicId,
        period,
        scores: [row.score],
        affectedEmployees: row.score >= 4 ? 1 : 0,
        distribution: {
          1: row.scoreBucket === 1 ? 1 : 0,
          2: row.scoreBucket === 2 ? 1 : 0,
          3: row.scoreBucket === 3 ? 1 : 0,
          4: row.scoreBucket === 4 ? 1 : 0,
          5: row.scoreBucket === 5 ? 1 : 0,
        },
      });
      continue;
    }
    entry.scores.push(row.score);
    if (row.score >= 4) {
      entry.affectedEmployees += 1;
    }
    entry.distribution[row.scoreBucket] += 1;
  }

  const byTopic = new Map<number, RiskFactorTrendPoint[]>();
  for (const entry of aggregateByTopicAndPeriod.values()) {
    const responses = entry.scores.length;
    const meanExposureRaw = safeMean(entry.scores) ?? 0;
    const stdDevRaw = safeStdDev(entry.scores) ?? 0;
    const prevalence = responses > 0 ? round(entry.affectedEmployees / responses) : null;
    const severityIndex =
      responses > 0
        ? round(
            (entry.distribution[1] +
              entry.distribution[2] * 2 +
              entry.distribution[3] * 3 +
              entry.distribution[4] * 4 +
              entry.distribution[5] * 5) /
              (5 * responses),
          )
        : null;
    const probability = clamp((meanExposureRaw - 1) / 4, 0, 1);
    const severity = toTopicSeverity(entry.topicId);
    const riskScore = probability * severity;
    const list = byTopic.get(entry.topicId) ?? [];
    list.push({
      period: entry.period,
      meanExposure: round(meanExposureRaw),
      stdDevExposure: round(stdDevRaw),
      prevalence,
      severityIndex,
      probability: round(probability),
      severity,
      riskScore: round(riskScore),
      responses,
    });
    byTopic.set(entry.topicId, list);
  }

  return topicIds.map((topicId) => ({
    topicId,
    riskFactor: toTopicLabel(topicId),
    sector,
    points: (byTopic.get(topicId) ?? []).slice().sort((a, b) => a.period.localeCompare(b.period)),
  }));
}

function buildTrendSeriesFromStoredTimeseries(
  rows: SectorRiskFactorTimeseriesRow[],
  topicIds: number[],
): RiskFactorTrendSeries[] {
  const topicSet = new Set(topicIds);
  const bySectorAndTopic = new Map<string, RiskFactorTrendSeries>();

  for (const row of rows) {
    if (!topicSet.has(row.topic_id)) continue;
    const meanExposure = toNumber(row.mean_exposure);
    const stdDevExposure = toNumber(row.std_dev_exposure);
    if (meanExposure === null || stdDevExposure === null) continue;

    const sector = (row.sector_name ?? "").trim() || "Sem setor";
    const key = `${sector}:${row.topic_id}`;
    const probability = clamp((meanExposure - 1) / 4, 0, 1);
    const severity = toTopicSeverity(row.topic_id);
    const riskScore = probability * severity;

    let series = bySectorAndTopic.get(key);
    if (!series) {
      series = {
        topicId: row.topic_id,
        riskFactor: toTopicLabel(row.topic_id),
        sector,
        points: [],
      };
      bySectorAndTopic.set(key, series);
    }

    series.points.push({
      period: toMonthlyPeriod(row.period_start),
      meanExposure: round(meanExposure),
      stdDevExposure: round(Math.max(0, stdDevExposure)),
      prevalence: null,
      severityIndex: round(clamp(meanExposure / 5, 0, 1)),
      probability: round(probability),
      severity,
      riskScore: round(riskScore),
      responses: Number.isFinite(row.response_count) ? row.response_count : 0,
    });
  }

  return Array.from(bySectorAndTopic.values())
    .map((series) => ({
      ...series,
      points: series.points.slice().sort((a, b) => a.period.localeCompare(b.period)),
    }))
    .sort((a, b) => {
      if (a.topicId !== b.topicId) return a.topicId - b.topicId;
      return a.sector.localeCompare(b.sector, "pt-BR");
    });
}

function parseScheduleFrequency(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY;
}

function parseIsoDateTime(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_IN_MS);
}

function resolveCampaignCollectionWindow(campaign: CampaignRow): {
  startsAt: string | null;
  closesAt: string | null;
} {
  const assignedAt = parseIsoDateTime(campaign.created_at);
  if (!assignedAt) {
    return {
      startsAt: campaign.starts_at,
      closesAt: campaign.closes_at,
    };
  }

  return {
    startsAt: assignedAt.toISOString(),
    closesAt: addDays(assignedAt, DRPS_COLLECTION_WINDOW_DAYS).toISOString(),
  };
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  return normalized;
}

function parseAnnualPlanMonths(value: unknown): string[] {
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

function parseEvaluationQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS;
  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 20);
  return normalized.length > 0 ? normalized : DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS;
}

function parseMaterials(value: unknown): ContinuousProgramMaterial[] {
  if (!Array.isArray(value)) return [];
  const materials: ContinuousProgramMaterial[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const fileName = typeof record.fileName === "string" ? record.fileName.trim() : "";
    const mimeType = typeof record.mimeType === "string" ? record.mimeType.trim() : "";
    const uploadedAt = typeof record.uploadedAt === "string" ? record.uploadedAt : "";
    const storagePath = typeof record.storagePath === "string" ? record.storagePath.trim() : "";
    const downloadUrl = typeof record.downloadUrl === "string" ? record.downloadUrl.trim() : "";
    const sizeBytes = typeof record.sizeBytes === "number" ? record.sizeBytes : Number(record.sizeBytes ?? NaN);
    if (
      id.length === 0 ||
      title.length === 0 ||
      fileName.length === 0 ||
      mimeType.length === 0 ||
      !Number.isFinite(sizeBytes) ||
      sizeBytes < 0 ||
      uploadedAt.length === 0 ||
      storagePath.length === 0 ||
      downloadUrl.length === 0
    ) {
      continue;
    }
    materials.push({
      id,
      title,
      fileName,
      mimeType,
      sizeBytes,
      uploadedAt,
      storagePath,
      downloadUrl,
    });
  }
  return materials;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeTopic(row: TopicAggregateRow) {
  const meanProbability = row.mean_probability ?? row.mean_severity;
  const severityClass = classifyScore(row.mean_severity);
  const probabilityClass = classifyScore(meanProbability);
  const risk = resolveRisk(severityClass, probabilityClass);
  return {
    topicId: row.topic_id,
    nResponses: row.n_responses,
    meanSeverity: row.mean_severity,
    meanProbability,
    severityClass,
    probabilityClass,
    risk,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseSlots(value: unknown): AvailabilitySlot[] {
  if (!Array.isArray(value)) return [];
  const slots: AvailabilitySlot[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const startsAt = "startsAt" in item ? String(item.startsAt) : "";
    const endsAt = "endsAt" in item ? String(item.endsAt) : "";
    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);
    if (
      startsAt.length > 0 &&
      endsAt.length > 0 &&
      !Number.isNaN(startDate.getTime()) &&
      !Number.isNaN(endDate.getTime()) &&
      endDate.getTime() > startDate.getTime()
    ) {
      slots.push({ startsAt, endsAt });
    }
  }
  return slots;
}

function mapAssignedProgram(
  assignment: ClientProgramRow,
  programById: Map<string, ProgramRow>,
) {
  const program = programById.get(assignment.program_id) ?? null;
  const scheduleFrequency = parseScheduleFrequency(
    assignment.schedule_frequency_override ?? program?.schedule_frequency,
  );
  const scheduleAnchorDate =
    parseIsoDate(assignment.schedule_anchor_date_override ?? program?.schedule_anchor_date) ??
    todayIsoDate();
  return {
    id: assignment.client_program_id,
    programId: assignment.program_id,
    status: assignment.status,
    deployedAt: assignment.deployed_at ?? null,
    programTitle: program?.title ?? assignment.program_id,
    programDescription: program?.description ?? null,
    targetRiskTopic: program ? Number(program.target_risk_topic) : null,
    triggerThreshold: program ? Number(program.trigger_threshold) : null,
    scheduleFrequency,
    scheduleAnchorDate,
    annualPlanMonths: parseAnnualPlanMonths(assignment.annual_plan_months),
    evaluationQuestions: parseEvaluationQuestions(program?.evaluation_questions),
    materials: parseMaterials(program?.materials),
  };
}

function computeAdjustedSectorRisk(
  topics: Array<ReturnType<typeof normalizeTopic>>,
  riskParameter: number,
): { adjustedRiskIndex: number | null; adjustedRiskClass: "low" | "medium" | "high" | null } {
  const validValues = topics
    .map((topic) => topic.meanSeverity)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (validValues.length === 0) {
    return {
      adjustedRiskIndex: null,
      adjustedRiskClass: null,
    };
  }

  const meanSeverity = validValues.reduce((acc, value) => acc + value, 0) / validValues.length;
  const adjusted = Number(clamp(meanSeverity * riskParameter, 1, 5).toFixed(2));
  return {
    adjustedRiskIndex: adjusted,
    adjustedRiskClass: classifyScore(adjusted),
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientSlug: string }> },
) {
  const { clientSlug } = await context.params;
  const selectedCampaignId = request.nextUrl.searchParams.get("campaignId");
  const supabase = getSupabaseAdminClient();
  let client: ClientRow | null = null;
  const { data: modernClient, error: clientError } = await supabase
    .from("clients")
    .select(
      "client_id,company_name,cnpj,status,billing_status,portal_slug,total_employees,remote_employees,onsite_employees,hybrid_employees,contact_name,contact_email,contact_phone,contract_start_date,contract_end_date,updated_at",
    )
    .eq("portal_slug", clientSlug)
    .maybeSingle<ClientRow>();

  if (clientError) {
    if (isMissingColumnError(clientError, "portal_slug")) {
      const legacyResult = await supabase
        .from("clients")
        .select("client_id,company_name,cnpj,status,total_employees")
        .returns<LegacyClientRow[]>();

      if (legacyResult.error) {
        return NextResponse.json({ error: "Could not load client workspace." }, { status: 500 });
      }

      const legacyRows = Array.isArray(legacyResult.data) ? legacyResult.data : [];
      const matched = legacyRows.find((row) => slugify(row.company_name) === clientSlug);
      if (!matched) {
        return NextResponse.json({ error: "Client not found." }, { status: 404 });
      }

      client = {
        client_id: matched.client_id,
        company_name: matched.company_name,
        cnpj: matched.cnpj,
        status: matched.status,
        billing_status: "pending",
        portal_slug: slugify(matched.company_name),
        total_employees: matched.total_employees,
        remote_employees: 0,
        onsite_employees: matched.total_employees,
        hybrid_employees: 0,
        contact_name: null,
        contact_email: null,
        contact_phone: null,
        contract_start_date: null,
        contract_end_date: null,
        updated_at: null,
      };
    } else {
      return NextResponse.json({ error: "Could not load client workspace." }, { status: 500 });
    }
  } else {
    client = modernClient ?? null;
  }
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const [campaignsResult, reportsResult, invoicesResult, assignmentsWithOverridesResult, availabilityResult] =
    await Promise.all([
    supabase
      .from("surveys")
      .select("id,client_id,name,public_slug,status,k_anonymity_min,starts_at,closes_at,created_at")
      .eq("client_id", client.client_id)
      .order("created_at", { ascending: false })
      .returns<CampaignRow[]>(),
    supabase
      .from("client_reports")
      .select("id,survey_id,report_title,status,created_at,summary")
      .eq("client_id", client.client_id)
      .order("created_at", { ascending: false })
      .returns<ReportRow[]>(),
    supabase
      .from("invoices")
      .select("invoice_id,client_id,amount,status,due_date")
      .eq("client_id", client.client_id)
      .order("due_date", { ascending: false })
      .returns<InvoiceRow[]>(),
    supabase
      .from("client_programs")
      .select(
        "client_program_id,program_id,status,deployed_at,schedule_frequency_override,schedule_anchor_date_override,annual_plan_months",
      )
      .eq("client_id", client.client_id)
      .order("deployed_at", { ascending: false })
      .returns<ClientProgramRow[]>(),
    supabase
      .from("client_program_availability_requests")
      .select(
        "request_id,client_program_id,status,requested_at,due_at,suggested_slots,selected_slots,submitted_at",
      )
      .eq("client_id", client.client_id)
      .order("requested_at", { ascending: false })
      .returns<AvailabilityRequestRow[]>(),
  ]);

  const assignmentsWithoutAnnualResult =
    assignmentsWithOverridesResult.error &&
    isMissingColumnError(assignmentsWithOverridesResult.error, "annual_plan_months")
      ? await supabase
          .from("client_programs")
          .select(
            "client_program_id,program_id,status,deployed_at,schedule_frequency_override,schedule_anchor_date_override",
          )
          .eq("client_id", client.client_id)
          .order("deployed_at", { ascending: false })
          .returns<ClientProgramRow[]>()
      : assignmentsWithOverridesResult;

  const assignmentsResult =
    assignmentsWithoutAnnualResult.error &&
    isMissingColumnError(assignmentsWithoutAnnualResult.error, "schedule_frequency_override")
      ? await supabase
          .from("client_programs")
          .select("client_program_id,program_id,status,deployed_at")
          .eq("client_id", client.client_id)
          .order("deployed_at", { ascending: false })
          .returns<ClientProgramRow[]>()
      : assignmentsWithoutAnnualResult;

  const reportsMissing = isMissingTableError(reportsResult.error, "client_reports");
  const invoicesMissing = isMissingTableError(invoicesResult.error, "invoices");
  const assignmentsMissing = isMissingTableError(assignmentsResult.error, "client_programs");
  const availabilityMissing = isMissingTableError(
    availabilityResult.error,
    "client_program_availability_requests",
  );

  if (campaignsResult.error && !isMissingColumnError(campaignsResult.error, "client_id")) {
    return NextResponse.json({ error: "Could not load client campaigns." }, { status: 500 });
  }
  if (reportsResult.error && !reportsMissing) {
    return NextResponse.json({ error: "Could not load client campaigns." }, { status: 500 });
  }
  if (invoicesResult.error && !invoicesMissing) {
    return NextResponse.json({ error: "Could not load client invoices." }, { status: 500 });
  }
  if (
    assignmentsResult.error &&
    !assignmentsMissing &&
    !isMissingColumnError(assignmentsResult.error, "deployed_at")
  ) {
    return NextResponse.json({ error: "Could not load assigned programs." }, { status: 500 });
  }
  if (availabilityResult.error && !availabilityMissing) {
    return NextResponse.json({ error: "Could not load availability requests." }, { status: 500 });
  }

  const campaigns = isMissingColumnError(campaignsResult.error, "client_id")
    ? []
    : campaignsResult.data ?? [];
  const campaignIds = campaigns.map((campaign) => campaign.id);
  const responseCountByCampaignId = new Map<string, number>();

  if (campaignIds.length > 0) {
    const modernResponsesResult = await supabase
      .from("responses")
      .select("survey_id")
      .in("survey_id", campaignIds)
      .returns<CampaignResponseRow[]>();
    const modernResponsesMissing = isMissingTableError(modernResponsesResult.error, "responses");
    if (modernResponsesResult.error && !modernResponsesMissing) {
      return NextResponse.json({ error: "Could not load client campaigns." }, { status: 500 });
    }

    for (const row of modernResponsesResult.data ?? []) {
      const surveyId = row.survey_id;
      if (!surveyId) continue;
      responseCountByCampaignId.set(surveyId, (responseCountByCampaignId.get(surveyId) ?? 0) + 1);
    }

    const campaignsWithoutModernCounts =
      modernResponsesMissing || responseCountByCampaignId.size === 0
        ? campaignIds
        : campaignIds.filter((campaignId) => !responseCountByCampaignId.has(campaignId));

    if (campaignsWithoutModernCounts.length > 0) {
      const legacyResponsesResult = await supabase
        .from("employee_responses")
        .select("campaign_id")
        .in("campaign_id", campaignsWithoutModernCounts)
        .returns<LegacyCampaignResponseRow[]>();
      const legacyResponsesMissing = isMissingTableError(legacyResponsesResult.error, "employee_responses");
      if (legacyResponsesResult.error && !legacyResponsesMissing) {
        return NextResponse.json({ error: "Could not load client campaigns." }, { status: 500 });
      }

      for (const row of legacyResponsesResult.data ?? []) {
        const campaignId = row.campaign_id;
        if (!campaignId) continue;
        responseCountByCampaignId.set(
          campaignId,
          (responseCountByCampaignId.get(campaignId) ?? 0) + 1,
        );
      }
    }
  }

  const campaignsWithLinks = campaigns.map((campaign) => {
    const collectionWindow = resolveCampaignCollectionWindow(campaign);
    return {
      ...campaign,
      starts_at: collectionWindow.startsAt,
      closes_at: collectionWindow.closesAt,
      responses: responseCountByCampaignId.get(campaign.id) ?? 0,
      employeeFormLink: `${request.nextUrl.origin}/s/${campaign.public_slug}`,
    };
  });
  const selectedCampaign =
    campaignsWithLinks.find((item) => item.id === selectedCampaignId) ??
    campaignsWithLinks.find((item) => item.status === "live") ??
    campaignsWithLinks[0] ??
    null;

  const assignments = assignmentsMissing ? [] : assignmentsResult.data ?? [];
  const programIds = Array.from(new Set(assignments.map((item) => item.program_id)));

  let programRows: ProgramRow[] = [];
  if (programIds.length > 0) {
    const withDetails = await supabase
      .from("periodic_programs")
      .select(
        "program_id,title,description,target_risk_topic,trigger_threshold,schedule_frequency,schedule_anchor_date,evaluation_questions,materials",
      )
      .in("program_id", programIds)
      .returns<ProgramRow[]>();

    if (withDetails.error && isMissingColumnError(withDetails.error)) {
      const withSchedule = await supabase
        .from("periodic_programs")
        .select(
          "program_id,title,description,target_risk_topic,trigger_threshold,schedule_frequency,schedule_anchor_date",
        )
        .in("program_id", programIds)
        .returns<ProgramRow[]>();

      if (withSchedule.error && isMissingColumnError(withSchedule.error, "schedule_frequency")) {
        const fallback = await supabase
          .from("periodic_programs")
          .select("program_id,title,description,target_risk_topic,trigger_threshold")
          .in("program_id", programIds)
          .returns<ProgramRow[]>();
        if (fallback.error && !isMissingTableError(fallback.error, "periodic_programs")) {
          return NextResponse.json({ error: "Could not load assigned programs." }, { status: 500 });
        }
        programRows = fallback.data ?? [];
      } else if (withSchedule.error && !isMissingTableError(withSchedule.error, "periodic_programs")) {
        return NextResponse.json({ error: "Could not load assigned programs." }, { status: 500 });
      } else {
        programRows = withSchedule.data ?? [];
      }
    } else if (withDetails.error && !isMissingTableError(withDetails.error, "periodic_programs")) {
      return NextResponse.json({ error: "Could not load assigned programs." }, { status: 500 });
    } else {
      programRows = withDetails.data ?? [];
    }
  }

  const programById = new Map(programRows.map((row) => [row.program_id, row]));
  const assignedPrograms = assignments.map((assignment) => mapAssignedProgram(assignment, programById));

  const drpsEvents = buildDrpsCalendarEvents(campaignsWithLinks);
  let storedEvents: MasterCalendarEvent[] = [];
  let calendarEventsUnavailable = false;
  try {
    const loaded = await loadStoredCalendarEvents(supabase, { clientId: client.client_id });
    storedEvents = loaded.events;
    calendarEventsUnavailable = loaded.unavailable;
  } catch {
    calendarEventsUnavailable = true;
  }
  const masterCalendarEvents = mergeAndSortMasterCalendarEvents(drpsEvents, storedEvents);
  const committedMasterCalendarEvents = masterCalendarEvents.filter(
    (event) => event.details.eventLifecycle === "committed",
  );

  const availabilityRows: AvailabilityRequestRow[] = (availabilityMissing
    ? []
    : availabilityResult.data ?? []
  )
    .slice()
    .sort(
      (a, b) =>
        new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime(),
    );

  const parsedAvailabilityRequests = availabilityRows.map((row) => {
    const assignment = assignments.find((item) => item.client_program_id === row.client_program_id) ?? null;
    const program = assignment ? programById.get(assignment.program_id) ?? null : null;
    return {
      id: row.request_id,
      clientProgramId: row.client_program_id,
      programId: assignment?.program_id ?? null,
      programTitle: program?.title ?? assignment?.program_id ?? "Processo continuo",
      status: row.status,
      requestedAt: row.requested_at,
      dueAt: row.due_at,
      submittedAt: row.submitted_at,
      suggestedSlots: parseSlots(row.suggested_slots),
      selectedSlots: parseSlots(row.selected_slots),
    };
  });

  const invoices = (invoicesMissing ? [] : invoicesResult.data ?? []).map((invoice) => ({
    id: invoice.invoice_id,
    amount: Number(invoice.amount),
    status: invoice.status,
    dueDate: invoice.due_date,
  }));

  const basePayload = {
    client: {
      id: client.client_id,
      companyName: client.company_name,
      cnpj: client.cnpj,
      status: client.status,
      billingStatus: client.billing_status,
      portalSlug: client.portal_slug,
      totalEmployees: client.total_employees,
      remoteEmployees: client.remote_employees,
      onsiteEmployees: client.onsite_employees,
      hybridEmployees: client.hybrid_employees,
      contactName: client.contact_name,
      contactEmail: client.contact_email,
      contactPhone: client.contact_phone,
      contractStartDate: client.contract_start_date,
      contractEndDate: client.contract_end_date,
      updatedAt: client.updated_at,
    },
    campaigns: campaignsWithLinks,
    selectedCampaign,
    assignedPrograms,
    availabilityRequests: parsedAvailabilityRequests,
    availabilityRequestsUnavailable: availabilityMissing,
    invoices,
    masterCalendar: {
      events: committedMasterCalendarEvents,
      calendarEventsUnavailable,
    },
  };

  if (!selectedCampaign) {
    return NextResponse.json({
      ...basePayload,
      dashboard: null,
      reports: reportsMissing ? [] : reportsResult.data ?? [],
    });
  }

  const refreshTimeseriesResult = await supabase.rpc("refresh_survey_sector_risk_factor_timeseries", {
    p_survey_id: selectedCampaign.id,
  });
  const storedTimeseriesFeatureAvailable =
    !refreshTimeseriesResult.error ||
    !isMissingFunctionError(
      refreshTimeseriesResult.error,
      "refresh_survey_sector_risk_factor_timeseries",
    );

  const storedTimeseriesPromise = storedTimeseriesFeatureAvailable
    ? supabase
        .from("survey_sector_risk_factor_timeseries")
        .select("sector_name,topic_id,period_start,response_count,mean_exposure,std_dev_exposure")
        .eq("survey_id", selectedCampaign.id)
        .returns<SectorRiskFactorTimeseriesRow[]>()
    : Promise.resolve({
        data: [] as SectorRiskFactorTimeseriesRow[],
        error: null,
      });

  const [
    globalResult,
    sectorCountsResult,
    timeseriesResult,
    latestDrpsResult,
    sectorConfigResult,
    responseRowsResult,
    questionTopicsResult,
    storedTimeseriesResult,
  ] = await Promise.all([
    supabase
      .rpc("get_topic_aggregates", {
        p_survey_id: selectedCampaign.id,
        p_group_key: null,
        p_group_value: null,
      })
      .returns<TopicAggregateRow[]>(),
    supabase
      .rpc("get_group_counts", {
        p_survey_id: selectedCampaign.id,
        p_group_key: "sector",
      })
      .returns<GroupCountRow[]>(),
    supabase
      .rpc("get_response_timeseries", {
        p_survey_id: selectedCampaign.id,
        p_days: 30,
      })
      .returns<TimeseriesRow[]>(),
    supabase
      .from("drps_assessments")
      .select(
        "id,sector,reference_period,part1_probability_score,part1_probability_class,recommended_programs,governance_actions,created_at",
      )
      .eq("survey_id", selectedCampaign.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<DrpsSnapshotRow[]>(),
    supabase
      .from("survey_sectors")
      .select("id,key,name,risk_parameter,access_token,is_active,submission_count,last_submitted_at")
      .eq("survey_id", selectedCampaign.id)
      .eq("is_active", true)
      .returns<SectorConfigRow[]>(),
    supabase
      .from("responses")
      .select("id,survey_id,submitted_at,group_values")
      .eq("survey_id", selectedCampaign.id)
      .returns<ResponseRawRow[]>(),
    supabase
      .from("questions")
      .select("id,topic_id")
      .eq("survey_id", selectedCampaign.id)
      .returns<QuestionTopicRow[]>(),
    storedTimeseriesPromise,
  ]);

  if (
    globalResult.error ||
    sectorCountsResult.error ||
    timeseriesResult.error ||
    latestDrpsResult.error ||
    sectorConfigResult.error ||
    responseRowsResult.error ||
    questionTopicsResult.error
  ) {
    return NextResponse.json({ error: "Could not load campaign dashboard." }, { status: 500 });
  }

  const storedTimeseriesRows =
    storedTimeseriesResult.error && !isMissingTableError(storedTimeseriesResult.error, "survey_sector_risk_factor_timeseries")
      ? []
      : Array.isArray(storedTimeseriesResult.data)
        ? storedTimeseriesResult.data
        : [];

  const globalRows = Array.isArray(globalResult.data) ? globalResult.data : [];
  const normalizedGlobal = globalRows.map(normalizeTopic);
  const normalizedGlobalWithLabels = normalizedGlobal.map((topic) => ({
    ...topic,
    riskFactor: toTopicLabel(topic.topicId),
    severity: toTopicSeverity(topic.topicId),
  }));

  const sectorCounts = Array.isArray(sectorCountsResult.data) ? sectorCountsResult.data : [];
  const countBySectorName = new Map<string, number>();
  for (const row of sectorCounts) {
    countBySectorName.set(row.group_value, row.n_responses);
  }

  const responseRows = Array.isArray(responseRowsResult.data) ? responseRowsResult.data : [];
  const responseCountBySectorName = new Map<string, number>();
  for (const response of responseRows) {
    const sectorName = resolveSector(response.group_values);
    responseCountBySectorName.set(sectorName, (responseCountBySectorName.get(sectorName) ?? 0) + 1);
  }

  const questionTopicRows = Array.isArray(questionTopicsResult.data) ? questionTopicsResult.data : [];
  const questionTopicById = new Map(questionTopicRows.map((row) => [row.id, row.topic_id]));
  const questionIds = Array.from(questionTopicById.keys());

  let answerRows: AnswerScoreRow[] = [];
  if (questionIds.length > 0) {
    const answersResult = await supabase
      .from("answers")
      .select("response_id,question_id,corrected_value")
      .in("question_id", questionIds)
      .returns<AnswerScoreRow[]>();

    if (answersResult.error) {
      return NextResponse.json({ error: "Could not load campaign dashboard." }, { status: 500 });
    }

    answerRows = Array.isArray(answersResult.data) ? answersResult.data : [];
  }

  const responseRiskDataset = buildResponseRiskDataset({
    responses: responseRows,
    answers: answerRows,
    questionTopicById,
  });

  const topicIds = Array.from(
    new Set([
      ...normalizedGlobal.map((topic) => topic.topicId),
      ...questionTopicRows.map((question) => question.topic_id),
    ]),
  ).sort((a, b) => a - b);

  const globalRiskFactors = buildRiskFactorMetrics(responseRiskDataset, topicIds);
  const rankedRiskFactors = globalRiskFactors
    .filter((metric) => metric.riskScore !== null)
    .slice()
    .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0));

  const riskDistribution = {
    low: normalizedGlobal.filter((item) => item.risk === "low").length,
    medium: normalizedGlobal.filter((item) => item.risk === "medium").length,
    high: normalizedGlobal.filter((item) => item.risk === "high").length,
    critical: normalizedGlobal.filter((item) => item.risk === "critical").length,
  };

  const sectorConfigs = Array.isArray(sectorConfigResult.data) ? sectorConfigResult.data : [];
  const configByName = new Map(sectorConfigs.map((item) => [item.name, item]));
  const allSectorNames = Array.from(
    new Set([
      ...sectorConfigs.map((item) => item.name),
      ...sectorCounts.map((item) => item.group_value),
      ...Array.from(responseCountBySectorName.keys()),
    ]),
  );

  const datasetRowsBySectorName = new Map<string, ResponseRiskDatasetRow[]>();
  for (const row of responseRiskDataset) {
    const list = datasetRowsBySectorName.get(row.sector) ?? [];
    list.push(row);
    datasetRowsBySectorName.set(row.sector, list);
  }

  const sectorMetricByName = new Map<string, SectorMetricSnapshot>();
  for (const sectorName of allSectorNames) {
    const nResponses = countBySectorName.get(sectorName) ?? responseCountBySectorName.get(sectorName) ?? 0;
    const suppressed = nResponses > 0 && nResponses < selectedCampaign.k_anonymity_min;
    const sectorRows = datasetRowsBySectorName.get(sectorName) ?? [];

    if (suppressed || nResponses === 0) {
      sectorMetricByName.set(sectorName, {
        sector: sectorName,
        nResponses,
        suppressed,
        sectorRiskIndex: null,
        sectorRiskCategory: null,
        psychosocialLoadIndex: null,
        riskConcentration: null,
        criticalExposure: null,
        criticalEmployees: 0,
        employeeCount: 0,
        riskFactors: [],
      });
      continue;
    }

    const riskFactors = buildRiskFactorMetrics(sectorRows, topicIds);
    const criticalExposure = computeCriticalExposure(sectorRows);
    const sectorRiskIndex = computeCompositeIndex(riskFactors, (metric) => metric.riskScore);
    const psychosocialLoadIndex = computeCompositeIndex(riskFactors, (metric) => metric.meanExposure);
    const concentrationRaw = safeStdDev(sectorRows.map((row) => row.score));
    const riskConcentration = concentrationRaw === null ? null : round(concentrationRaw);

    sectorMetricByName.set(sectorName, {
      sector: sectorName,
      nResponses,
      suppressed: false,
      sectorRiskIndex,
      sectorRiskCategory: matrixClassFromRiskScore(sectorRiskIndex),
      psychosocialLoadIndex,
      riskConcentration,
      criticalExposure: criticalExposure.rate,
      criticalEmployees: criticalExposure.criticalEmployees,
      employeeCount: criticalExposure.employees,
      riskFactors,
    });
  }

  const sectors = [] as Array<{
    sector: string;
    sectorId: string | null;
    sectorKey: string | null;
    riskParameter: number;
    accessToken: string | null;
    accessLink: string | null;
    submissionCount: number;
    lastSubmittedAt: string | null;
    nResponses: number;
    suppressed: boolean;
    adjustedRiskIndex: number | null;
    adjustedRiskClass: "low" | "medium" | "high" | null;
    topics: Array<ReturnType<typeof normalizeTopic>>;
    sectorRiskIndex: number | null;
    sectorRiskCategory: RiskMatrixClass | null;
    psychosocialLoadIndex: number | null;
    riskConcentration: number | null;
    criticalExposure: number | null;
    criticalEmployees: number;
    employeeCount: number;
    riskFactors: RiskFactorMetric[];
  }>;

  for (const sectorName of allSectorNames) {
    const config = configByName.get(sectorName);
    const riskParameter = config ? toRiskParameter(config.risk_parameter) : 1;
    const snapshot = sectorMetricByName.get(sectorName);
    const nResponses = snapshot?.nResponses ?? 0;
    const suppressed = snapshot?.suppressed ?? false;

    if (!snapshot || suppressed || nResponses === 0) {
      sectors.push({
        sector: sectorName,
        sectorId: config?.id ?? null,
        sectorKey: config?.key ?? null,
        riskParameter,
        accessToken: config?.access_token ?? null,
        accessLink: config
          ? buildAccessLink(request.nextUrl.origin, selectedCampaign.public_slug, config.access_token)
          : null,
        submissionCount: config?.submission_count ?? 0,
        lastSubmittedAt: config?.last_submitted_at ?? null,
        nResponses,
        suppressed,
        adjustedRiskIndex: null,
        adjustedRiskClass: null,
        topics: [],
        sectorRiskIndex: null,
        sectorRiskCategory: null,
        psychosocialLoadIndex: null,
        riskConcentration: null,
        criticalExposure: null,
        criticalEmployees: 0,
        employeeCount: 0,
        riskFactors: [],
      });
      continue;
    }

    const normalizedTopics: Array<ReturnType<typeof normalizeTopic>> = snapshot.riskFactors.map((riskFactor) => {
      const severityClass = classifyScore(riskFactor.meanExposure);
      const probabilityClass = classifyScore(riskFactor.meanExposure);
      return {
        topicId: riskFactor.topicId,
        nResponses: snapshot.nResponses,
        meanSeverity: riskFactor.meanExposure,
        meanProbability: riskFactor.meanExposure,
        severityClass,
        probabilityClass,
        risk: resolveRisk(severityClass, probabilityClass),
      };
    });
    const adjustedRisk = computeAdjustedSectorRisk(normalizedTopics, riskParameter);

    sectors.push({
      sector: sectorName,
      sectorId: config?.id ?? null,
      sectorKey: config?.key ?? null,
      riskParameter,
      accessToken: config?.access_token ?? null,
      accessLink: config
        ? buildAccessLink(request.nextUrl.origin, selectedCampaign.public_slug, config.access_token)
        : null,
      submissionCount: config?.submission_count ?? 0,
      lastSubmittedAt: config?.last_submitted_at ?? null,
      nResponses: snapshot.nResponses,
      suppressed: false,
      adjustedRiskIndex: adjustedRisk.adjustedRiskIndex,
      adjustedRiskClass: adjustedRisk.adjustedRiskClass,
      topics: normalizedTopics,
      sectorRiskIndex: snapshot.sectorRiskIndex,
      sectorRiskCategory: snapshot.sectorRiskCategory,
      psychosocialLoadIndex: snapshot.psychosocialLoadIndex,
      riskConcentration: snapshot.riskConcentration,
      criticalExposure: snapshot.criticalExposure,
      criticalEmployees: snapshot.criticalEmployees,
      employeeCount: snapshot.employeeCount,
      riskFactors: snapshot.riskFactors,
    });
  }

  sectors.sort((a, b) => b.nResponses - a.nResponses);

  const globalCriticalExposure = computeCriticalExposure(responseRiskDataset);
  const globalRiskConcentrationRaw = safeStdDev(responseRiskDataset.map((row) => row.score));
  const globalRiskConcentration = globalRiskConcentrationRaw === null ? null : round(globalRiskConcentrationRaw);
  const globalRiskIndex = computeCompositeIndex(globalRiskFactors, (metric) => metric.riskScore);
  const psychosocialLoadIndex = computeCompositeIndex(globalRiskFactors, (metric) => metric.meanExposure);

  const suppressedSectorSet = new Set(
    allSectorNames.filter((sectorName) => {
      const nResponses = countBySectorName.get(sectorName) ?? responseCountBySectorName.get(sectorName) ?? 0;
      return nResponses > 0 && nResponses < selectedCampaign.k_anonymity_min;
    }),
  );
  const visibleResponseRows = responseRiskDataset.filter((row) => !suppressedSectorSet.has(row.sector));

  const trendTopicIds = globalRiskFactors.map((metric) => metric.topicId);
  const storedTrendSeries = buildTrendSeriesFromStoredTimeseries(
    storedTimeseriesRows.filter(
      (row) => trendTopicIds.includes(row.topic_id) && !suppressedSectorSet.has(row.sector_name),
    ),
    trendTopicIds,
  );
  const fallbackTrendSeries = Array.from(new Set(visibleResponseRows.map((row) => row.sector)))
    .slice()
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .flatMap((sector) =>
      buildTrendSeries(
        visibleResponseRows.filter((row) => row.sector === sector),
        trendTopicIds,
        sector,
      ),
    )
    .filter((series) => series.points.length > 0);
  const trendSeries = fallbackTrendSeries.length > 0 ? fallbackTrendSeries : storedTrendSeries;

  const visibleDatasetRows = visibleResponseRows
    .slice()
    .sort((a, b) => {
      const byTimestamp = b.timestamp.localeCompare(a.timestamp);
      if (byTimestamp !== 0) return byTimestamp;
      const bySector = a.sector.localeCompare(b.sector);
      if (bySector !== 0) return bySector;
      return a.employeeId.localeCompare(b.employeeId);
    });

  const heatmapRows = sectors.map((sector) => {
    const metricByTopicId = new Map(sector.riskFactors.map((riskFactor) => [riskFactor.topicId, riskFactor]));
    return {
      sector: sector.sector,
      nResponses: sector.nResponses,
      suppressed: sector.suppressed,
      sectorRiskIndex: sector.sectorRiskIndex,
      cells: topicIds.map((topicId) => {
        const metric = metricByTopicId.get(topicId);
        return {
          topicId,
          riskFactor: toTopicLabel(topicId),
          meanExposure: metric?.meanExposure ?? null,
          exposureLevel: metric?.exposureLevel ?? null,
        };
      }),
    };
  });

  return NextResponse.json({
    ...basePayload,
    dashboard: {
      totals: {
        responses: globalRows[0]?.n_responses ?? responseRows.length,
        topics: topicIds.length,
        activeSectors: sectorConfigs.length,
      },
      riskDistribution,
      topics: normalizedGlobalWithLabels,
      responseTimeseries: Array.isArray(timeseriesResult.data) ? timeseriesResult.data : [],
      sectors,
      latestDrps: Array.isArray(latestDrpsResult.data) ? latestDrpsResult.data[0] ?? null : null,
      metrics: {
        dataset: {
          totalRows: responseRiskDataset.length,
          visibleRows: visibleDatasetRows.length,
          sample: visibleDatasetRows.slice(0, 120).map((row) => ({
            employee_id: row.employeeId,
            sector: row.sector,
            risk_factor: row.riskFactor,
            topic_id: row.topicId,
            score: row.score,
            timestamp: row.timestamp,
          })),
        },
        global: {
          riskIndex: globalRiskIndex,
          psychosocialLoadIndex,
          riskConcentration: globalRiskConcentration,
          criticalExposure: globalCriticalExposure.rate,
          criticalExposureEmployees: globalCriticalExposure.criticalEmployees,
          employeesEvaluated: globalCriticalExposure.employees,
        },
        riskFactors: globalRiskFactors,
        ranking: rankedRiskFactors,
        riskMatrix: globalRiskFactors.map((metric) => ({
          topicId: metric.topicId,
          riskFactor: metric.riskFactor,
          probability: metric.probability,
          severity: metric.severity,
          riskScore: metric.riskScore,
          affectedEmployees: metric.affectedEmployees,
          category: metric.riskCategory,
        })),
        heatmap: {
          columns: topicIds.map((topicId) => ({
            topicId,
            riskFactor: toTopicLabel(topicId),
          })),
          rows: heatmapRows,
        },
        trends: trendSeries,
        sectorRanking: sectors
          .filter((sector) => !sector.suppressed && sector.sectorRiskIndex !== null)
          .slice()
          .sort((a, b) => (b.sectorRiskIndex ?? 0) - (a.sectorRiskIndex ?? 0))
          .map((sector) => ({
            sector: sector.sector,
            sectorRiskIndex: sector.sectorRiskIndex,
            category: sector.sectorRiskCategory,
            responses: sector.nResponses,
          })),
      },
    },
    reports: reportsMissing ? [] : reportsResult.data ?? [],
  });
}
