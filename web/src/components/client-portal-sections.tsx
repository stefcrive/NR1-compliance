"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { findProgramById } from "@/lib/programs-catalog";

type Diagnostic = {
  id: string;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  starts_at: string | null;
  closes_at: string | null;
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
      trends: Array<{
        topicId: number;
        riskFactor: string;
        points: Array<{
          period: string;
          meanExposure: number;
          probability: number;
          riskScore: number;
          responses: number;
        }>;
      }>;
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

function useClientPortalData(clientSlug: string, campaignId?: string, reloadToken = 0) {
  const [data, setData] = useState<ClientPortalPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    async function load() {
      setIsLoading(true);
      setError("");
      try {
        const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
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
  }, [campaignId, clientSlug, reloadToken]);

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

function heatCellColor(meanExposure: number | null) {
  if (meanExposure === null) return "bg-slate-100 text-slate-500";
  if (meanExposure <= 2) return "bg-emerald-100 text-emerald-800";
  if (meanExposure <= 3) return "bg-amber-100 text-amber-800";
  if (meanExposure <= 4) return "bg-orange-100 text-orange-800";
  return "bg-rose-100 text-rose-800";
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
      "Each bubble is one risk factor. X-axis is probability of occurrence, Y-axis is fixed severity weight, and bubble size represents affected employees.",
    howToUse: [
      "Focus first on the upper-right quadrant, where probability and severity are both high.",
      "Use bubble size to prioritize actions with the largest exposed population.",
      "Track movement over time: right/up means deterioration, left/down means mitigation.",
    ],
  },
  radar: {
    title: "Sector Radar Profile",
    whatItShows:
      "Displays one sector profile across all risk factors at once, allowing pattern recognition across the risk system.",
    howToUse: [
      "Identify spikes to find which risk dimensions dominate this sector's profile.",
      "Compare radar shape across survey cycles to check if interventions are balancing the profile.",
      "Use with matrix and prevalence to distinguish broad stress climate from isolated acute risks.",
    ],
  },
  distribution: {
    title: "Distribution Plots",
    whatItShows:
      "For each risk factor, bars show how many responses fell into scores 1 to 5.",
    howToUse: [
      "Look for right-skewed distributions (4-5) as early warning for chronic exposure.",
      "Look for polarized distributions to detect unequal exposure and potential subgroup harm.",
      "Use distribution shape to avoid relying only on averages that can hide severe pockets.",
    ],
  },
  ranking: {
    title: "Critical Risk Ranking",
    whatItShows:
      "Sorted list of risk factors by risk score (probability x severity), with prevalence context.",
    howToUse: [
      "Use the top risks as immediate priorities for executive action plans.",
      "Cross-check with sector ranking to target interventions where each top risk is concentrated.",
      "Use rank changes between cycles to evaluate intervention impact.",
    ],
  },
  trend: {
    title: "Trend Analysis",
    whatItShows:
      "Time series for one risk factor (typically top-ranked), tracking mean exposure by period.",
    howToUse: [
      "Rising trend indicates worsening climate and higher legal/operational exposure.",
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
  const [openDiagnosticActionsFor, setOpenDiagnosticActionsFor] = useState<string | null>(null);
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
    await navigator.clipboard.writeText(sector.accessLink);
    setCopiedSectorId(sector.id);
    window.setTimeout(() => setCopiedSectorId(null), 1200);
  }

  async function copyAllLinks() {
    if (!linksPayload) return;
    const lines = linksPayload.sectors
      .filter((sector) => sector.isActive)
      .map((sector) => `${sector.name}: ${sector.accessLink}`);
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
        csvEscape(sector.accessLink),
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

  return (
    <div className="space-y-6">
      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">Diagnosticos DRPS (status e resultados)</h2>
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
                <th className="px-2 py-2 text-left">Acoes</th>
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
                    <td className="px-2 py-2">
                      <div className="relative inline-flex">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenDiagnosticActionsFor((previous) =>
                              previous === campaign.id ? null : campaign.id,
                            )
                          }
                          className="rounded-full border border-[#c8c8c8] px-3 py-1 text-xs font-semibold text-[#1b2832]"
                        >
                          ...
                        </button>
                        {openDiagnosticActionsFor === campaign.id ? (
                          <div className="absolute right-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-xl border border-[#d9d9d9] bg-white shadow-lg">
                            <button
                              type="button"
                              onClick={() => {
                                setOpenDiagnosticActionsFor(null);
                                router.push(`/client/${clientSlug}/diagnostic/${campaign.id}`);
                              }}
                              className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#1b2832] hover:bg-[#f5f6f7]"
                            >
                              Ver resultados
                            </button>
                            <button
                              type="button"
                              disabled={isLoadingLinksFor === campaign.id}
                              onClick={() => {
                                setOpenDiagnosticActionsFor(null);
                                void loadQuestionnaireLinks(campaign);
                              }}
                              className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#5a2b8a] hover:bg-[#f8f2ff] disabled:cursor-not-allowed disabled:text-[#9aa6af]"
                            >
                              {isLoadingLinksFor === campaign.id
                                ? "Carregando..."
                                : "Gerar links questionario"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </td>
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
                              value={sector.accessLink}
                              className="w-full min-w-[280px] rounded border border-[#d5e2ea] bg-[#f7fbfe] px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => void copySectorLink(sector)}
                              className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                            >
                              {copiedSectorId === sector.id ? "Copiado" : "Copiar"}
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

export function ClientDiagnosticResultsSection({
  clientSlug,
  campaignId,
}: {
  clientSlug: string;
  campaignId: string;
}) {
  const { data, isLoading, error } = useClientPortalData(clientSlug, campaignId);

  const campaign = data?.selectedCampaign ?? null;
  const dashboard = data?.dashboard ?? null;
  const metrics = dashboard?.metrics;
  const ranking = (metrics?.ranking ?? []).slice(0, 5);
  const topRisk = ranking[0] ?? null;
  const matrixPoints = (metrics?.riskMatrix ?? [])
    .filter((item) => item.probability !== null && item.riskScore !== null)
    .slice()
    .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0));
  const sectorRanking = (metrics?.sectorRanking ?? []).slice(0, 5);
  const heatmap = metrics?.heatmap;
  const trends = metrics?.trends ?? [];
  const trendTopicId = topRisk?.topicId ?? trends[0]?.topicId ?? null;
  const selectedTrend = (trendTopicId ? trends.find((series) => series.topicId === trendTopicId) : null) ?? null;
  const [datasetSectorFilter, setDatasetSectorFilter] = useState("all");
  const [datasetSortKey, setDatasetSortKey] = useState<DatasetSortKey>("timestamp");
  const [datasetSortDirection, setDatasetSortDirection] = useState<"asc" | "desc">("desc");
  const [activePlotInfo, setActivePlotInfo] = useState<PlotInfoKey | null>(null);

  const datasetSampleRows = useMemo(() => metrics?.dataset.sample ?? [], [metrics?.dataset.sample]);
  const datasetSectorOptions = useMemo(
    () => Array.from(new Set(datasetSampleRows.map((row) => row.sector))).sort((a, b) => a.localeCompare(b)),
    [datasetSampleRows],
  );

  const datasetRows = useMemo(() => {
    const filtered = datasetSampleRows.filter(
      (row) => datasetSectorFilter === "all" || row.sector === datasetSectorFilter,
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
  }, [datasetSampleRows, datasetSectorFilter, datasetSortDirection, datasetSortKey]);

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
    const width = 420;
    const height = 280;
    const padding = { left: 44, right: 18, top: 18, bottom: 30 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const maxAffected = Math.max(...matrixPoints.map((point) => point.affectedEmployees), 1);

    const points = matrixPoints.map((point, index) => {
      const probability = point.probability ?? 0;
      const normalizedSeverity = (point.severity - 1) / 4;
      const x = padding.left + probability * plotWidth;
      const y = padding.top + (1 - normalizedSeverity) * plotHeight;
      const radius = 4 + (point.affectedEmployees / maxAffected) * 12;
      const horizontalDirection = index % 2 === 0 ? 1 : -1;
      const verticalOffset = ((index % 3) - 1) * 10;
      const labelX = Math.min(
        width - padding.right - 2,
        Math.max(padding.left + 2, x + horizontalDirection * (radius + 8)),
      );
      const labelY = Math.min(
        height - padding.bottom - 2,
        Math.max(padding.top + 10, y + verticalOffset),
      );
      const labelAnchor: "start" | "end" = horizontalDirection === 1 ? "start" : "end";
      return {
        ...point,
        x,
        y,
        radius,
        label: shortRiskName(point.riskFactor, point.topicId),
        labelX,
        labelY,
        labelAnchor,
      };
    });

    return {
      width,
      height,
      padding,
      plotWidth,
      plotHeight,
      points,
    };
  }, [matrixPoints]);

  const radarSector = useMemo(() => {
    return (dashboard?.sectors ?? [])
      .filter((sector) => !sector.suppressed && (sector.riskFactors?.length ?? 0) > 0)
      .slice()
      .sort((a, b) => (b.sectorRiskIndex ?? 0) - (a.sectorRiskIndex ?? 0))[0] ?? null;
  }, [dashboard?.sectors]);

  const radarModel = useMemo(() => {
    if (!radarSector?.riskFactors || radarSector.riskFactors.length === 0) return null;
    const factors = radarSector.riskFactors;
    const size = 320;
    const center = size / 2;
    const radius = 118;
    const levels = [0.2, 0.4, 0.6, 0.8, 1];

    const vertices = factors.map((factor, index) => {
      const angle = (-Math.PI / 2) + (2 * Math.PI * index) / factors.length;
      const normalizedValue = (factor.meanExposure ?? 0) / 5;
      const x = center + Math.cos(angle) * radius * normalizedValue;
      const y = center + Math.sin(angle) * radius * normalizedValue;
      const axisX = center + Math.cos(angle) * radius;
      const axisY = center + Math.sin(angle) * radius;
      return {
        topicId: factor.topicId,
        label: shortRiskName(factor.riskFactor, factor.topicId),
        x,
        y,
        axisX,
        axisY,
      };
    });

    const polygonPoints = vertices.map((vertex) => `${vertex.x},${vertex.y}`).join(" ");
    const axisLines = vertices.map((vertex) => ({
      x1: center,
      y1: center,
      x2: vertex.axisX,
      y2: vertex.axisY,
      topicId: vertex.topicId,
    }));
    const rings = levels.map((level) =>
      vertices
        .map((vertex) => {
          const x = center + (vertex.axisX - center) * level;
          const y = center + (vertex.axisY - center) * level;
          return `${x},${y}`;
        })
        .join(" "),
    );

    return {
      size,
      center,
      polygonPoints,
      axisLines,
      rings,
      vertices,
    };
  }, [radarSector?.riskFactors]);

  const trendModel = useMemo(() => {
    if (!selectedTrend || selectedTrend.points.length === 0) return null;
    const points = selectedTrend.points;
    const width = 520;
    const height = 220;
    const padding = { left: 40, right: 20, top: 16, bottom: 30 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const maxY = Math.max(...points.map((point) => point.meanExposure), 1);
    const denominator = Math.max(points.length - 1, 1);

    const plotted = points.map((point, index) => {
      const x = padding.left + (index / denominator) * plotWidth;
      const y = padding.top + (1 - point.meanExposure / maxY) * plotHeight;
      return { ...point, x, y };
    });

    return {
      width,
      height,
      points: plotted,
      polyline: plotted.map((point) => `${point.x},${point.y}`).join(" "),
    };
  }, [selectedTrend]);

  if (isLoading) return <p className="text-sm text-[#49697a]">Carregando resultados do diagnostico...</p>;
  if (error || !data) return <p className="text-sm text-red-600">{error || "Resultados indisponiveis."}</p>;

  return (
    <div className="space-y-6">
      <nav className="text-xs text-[#4f6977]">
        <Link href={`/client/${clientSlug}/company`} className="text-[#1b2832]">
          Home
        </Link>{" "}
        &gt; <span>{campaign?.name ?? "Diagnostico"}</span> &gt; <span>Resultados</span>
      </nav>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">{campaign?.name ?? "Resultados do diagnostico"}</h2>
        <p className="mt-1 text-sm text-[#475660]">
          Responses {dashboard?.totals.responses ?? 0} | Risks {dashboard?.totals.topics ?? 0} |
          Setores ativos {dashboard?.totals.activeSectors ?? 0}
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-[20px] border border-[#dfdfdf] bg-[#f8f8f8] p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-[#516b79]">Global Risk Index</p>
          <p className="mt-2 text-2xl font-semibold text-[#14384a]">
            {metrics?.global.riskIndex !== null && metrics?.global.riskIndex !== undefined
              ? metrics.global.riskIndex.toFixed(2)
              : "-"}
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
                {(heatmap?.columns ?? []).map((column) => (
                  <th key={column.topicId} className="px-2 py-2 text-left">
                    <span title={column.riskFactor}>{shortRiskName(column.riskFactor, column.topicId)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(heatmap?.rows ?? []).map((row) => (
                <tr key={row.sector} className="border-b">
                  <td className="px-2 py-2 font-medium text-[#1e3947]">{row.sector}</td>
                  <td className="px-2 py-2 text-[#496879]">{row.nResponses}</td>
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
        <article className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
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
          <p className="mt-1 text-xs text-[#55707f]">x: probability | y: severity | bubble: affected employees</p>
          <div className="mt-3 overflow-x-auto">
            {matrixModel ? (
              <svg viewBox={`0 0 ${matrixModel.width} ${matrixModel.height}`} className="h-[300px] w-full min-w-[420px]">
                {[0, 0.25, 0.5, 0.75, 1].map((step) => {
                  const x = matrixModel.padding.left + step * matrixModel.plotWidth;
                  return (
                    <line
                      key={`x-${step}`}
                      x1={x}
                      y1={matrixModel.padding.top}
                      x2={x}
                      y2={matrixModel.height - matrixModel.padding.bottom}
                      stroke="#dce7ee"
                      strokeDasharray="4 6"
                    />
                  );
                })}
                {[1, 2, 3, 4, 5].map((severity) => {
                  const normalized = (severity - 1) / 4;
                  const y = matrixModel.padding.top + (1 - normalized) * matrixModel.plotHeight;
                  return (
                    <line
                      key={`y-${severity}`}
                      x1={matrixModel.padding.left}
                      y1={y}
                      x2={matrixModel.width - matrixModel.padding.right}
                      y2={y}
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
                {[0, 0.25, 0.5, 0.75, 1].map((step) => {
                  const x = matrixModel.padding.left + step * matrixModel.plotWidth;
                  return (
                    <text
                      key={`xt-${step}`}
                      x={x}
                      y={matrixModel.height - matrixModel.padding.bottom + 14}
                      textAnchor="middle"
                      className="fill-[#475569] text-[9px]"
                    >
                      {step.toFixed(2)}
                    </text>
                  );
                })}
                {[1, 2, 3, 4, 5].map((severity) => {
                  const normalized = (severity - 1) / 4;
                  const y = matrixModel.padding.top + (1 - normalized) * matrixModel.plotHeight;
                  return (
                    <text
                      key={`yt-${severity}`}
                      x={matrixModel.padding.left - 8}
                      y={y + 3}
                      textAnchor="end"
                      className="fill-[#475569] text-[9px]"
                    >
                      {severity}
                    </text>
                  );
                })}
                <text
                  x={(matrixModel.padding.left + (matrixModel.width - matrixModel.padding.right)) / 2}
                  y={matrixModel.height - 2}
                  textAnchor="middle"
                  className="fill-[#334155] text-[10px]"
                >
                  Probability of occurrence
                </text>
                <text
                  x={12}
                  y={matrixModel.height / 2}
                  textAnchor="middle"
                  transform={`rotate(-90 12 ${matrixModel.height / 2})`}
                  className="fill-[#334155] text-[10px]"
                >
                  Severity
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
                      className="fill-[#1f2937] text-[9px] font-semibold"
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
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[#4b6472]">
            <span className="font-semibold text-[#223845]">Legend:</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[#d8e5ec] px-2 py-0.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#86efac]" />
              low
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[#d8e5ec] px-2 py-0.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#fde68a]" />
              moderate
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[#d8e5ec] px-2 py-0.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#fdba74]" />
              high
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[#d8e5ec] px-2 py-0.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#fca5a5]" />
              critical
            </span>
            <span className="rounded-full border border-[#d8e5ec] px-2 py-0.5">bubble size = affected employees</span>
          </div>
        </article>

        <article className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
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
            {radarSector ? `${radarSector.sector} (highest sector risk index)` : "No eligible sector"}
          </p>
          <div className="mt-3 overflow-x-auto">
            {radarModel ? (
              <svg viewBox={`0 0 ${radarModel.size} ${radarModel.size}`} className="mx-auto h-[320px] w-[320px]">
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
                <polygon points={radarModel.polygonPoints} fill="#93c5fd55" stroke="#1d4ed8" strokeWidth="2" />
                {radarModel.vertices.map((vertex) => (
                  <g key={`vertex-${vertex.topicId}`}>
                    <circle cx={vertex.x} cy={vertex.y} r={3} fill="#1d4ed8" />
                    <text x={vertex.axisX} y={vertex.axisY} textAnchor="middle" className="fill-[#334155] text-[9px]">
                      {vertex.label}
                    </text>
                  </g>
                ))}
              </svg>
            ) : (
              <p className="text-sm text-[#5b7482]">No radar data available.</p>
            )}
          </div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <article className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-[#141d24]">Distribution Plots (all risks)</h3>
            <button
              type="button"
              onClick={() => setActivePlotInfo("distribution")}
              className="rounded-full border border-[#b8cfdb] px-2 py-0.5 text-xs font-semibold text-[#17465b]"
              aria-label="Distribution info"
            >
              i
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
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

        <article className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-[#141d24]">Critical Risk Ranking</h3>
            <button
              type="button"
              onClick={() => setActivePlotInfo("ranking")}
              className="rounded-full border border-[#b8cfdb] px-2 py-0.5 text-xs font-semibold text-[#17465b]"
              aria-label="Ranking info"
            >
              i
            </button>
          </div>
          <div className="mt-3 space-y-3">
            {ranking.map((item, index) => (
              <div key={`${item.topicId}-${item.riskFactor}`} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#334e5c]">
                    #{index + 1} {item.riskFactor}
                  </span>
                  <span className="font-semibold text-[#132f3d]">
                    {item.riskScore !== null ? item.riskScore.toFixed(2) : "-"}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[#ecf3f7]">
                  <div
                    className="h-2 rounded-full bg-[#f97316]"
                    style={{ width: `${((item.riskScore ?? 0) / 5) * 100}%` }}
                  />
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[#617a88]">
                  <span className={`rounded-full border px-2 py-0.5 ${metricTone(item.riskCategory)}`}>
                    {normalizeMetricLabel(item.riskCategory)}
                  </span>
                  <span>prevalence {fmtPercent(item.prevalence)}</span>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-[#141d24]">Trend Analysis ({selectedTrend?.riskFactor ?? "n/a"})</h3>
          <button
            type="button"
            onClick={() => setActivePlotInfo("trend")}
            className="rounded-full border border-[#b8cfdb] px-2 py-0.5 text-xs font-semibold text-[#17465b]"
            aria-label="Trend info"
          >
            i
          </button>
        </div>
        <div className="mt-3 overflow-x-auto">
          {trendModel ? (
            <svg viewBox={`0 0 ${trendModel.width} ${trendModel.height}`} className="h-[240px] w-full min-w-[520px]">
              {[0, 0.25, 0.5, 0.75, 1].map((step) => {
                const y = 16 + step * (220 - 16 - 30);
                return (
                  <line
                    key={`grid-${step}`}
                    x1={40}
                    y1={y}
                    x2={500}
                    y2={y}
                    stroke="#dce7ee"
                    strokeDasharray="4 6"
                  />
                );
              })}
              <polyline fill="none" stroke="#0f766e" strokeWidth="3" points={trendModel.polyline} />
              {trendModel.points.map((point) => (
                <g key={`trend-${point.period}`}>
                  <circle cx={point.x} cy={point.y} r={4} fill="#0f766e" />
                  <text x={point.x} y={210} textAnchor="middle" className="fill-[#415564] text-[10px]">
                    {point.period}
                  </text>
                </g>
              ))}
            </svg>
          ) : (
            <p className="text-sm text-[#5b7482]">No trend data available.</p>
          )}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#141d24]">Top Sectors by Risk Index</h3>
          <div className="mt-3 space-y-2">
            {sectorRanking.map((sector) => (
              <div key={sector.sector} className="rounded-xl border border-[#e3edf3] bg-white p-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-[#1e3947]">{sector.sector}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${metricTone(sector.category)}`}>
                    {normalizeMetricLabel(sector.category)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#56707e]">
                  Index {sector.sectorRiskIndex !== null ? sector.sectorRiskIndex.toFixed(2) : "-"} | Responses{" "}
                  {sector.responses}
                </p>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#141d24]">Risk Factors (core metrics)</h3>
          <div className="mt-3 max-h-[320px] overflow-auto rounded-xl border border-[#dce8ee] bg-white">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b bg-[#f5fafc]">
                  <th className="px-2 py-2 text-left">Risk</th>
                  <th className="px-2 py-2 text-left">Mean</th>
                  <th className="px-2 py-2 text-left">Prevalence</th>
                  <th className="px-2 py-2 text-left">Severity idx</th>
                  <th className="px-2 py-2 text-left">Prob.</th>
                  <th className="px-2 py-2 text-left">Sev.</th>
                  <th className="px-2 py-2 text-left">Score</th>
                </tr>
              </thead>
              <tbody>
                {(metrics?.riskFactors ?? []).map((risk) => (
                  <tr key={`${risk.topicId}-${risk.riskFactor}`} className="border-b">
                    <td className="px-2 py-2">
                      {topicCode(risk.topicId)} {risk.riskFactor}
                    </td>
                    <td className="px-2 py-2">{risk.meanExposure !== null ? risk.meanExposure.toFixed(2) : "-"}</td>
                    <td className="px-2 py-2">{fmtPercent(risk.prevalence)}</td>
                    <td className="px-2 py-2">{risk.severityIndex !== null ? risk.severityIndex.toFixed(2) : "-"}</td>
                    <td className="px-2 py-2">{risk.probability !== null ? risk.probability.toFixed(2) : "-"}</td>
                    <td className="px-2 py-2">{risk.severity}</td>
                    <td className="px-2 py-2">{risk.riskScore !== null ? risk.riskScore.toFixed(2) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">Response Dataset Preview</h3>
        <p className="mt-1 text-xs text-[#55707f]">
          rows: {datasetRows.length} (sample up to 120 rows, anonymized employee id)
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
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

  return (
    <div className="space-y-6">
      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">Reports</h2>
        <p className="mt-1 text-sm text-[#475660]">Tabelas de relatorios DRPS e processos continuos.</p>
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
  const nextMeeting = useMemo(() => {
    return assignmentMeetings.find((item) => item.status === "scheduled") ?? assignmentMeetings[0] ?? null;
  }, [assignmentMeetings]);
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
        <Link href={`/client/${clientSlug}/programs`} className="text-[#1b2832]">
          Programas Continuos
        </Link>{" "}
        &gt; <span>{displayTitle}</span>
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
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-2 text-left">Evento</th>
                  <th className="px-2 py-2 text-left">Data atual</th>
                  <th className="px-2 py-2 text-left">Duracao</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-left">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {assignmentMeetings.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-3 text-xs text-[#5a7383]">
                      Nenhuma reuniao em calendario para esta atribuicao no momento.
                    </td>
                  </tr>
                ) : (
                  assignmentMeetings.map((item) => {
                    const calendarEventLink = `/client/${clientSlug}/company?calendarEventId=${encodeURIComponent(item.id)}`;
                    const portalProgramLink = `/client/${clientSlug}/programs/${encodeURIComponent(
                      assignedFromApi.programId,
                    )}?assignmentId=${encodeURIComponent(assignedFromApi.id)}`;
                    return (
                      <tr key={item.id} className="border-b">
                        <td className="px-2 py-2">{item.title}</td>
                        <td className="px-2 py-2">{fmtDateTime(item.startsAt)}</td>
                        <td className="px-2 py-2">{fmtDuration(item.startsAt, item.endsAt)}</td>
                        <td className="px-2 py-2">{item.status}</td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={calendarEventLink}
                              className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                            >
                              Abrir no calendario
                            </Link>
                            <Link
                              href={portalProgramLink}
                              className="rounded-full border border-[#c8c8c8] px-3 py-1 text-xs font-semibold text-[#1b2832]"
                            >
                              Ver no portal
                            </Link>
                          </div>
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



