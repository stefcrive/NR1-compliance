"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Campaign = {
  id: string;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  k_anonymity_min: number;
  starts_at: string | null;
  closes_at: string | null;
  created_at: string;
  responses?: number;
  employeeFormLink?: string;
};

type Sector = {
  sector: string;
  sectorId: string | null;
  riskParameter: number;
  accessLink: string | null;
  submissionCount: number;
  lastSubmittedAt: string | null;
  suppressed?: boolean;
  sectorRiskIndex?: number | null;
  riskFactors?: RiskFactorMetric[];
};

type RiskFactorMetric = {
  topicId: number;
  riskFactor: string;
  meanExposure: number | null;
};

type RiskMatrixPoint = {
  topicId: number;
  riskFactor: string;
  probability: number | null;
  severity: number;
  riskScore: number | null;
  affectedEmployees: number;
  category: "low" | "moderate" | "high" | "critical" | null;
};

type Report = {
  id: string;
  report_title: string;
  status: "draft" | "processing" | "ready" | "failed";
  created_at: string;
};

type SectorLink = {
  id: string;
  key?: string;
  name: string;
  riskParameter?: number;
  accessLink: string;
  isActive: boolean;
  submissionCount: number;
  lastSubmittedAt: string | null;
};

type SectorPayload = {
  campaign: { id: string; name: string; slug: string };
  sectors: SectorLink[];
};

type AssignedProgram = {
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
};

type MasterCalendarEvent = {
  id: string;
  clientId: string | null;
  clientName: string | null;
  eventType: "drps_start" | "drps_close" | "continuous_meeting" | "blocked";
  title: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "completed" | "cancelled";
  sourceClientProgramId: string | null;
  details: {
    content: string | null;
    preparationRequired: string | null;
    eventLifecycle: "provisory" | "committed";
    proposalKind: "assignment" | "reschedule" | null;
    availabilityRequestId: string | null;
  };
};

type Payload = {
  client: {
    id: string;
    companyName: string;
    cnpj: string;
    status: string;
    billingStatus: string;
    portalSlug: string;
    totalEmployees: number;
    remoteEmployees: number;
    onsiteEmployees: number;
    hybridEmployees: number;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    contractStartDate: string | null;
    contractEndDate: string | null;
    updatedAt: string | null;
  };
  campaigns: Campaign[];
  selectedCampaign: Campaign | null;
  dashboard: {
    totals: { responses: number; topics: number; activeSectors: number };
    riskDistribution: { low: number; medium: number; high: number; critical: number };
    sectors: Sector[];
    metrics?: {
      riskMatrix: RiskMatrixPoint[];
      global?: {
        gravityScoreScaleMax?: number;
        companyOccurrenceRiskWeight?: number | null;
      };
    };
    latestDrps: {
      reference_period: string;
      part1_probability_score: number;
      part1_probability_class: string;
    } | null;
  } | null;
  reports: Report[];
  assignedPrograms: AssignedProgram[];
  masterCalendar: {
    events: MasterCalendarEvent[];
    calendarEventsUnavailable: boolean;
  };
};

type CompanyRiskProfileSummary = {
  progress: {
    status: "not_started" | "in_progress" | "completed";
    completionRatio: number;
    completedAt: string | null;
    lastSavedAt: string | null;
  };
  latestReport: {
    id: string;
    overallScore: number;
    overallClass: "baixa" | "media" | "alta";
    createdAt: string;
  } | null;
  progressUnavailable?: boolean;
};

function fmt(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function fmtDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

function fmtTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function csvEscape(value: string | number | null): string {
  if (value === null) return "";
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fallback below.
    }
  }

  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
}

function campaignCollectionStatus(status: Campaign["status"]) {
  if (status === "live") return "Questionario aberto (coletando respostas)";
  if (status === "closed") return "Questionario fechado";
  if (status === "draft") return "Questionario em rascunho";
  return "Questionario arquivado";
}

function riskProfileStatusLabel(status: "not_started" | "in_progress" | "completed") {
  if (status === "completed") return "Concluido";
  if (status === "in_progress") return "Em andamento";
  return "Nao iniciado";
}

function riskProfileClassLabel(value: "baixa" | "media" | "alta") {
  if (value === "baixa") return "Baixa";
  if (value === "media") return "Media";
  return "Alta";
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
  if (normalized.length <= 18) return normalized;
  return `${normalized.slice(0, 16)}...`;
}

function riskMatrixCategoryStyles(category: "low" | "moderate" | "high" | "critical" | null) {
  if (category === "low") {
    return { fill: "#84dfa780", stroke: "#6bc590", text: "#2f566c" };
  }
  if (category === "moderate") {
    return { fill: "#edd06780", stroke: "#d3b751", text: "#2f566c" };
  }
  if (category === "high") {
    return { fill: "#ecac6380", stroke: "#d1924f", text: "#2f566c" };
  }
  return { fill: "#ee9ca080", stroke: "#d68488", text: "#2f566c" };
}

function topicCode(topicId: number) {
  return `T${String(topicId).padStart(2, "0")}`;
}

function formatMetricRange(value: number) {
  return value.toFixed(2);
}

function durationMinutesFromRange(
  startsAt: string,
  endsAt: string,
  fallbackMinutes = 60,
) {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return fallbackMinutes;
  const diff = Math.round((end - start) / 60000);
  if (!Number.isFinite(diff) || diff <= 0) return fallbackMinutes;
  return diff;
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

function dayKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function extractCampaignIdFromCalendarEvent(event: { id: string; eventType: MasterCalendarEvent["eventType"] }) {
  if (event.eventType !== "drps_start" && event.eventType !== "drps_close") return null;
  if (event.id.startsWith("drps-start-")) return event.id.slice("drps-start-".length);
  if (event.id.startsWith("drps-close-")) return event.id.slice("drps-close-".length);
  return null;
}

const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"] as const;
const MAX_CALENDAR_EVENTS_PER_DAY = 5;

export function ClientWorkspace({ clientSlug }: { clientSlug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [linksPayload, setLinksPayload] = useState<SectorPayload | null>(null);
  const [isLinksModalOpen, setIsLinksModalOpen] = useState(false);
  const [isLoadingLinksFor, setIsLoadingLinksFor] = useState<string | null>(null);
  const [copiedSectorId, setCopiedSectorId] = useState<string | null>(null);
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const [expandedCampaignSectorsById, setExpandedCampaignSectorsById] = useState<
    Record<string, SectorLink[]>
  >({});
  const [loadingExpandedCampaignId, setLoadingExpandedCampaignId] = useState<string | null>(null);
  const [openCampaignActionsFor, setOpenCampaignActionsFor] = useState<string | null>(null);
  const [openCampaignSectorActionsFor, setOpenCampaignSectorActionsFor] = useState<string | null>(null);
  const [drpsActionError, setDrpsActionError] = useState("");
  const [drpsActionNotice, setDrpsActionNotice] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [downloadingReportId, setDownloadingReportId] = useState<string | null>(null);
  const [reportFeedback, setReportFeedback] = useState("");
  const [selectedCalendarEventId, setSelectedCalendarEventId] = useState<string | null>(null);
  const [appliedCalendarDeepLinkId, setAppliedCalendarDeepLinkId] = useState<string | null>(null);
  const [riskProfileSummary, setRiskProfileSummary] = useState<CompanyRiskProfileSummary | null>(null);
  const [isLoadingRiskProfile, setIsLoadingRiskProfile] = useState(true);
  const [riskProfileError, setRiskProfileError] = useState("");
  const [isolatedRadarSector, setIsolatedRadarSector] = useState<string | null>(null);
  const [activeChartInfo, setActiveChartInfo] = useState<"matrix" | "radar" | null>(null);

  const loadData = useCallback(
    async (campaignId?: string) => {
      setIsLoading(true);
      setError("");
      try {
        const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
        const response = await fetch(`/api/client/portal/${clientSlug}${query}`, { cache: "no-store" });
        if (!response.ok) {
          const e = (await response.json()) as { error?: string };
          throw new Error(e.error ?? "Nao foi possivel carregar o portal do cliente.");
        }
        const data = (await response.json()) as Payload;
        setPayload(data);
        setSelectedCampaignId(data.selectedCampaign?.id ?? "");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao carregar portal.");
        setPayload(null);
      } finally {
        setIsLoading(false);
      }
    },
    [clientSlug],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadRiskProfileSummary = useCallback(async () => {
    setIsLoadingRiskProfile(true);
    setRiskProfileError("");
    try {
      const response = await fetch(`/api/client/portal/${encodeURIComponent(clientSlug)}/company-risk-profile`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as CompanyRiskProfileSummary & { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Nao foi possivel carregar o status do questionario da empresa.");
      }
      setRiskProfileSummary({
        progress: body.progress,
        latestReport: body.latestReport ?? null,
        progressUnavailable: Boolean(body.progressUnavailable),
      });
    } catch (loadError) {
      setRiskProfileSummary(null);
      setRiskProfileError(
        loadError instanceof Error ? loadError.message : "Falha ao carregar status do questionario da empresa.",
      );
    } finally {
      setIsLoadingRiskProfile(false);
    }
  }, [clientSlug]);

  useEffect(() => {
    void loadRiskProfileSummary();
  }, [loadRiskProfileSummary]);

  const selectedCampaign = useMemo(
    () => payload?.campaigns.find((item) => item.id === selectedCampaignId) ?? payload?.selectedCampaign ?? null,
    [payload, selectedCampaignId],
  );
  const openCampaigns = useMemo(
    () => (payload?.campaigns ?? []).filter((campaign) => campaign.status === "live"),
    [payload],
  );

  const resultsCampaign = useMemo(() => {
    if (!payload) return null;
    if (selectedCampaign && (selectedCampaign.status === "live" || selectedCampaign.status === "closed")) {
      return selectedCampaign;
    }
    return (
      payload.campaigns.find((campaign) => campaign.status === "live") ??
      payload.campaigns.find((campaign) => campaign.status === "closed") ??
      null
    );
  }, [payload, selectedCampaign]);

  const resultsHref = resultsCampaign ? `/client/${clientSlug}/diagnostic/${resultsCampaign.id}` : null;
  const companyRiskProfileHref = `/client/${clientSlug}/company-risk-profile`;
  const companyRiskProfilePending = riskProfileSummary?.progress.status !== "completed";
  const linksActionCampaign =
    selectedCampaign?.status === "live" ? selectedCampaign : openCampaigns[0] ?? null;
  const gravityScoreScaleMax = Math.max(1, payload?.dashboard?.metrics?.global?.gravityScoreScaleMax ?? 5);
  const companyOccurrenceRiskWeight = payload?.dashboard?.metrics?.global?.companyOccurrenceRiskWeight ?? null;
  const lowMax = gravityScoreScaleMax * 0.25;
  const moderateMax = gravityScoreScaleMax * 0.5;
  const highMax = gravityScoreScaleMax * 0.75;
  const riskMatrixPoints = useMemo(
    () =>
      (payload?.dashboard?.metrics?.riskMatrix ?? [])
        .filter((point) => point.probability !== null && point.riskScore !== null && Number.isFinite(point.severity))
        .slice()
        .sort((left, right) => (right.riskScore ?? 0) - (left.riskScore ?? 0)),
    [payload?.dashboard?.metrics?.riskMatrix],
  );
  const riskMatrixModel = useMemo(() => {
    if (riskMatrixPoints.length === 0) return null;

    const width = 920;
    const height = 540;
    const padding = { left: 70, right: 26, top: 18, bottom: 58 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const xTicks = [0.01, 0.25, 0.5, 0.75, 1];
    const severities = riskMatrixPoints.map((point) => point.severity);
    const severityMinRaw = Math.min(...severities);
    const severityMaxRaw = Math.max(...severities);
    const severityPad = Math.max(0.14, (severityMaxRaw - severityMinRaw) * 0.2);
    let severityMin = Math.max(1, severityMinRaw - severityPad);
    let severityMax = Math.min(5, severityMaxRaw + severityPad);
    if (severityMax - severityMin < 0.5) {
      severityMin = Math.max(1, severityMinRaw - 0.25);
      severityMax = Math.min(5, severityMaxRaw + 0.25);
    }
    const yTicks = Array.from({ length: 5 }, (_, index) => {
      return severityMin + ((severityMax - severityMin) * index) / 4;
    });

    const xScale = (value: number) => {
      const clamped = Math.max(0.01, Math.min(1, value));
      return padding.left + ((clamped - 0.01) / 0.99) * plotWidth;
    };
    const yScale = (value: number) => {
      const clamped = Math.max(severityMin, Math.min(severityMax, value));
      const ratio = (clamped - severityMin) / Math.max(severityMax - severityMin, Number.EPSILON);
      return padding.top + (1 - ratio) * plotHeight;
    };

    const affectedValues = riskMatrixPoints.map((point) => point.affectedEmployees);
    const maxAffected = Math.max(...affectedValues, 1);
    const minAffected = Math.min(...affectedValues, maxAffected);
    const minRadius = 5;
    const maxRadius = 24;
    const sqrtMinAffected = Math.sqrt(minAffected);
    const sqrtMaxAffected = Math.sqrt(maxAffected);
    const sqrtAffectedSpan = Math.max(sqrtMaxAffected - sqrtMinAffected, Number.EPSILON);
    const points = riskMatrixPoints.map((point, index) => {
      const probability = point.probability ?? 0;
      const normalizedAffected =
        maxAffected === minAffected
          ? 1
          : (Math.sqrt(Math.max(point.affectedEmployees, 0)) - sqrtMinAffected) / sqrtAffectedSpan;
      const radius = minRadius + normalizedAffected * (maxRadius - minRadius);
      const x = xScale(probability);
      const y = yScale(point.severity);
      const horizontalDirection = x > padding.left + plotWidth * 0.6 ? -1 : 1;
      const verticalNudge = (index % 2 === 0 ? -1 : 1) * Math.min(24, 12 + radius * 0.4);
      const labelY = Math.min(
        height - padding.bottom - 6,
        Math.max(padding.top + 16, y + verticalNudge),
      );
      const label = shortRiskName(point.riskFactor, point.topicId);
      const labelFontPx = 17;
      const labelPaddingX = 6;
      const labelBoxHeight = 20;
      const estimatedLabelWidth = Math.max(56, Math.min(220, label.length * (labelFontPx * 0.6)));
      const labelAnchor = horizontalDirection === 1 ? ("start" as const) : ("end" as const);
      const baseLabelX = x + horizontalDirection * (radius + 14);
      const labelX =
        labelAnchor === "start"
          ? Math.min(width - padding.right - estimatedLabelWidth - 4, Math.max(padding.left + 4, baseLabelX))
          : Math.max(padding.left + estimatedLabelWidth + 4, Math.min(width - padding.right - 4, baseLabelX));
      const labelBoxX =
        horizontalDirection === 1
          ? labelX - labelPaddingX
          : labelX - estimatedLabelWidth - labelPaddingX;
      const labelBoxY = labelY - labelBoxHeight / 2;
      return {
        ...point,
        x,
        y,
        radius,
        label,
        labelX,
        labelY,
        labelAnchor,
        labelBoxX,
        labelBoxY,
        labelBoxWidth: estimatedLabelWidth + labelPaddingX * 2,
        labelBoxHeight,
        styles: riskMatrixCategoryStyles(point.category),
      };
    });

    return {
      width,
      height,
      padding,
      severityMin,
      severityMax,
      xTicks,
      yTicks,
      points,
    };
  }, [riskMatrixPoints]);
  const sectorRadarModel = useMemo(() => {
    const sectors = (payload?.dashboard?.sectors ?? [])
      .filter((sector) => !sector.suppressed && (sector.riskFactors?.length ?? 0) > 0)
      .slice()
      .sort((left, right) => (right.sectorRiskIndex ?? 0) - (left.sectorRiskIndex ?? 0))
      .slice(0, 6);
    if (sectors.length === 0) return null;

    const topicMap = new Map<number, { topicId: number; label: string }>();
    for (const sector of sectors) {
      for (const factor of sector.riskFactors ?? []) {
        if (!topicMap.has(factor.topicId)) {
          topicMap.set(factor.topicId, {
            topicId: factor.topicId,
            label: shortRiskName(factor.riskFactor, factor.topicId),
          });
        }
      }
    }

    const axes = Array.from(topicMap.values()).sort((left, right) => left.topicId - right.topicId);
    if (axes.length === 0) return null;

    const size = 500;
    const center = size / 2;
    const radius = 172;
    const labelRadius = radius + 32;
    const levels = [0.2, 0.4, 0.6, 0.8, 1];
    const palette = [
      { line: "#2f5be8", fill: "#2f5be824" },
      { line: "#2f9f9b", fill: "#2f9f9b24" },
      { line: "#cf7a2c", fill: "#cf7a2c24" },
      { line: "#db4064", fill: "#db406424" },
      { line: "#8b5cf6", fill: "#8b5cf624" },
      { line: "#48a6df", fill: "#48a6df24" },
    ];

    const axisVertices = axes.map((axis, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / axes.length;
      const axisX = center + Math.cos(angle) * radius;
      const axisY = center + Math.sin(angle) * radius;
      const baseLabelX = center + Math.cos(angle) * labelRadius;
      const baseLabelY = center + Math.sin(angle) * labelRadius;
      const cos = Math.cos(angle);
      const labelAnchor: "start" | "middle" | "end" = cos > 0.28 ? "start" : cos < -0.28 ? "end" : "middle";
      const estimatedLabelWidth = Math.max(58, Math.min(142, axis.label.length * 8.2));
      const labelInset = 18;
      const minLabelX =
        labelAnchor === "start"
          ? labelInset
          : labelAnchor === "end"
            ? labelInset + estimatedLabelWidth
            : labelInset + estimatedLabelWidth / 2;
      const maxLabelX =
        labelAnchor === "start"
          ? size - labelInset - estimatedLabelWidth
          : labelAnchor === "end"
            ? size - labelInset
            : size - labelInset - estimatedLabelWidth / 2;
      return {
        ...axis,
        angle,
        axisX,
        axisY,
        labelX: Math.min(maxLabelX, Math.max(minLabelX, baseLabelX)),
        labelY: Math.min(size - 20, Math.max(20, baseLabelY)),
        labelAnchor,
      };
    });

    const rings = levels.map((level) =>
      axisVertices
        .map((axis) => `${center + (axis.axisX - center) * level},${center + (axis.axisY - center) * level}`)
        .join(" "),
    );

    const axisLines = axisVertices.map((axis) => ({
      topicId: axis.topicId,
      x1: center,
      y1: center,
      x2: axis.axisX,
      y2: axis.axisY,
    }));

    const sectorPolygons = sectors.map((sector, index) => {
      const colors = palette[index % palette.length];
      const byTopicId = new Map((sector.riskFactors ?? []).map((factor) => [factor.topicId, factor]));
      const vertices = axisVertices.map((axis) => {
        const meanExposure = byTopicId.get(axis.topicId)?.meanExposure ?? 0;
        const normalized = Math.max(0, Math.min(1, meanExposure / 5));
        return {
          topicId: axis.topicId,
          x: center + Math.cos(axis.angle) * radius * normalized,
          y: center + Math.sin(axis.angle) * radius * normalized,
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
      axes: axisVertices,
      rings,
      axisLines,
      sectorPolygons,
    };
  }, [payload?.dashboard?.sectors]);
  const effectiveIsolatedRadarSector = useMemo(() => {
    if (!isolatedRadarSector || !sectorRadarModel) return null;
    return sectorRadarModel.sectorPolygons.some((series) => series.sector === isolatedRadarSector)
      ? isolatedRadarSector
      : null;
  }, [isolatedRadarSector, sectorRadarModel]);
  const radarVisibleSeries = useMemo(() => {
    if (!sectorRadarModel) return [];
    if (!effectiveIsolatedRadarSector) return sectorRadarModel.sectorPolygons;
    return sectorRadarModel.sectorPolygons.filter((series) => series.sector === effectiveIsolatedRadarSector);
  }, [effectiveIsolatedRadarSector, sectorRadarModel]);

  useEffect(() => {
    if (!payload || !resultsCampaign) return;
    if (payload.selectedCampaign?.id === resultsCampaign.id) return;
    setSelectedCampaignId(resultsCampaign.id);
    void loadData(resultsCampaign.id);
  }, [loadData, payload, resultsCampaign]);

  useEffect(() => {
    if (!expandedCampaignId) return;
    if ((payload?.campaigns ?? []).some((campaign) => campaign.id === expandedCampaignId)) return;
    setExpandedCampaignId(null);
  }, [expandedCampaignId, payload?.campaigns]);

  async function fetchCampaignSectorPayload(campaignId: string): Promise<SectorPayload> {
    const response = await fetch(`/api/client/portal/${clientSlug}/campaigns/${campaignId}/sectors`, {
      cache: "no-store",
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "Falha ao carregar links do questionario.");
    }
    return (await response.json()) as SectorPayload;
  }

  async function loadQuestionnaireLinks(campaign: Campaign) {
    setIsLoadingLinksFor(campaign.id);
    setDrpsActionError("");
    setDrpsActionNotice("");
    setLinksPayload(null);
    setIsLinksModalOpen(false);
    try {
      const payload = await fetchCampaignSectorPayload(campaign.id);
      setLinksPayload(payload);
      setCopiedSectorId(null);
      setIsLinksModalOpen(true);
    } catch {
      setDrpsActionError("Falha ao carregar links do questionario.");
    } finally {
      setIsLoadingLinksFor(null);
    }
  }

  async function toggleCampaignPackage(campaignId: string) {
    if (expandedCampaignId === campaignId) {
      setExpandedCampaignId(null);
      return;
    }

    setExpandedCampaignId(campaignId);
    if (expandedCampaignSectorsById[campaignId]) return;

    setLoadingExpandedCampaignId(campaignId);
    try {
      const payload = await fetchCampaignSectorPayload(campaignId);
      setExpandedCampaignSectorsById((previous) => ({
        ...previous,
        [campaignId]: payload.sectors ?? [],
      }));
    } catch {
      setDrpsActionError("Falha ao carregar setores do pacote DRPS.");
    } finally {
      setLoadingExpandedCampaignId((previous) => (previous === campaignId ? null : previous));
    }
  }

  function openCampaignResults(campaignId: string, sectorName?: string) {
    const search = sectorName ? `?sector=${encodeURIComponent(sectorName)}` : "";
    router.push(`/client/${clientSlug}/diagnostic/${campaignId}${search}`);
  }

  function openSingleSectorLinkModal(campaign: Campaign, sector: SectorLink) {
    setDrpsActionError("");
    setDrpsActionNotice("");
    setCopiedSectorId(null);
    setLinksPayload({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        slug: campaign.public_slug,
      },
      sectors: [sector],
    });
    setIsLinksModalOpen(true);
  }

  async function copySectorLink(sector: SectorLink) {
    if (!sector.isActive) {
      return;
    }
    setDrpsActionNotice("");
    const link = sector.accessLink?.trim();
    if (!link) {
      setDrpsActionError("Link do setor indisponivel.");
      return;
    }
    const copied = await copyTextToClipboard(link);
    if (!copied) {
      window.prompt("Copie o link do setor:", link);
    }
    setCopiedSectorId(sector.id);
    setDrpsActionError("");
    setDrpsActionNotice(`Link copiado para o setor ${sector.name}.`);
    window.setTimeout(() => setCopiedSectorId(null), 1200);
  }

  async function copyAllLinks() {
    if (!linksPayload) return;
    setDrpsActionNotice("");
    const lines = linksPayload.sectors
      .filter((sector) => sector.isActive)
      .map((sector) => `${sector.name}: ${sector.accessLink}`);
    if (lines.length === 0) {
      setDrpsActionError("Nenhum setor ativo para copiar.");
      return;
    }
    const copied = await copyTextToClipboard(lines.join("\n"));
    if (!copied) {
      window.prompt("Copie os links dos setores:", lines.join("\n"));
    }
    setDrpsActionError("");
    setDrpsActionNotice("Links dos setores copiados.");
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

  async function downloadReport(report: Report) {
    setDownloadingReportId(report.id);
    setReportFeedback("");
    try {
      const response = await fetch(
        `/api/client/portal/${clientSlug}/reports/${report.id}/download`,
        { method: "POST" },
      );
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

  const calendarEvents = useMemo(() => {
    const events = payload?.masterCalendar.events ?? [];
    const list: Array<{
      id: string;
      day: string;
      clientName: string | null;
      companyLabel: string;
      title: string;
      startsAt: string;
      endsAt: string;
      startsAtMs: number;
      timeLabel: string;
      details: {
        content: string | null;
        preparationRequired: string | null;
        eventLifecycle: "provisory" | "committed";
        proposalKind: "assignment" | "reschedule" | null;
        availabilityRequestId: string | null;
      };
      eventType: "drps_start" | "drps_close" | "continuous_meeting" | "blocked";
      sourceClientProgramId: string | null;
      type: "start" | "close" | "meeting" | "blocked";
      typeLabel: "Inicio DRPS" | "Fim DRPS" | "Reuniao continua" | "Bloqueio";
      lifecycleLabel: "Provisorio" | "Commitado" | null;
    }> = [];

    for (const event of events) {
      const date = new Date(event.startsAt);
      if (Number.isNaN(date.getTime())) continue;
      const type =
        event.eventType === "drps_start"
          ? "start"
          : event.eventType === "drps_close"
            ? "close"
            : event.eventType === "continuous_meeting"
              ? "meeting"
              : "blocked";
      const typeLabel =
        type === "start"
          ? "Inicio DRPS"
          : type === "close"
            ? "Fim DRPS"
            : type === "meeting"
              ? "Reuniao continua"
              : "Bloqueio";
      const lifecycleLabel =
        type === "meeting" || type === "blocked"
          ? event.details.eventLifecycle === "committed"
            ? "Commitado"
            : "Provisorio"
          : null;
      const startsAtLabel = fmtTime(event.startsAt);
      const endsAtDate = new Date(event.endsAt);
      const timeLabel = Number.isNaN(endsAtDate.getTime())
        ? startsAtLabel
        : `${startsAtLabel} - ${fmtTime(event.endsAt)}`;
      list.push({
        id: event.id,
        day: dayKey(date),
        clientName: event.clientName,
        companyLabel: event.clientName ?? payload?.client.companyName ?? "Empresa",
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        startsAtMs: date.getTime(),
        timeLabel,
        details: event.details,
        eventType: event.eventType,
        sourceClientProgramId: event.sourceClientProgramId,
        type,
        typeLabel,
        lifecycleLabel,
      });
    }

    list.sort((a, b) => a.startsAtMs - b.startsAtMs);
    return list;
  }, [payload]);

  const committedContinuousMeetings = useMemo(() => {
    return (payload?.masterCalendar.events ?? [])
      .filter(
        (event) =>
          event.eventType === "continuous_meeting" &&
          event.details.eventLifecycle === "committed" &&
          event.status !== "cancelled",
      )
      .slice()
      .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
  }, [payload?.masterCalendar.events]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, typeof calendarEvents>();
    for (const event of calendarEvents) map.set(event.day, [...(map.get(event.day) ?? []), event]);
    return map;
  }, [calendarEvents]);

  const days = useMemo(() => {
    const start = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const gridStart = new Date(start);
    gridStart.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, idx) => {
      const value = new Date(gridStart);
      value.setDate(gridStart.getDate() + idx);
      const key = dayKey(value);
      return { value, key, inMonth: value.getMonth() === calendarMonth.getMonth(), events: eventsByDay.get(key) ?? [] };
    });
  }, [calendarMonth, eventsByDay]);

  useEffect(() => {
    if (!selectedCalendarEventId) return;
    if (calendarEvents.some((event) => event.id === selectedCalendarEventId)) return;
    setSelectedCalendarEventId(null);
  }, [calendarEvents, selectedCalendarEventId]);

  const calendarEventIdParam = searchParams.get("calendarEventId");
  useEffect(() => {
    if (!calendarEventIdParam) {
      setAppliedCalendarDeepLinkId(null);
      return;
    }
    if (appliedCalendarDeepLinkId === calendarEventIdParam) return;
    const targetEvent = calendarEvents.find((event) => event.id === calendarEventIdParam) ?? null;
    if (!targetEvent) return;
    const startsAt = new Date(targetEvent.startsAt);
    if (!Number.isNaN(startsAt.getTime())) {
      setCalendarMonth(new Date(startsAt.getFullYear(), startsAt.getMonth(), 1));
    }
    setSelectedCalendarEventId(targetEvent.id);
    setAppliedCalendarDeepLinkId(calendarEventIdParam);
  }, [appliedCalendarDeepLinkId, calendarEventIdParam, calendarEvents]);

  const selectedCalendarEvent = useMemo(
    () =>
      selectedCalendarEventId
        ? calendarEvents.find((event) => event.id === selectedCalendarEventId) ?? null
        : null,
    [calendarEvents, selectedCalendarEventId],
  );

  const selectedCalendarEventTypeLabel = useMemo(() => {
    if (!selectedCalendarEvent) return "";
    if (selectedCalendarEvent.eventType === "drps_start") return "Inicio DRPS";
    if (selectedCalendarEvent.eventType === "drps_close") return "Fim DRPS";
    if (selectedCalendarEvent.eventType === "continuous_meeting") return "Reuniao continua";
    return "Bloqueio";
  }, [selectedCalendarEvent]);

  const selectedCalendarEventLifecycleLabel = useMemo(() => {
    if (!selectedCalendarEvent) return "";
    const lifecycle =
      selectedCalendarEvent.details.eventLifecycle === "provisory"
        ? "Provisorio"
        : "Commitado";
    const proposal =
      selectedCalendarEvent.details.proposalKind === "reschedule"
        ? "Reagendamento"
        : selectedCalendarEvent.details.proposalKind === "assignment"
          ? "Atribuicao"
          : null;
    return proposal ? `${lifecycle} (${proposal})` : lifecycle;
  }, [selectedCalendarEvent]);

  const selectedCalendarEventContent = useMemo(() => {
    if (!selectedCalendarEvent) return "";
    if (selectedCalendarEvent.details.content) return selectedCalendarEvent.details.content;
    if (selectedCalendarEvent.eventType === "drps_start") {
      return "Inicio da janela do diagnostico DRPS para esta campanha.";
    }
    if (selectedCalendarEvent.eventType === "drps_close") {
      return "Fechamento da janela do diagnostico DRPS para consolidacao de dados.";
    }
    if (selectedCalendarEvent.eventType === "continuous_meeting") {
      return "Reuniao de acompanhamento do processo continuo.";
    }
    return "Horario reservado na agenda do gestor.";
  }, [selectedCalendarEvent]);

  const selectedCalendarEventPreparation = useMemo(() => {
    if (!selectedCalendarEvent) return "";
    if (selectedCalendarEvent.details.preparationRequired) {
      return selectedCalendarEvent.details.preparationRequired;
    }
    if (selectedCalendarEvent.eventType === "continuous_meeting") {
      return "Revisar indicadores recentes e levar duvidas do ciclo atual.";
    }
    if (selectedCalendarEvent.eventType === "drps_start" || selectedCalendarEvent.eventType === "drps_close") {
      return "Alinhar responsaveis internos e prazos do diagnostico.";
    }
    return "Nenhuma preparacao obrigatoria registrada.";
  }, [selectedCalendarEvent]);

  const calendarEventLinkFor = useCallback(
    (event: {
      id: string;
      eventType: "drps_start" | "drps_close" | "continuous_meeting" | "blocked";
      sourceClientProgramId: string | null;
    }) => {
      if (!payload) return null;
      if (event.eventType === "drps_start" || event.eventType === "drps_close") {
        const campaignId = extractCampaignIdFromCalendarEvent(event);
        if (!campaignId) return null;
        return {
          href: `/client/${clientSlug}/diagnostic/${campaignId}`,
          label: "Abrir resultado DRPS",
        };
      }
      if (event.eventType === "continuous_meeting" && event.sourceClientProgramId) {
        const assignment =
          payload.assignedPrograms.find((program) => program.id === event.sourceClientProgramId) ?? null;
        if (!assignment) return null;
        return {
          href: `/client/${clientSlug}/programs/${assignment.programId}`,
          label: "Abrir detalhes do processo",
        };
      }
      return null;
    },
    [clientSlug, payload],
  );

  const selectedCalendarEventLink = useMemo(() => {
    if (!selectedCalendarEvent) return null;
    return calendarEventLinkFor(selectedCalendarEvent);
  }, [calendarEventLinkFor, selectedCalendarEvent]);

  const selectedCalendarEventRecordHref = useMemo(
    () =>
      selectedCalendarEvent
        ? `/client/${encodeURIComponent(clientSlug)}/history/events/${encodeURIComponent(selectedCalendarEvent.id)}`
        : null,
    [clientSlug, selectedCalendarEvent],
  );

  if (isLoading) {
    return <p className="text-sm text-[#3d5a69]">Carregando portal...</p>;
  }
  if (error || !payload) {
    return <p className="text-sm text-red-600">{error || "Portal indisponivel."}</p>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[#0f6077]">Portal do cliente</p>
            <h2 className="mt-1 text-2xl font-semibold text-[#123447]">{payload.client.companyName}</h2>
            <p className="mt-2 text-sm text-[#3d5a69]">
              Status: <strong>{payload.client.status}</strong> | Financeiro:{" "}
              <strong>{payload.client.billingStatus}</strong> | CNPJ: {payload.client.cnpj}
            </p>
          </div>
          <article className="rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-[#4f6977]">Dados da empresa</p>
            <p className="mt-1 text-sm text-[#123447]">
              Colaboradores: {payload.client.totalEmployees} (R {payload.client.remoteEmployees} / P{" "}
              {payload.client.onsiteEmployees} / H {payload.client.hybridEmployees})
            </p>
            <p className="mt-1 text-sm text-[#123447]">Setores: {payload.dashboard?.totals.activeSectors ?? 0}</p>
          </article>
        </div>
      </section>

      {isLoadingRiskProfile ? (
        <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
          <p className="text-sm text-[#4f6977]">Carregando status do questionario de perfil de risco...</p>
        </section>
      ) : riskProfileError ? (
        <section className="rounded-2xl border border-[#e8d6ad] bg-[#fff7e8] p-5 shadow-sm">
          <p className="text-sm text-[#8a5b2d]">{riskProfileError}</p>
          <button
            type="button"
            onClick={() => void loadRiskProfileSummary()}
            className="mt-3 rounded-full border border-[#d2b983] px-3 py-1 text-xs font-semibold text-[#7a4b00]"
          >
            Tentar novamente
          </button>
        </section>
      ) : riskProfileSummary?.progressUnavailable ? (
        <section className="rounded-2xl border border-[#e8d6ad] bg-[#fff7e8] p-5 shadow-sm">
          <p className="text-sm text-[#8a5b2d]">
            O questionario de perfil de risco ainda nao esta disponivel neste ambiente.
          </p>
        </section>
      ) : companyRiskProfilePending ? (
        <section className="rounded-2xl border border-[#f0d2b2] bg-[#fff6ee] p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[#9a5a1d]">Acao pendente</p>
              <h3 className="mt-1 text-lg font-semibold text-[#7a3f08]">
                Complete o questionario de perfil de risco da empresa
              </h3>
              <p className="mt-1 text-sm text-[#8a5b2d]">
                Status:{" "}
                <strong>{riskProfileStatusLabel(riskProfileSummary?.progress.status ?? "not_started")}</strong>
                {" "} | Progresso:{" "}
                <strong>
                  {Math.round((riskProfileSummary?.progress.completionRatio ?? 0) * 100)}%
                </strong>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={companyRiskProfileHref}
                className="rounded-full border border-[#c79055] bg-[#b6651c] px-4 py-2 text-xs font-semibold text-white"
              >
                Abrir questionario
              </Link>
              <button
                type="button"
                onClick={() => void loadRiskProfileSummary()}
                className="rounded-full border border-[#d2b983] px-3 py-1 text-xs font-semibold text-[#7a4b00]"
              >
                Atualizar status
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-[#cfe2ec] bg-[#f4f9fc] p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[#4f6977]">Questionario da empresa</p>
              <h3 className="mt-1 text-lg font-semibold text-[#123447]">Perfil de risco concluido</h3>
              <p className="mt-1 text-sm text-[#35515f]">
                Concluido em {fmt(riskProfileSummary?.progress.completedAt ?? null)}
              </p>
            </div>
            {riskProfileSummary?.latestReport ? (
              <p className="text-sm text-[#123447]">
                Score {riskProfileSummary.latestReport.overallScore.toFixed(2)} (
                {riskProfileClassLabel(riskProfileSummary.latestReport.overallClass)})
              </p>
            ) : null}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-[#123447]">Resultados atuais</h3>
          {resultsHref ? (
            <Link
              href={resultsHref}
              className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
            >
              Ver resultados completos
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="rounded-full border border-[#d6dde2] px-3 py-1 text-xs font-semibold text-[#95a4ae] disabled:cursor-not-allowed"
            >
              Ver resultados completos
            </button>
          )}
        </div>
        {resultsCampaign ? (
          <article className="mt-3 rounded-xl border border-[#d8e4ee] p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-[#4f6977]">
              Questionario DRPS ativo/mais recente fechado
            </p>
            <p className="mt-1 text-sm font-semibold text-[#133748]">{resultsCampaign.name}</p>
            <p className="mt-1 text-xs text-[#4f6977]">{campaignCollectionStatus(resultsCampaign.status)}</p>
            {payload.dashboard?.latestDrps ? (
              <p className="mt-1 text-xs text-[#4f6977]">
                Periodo: {payload.dashboard.latestDrps.reference_period} | Probabilidade:{" "}
                {payload.dashboard.latestDrps.part1_probability_score.toFixed(2)} (
                {payload.dashboard.latestDrps.part1_probability_class})
              </p>
            ) : null}
          </article>
        ) : (
          <p className="mt-3 text-sm text-[#5a7383]">Sem questionario DRPS ativo ou fechado.</p>
        )}

        {payload.dashboard ? (
          <>
            <div className="mt-3 grid gap-4 md:grid-cols-4">
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-4">
              <p className="text-xs text-[#4f6977]">Respostas</p>
              {resultsHref ? (
                <Link
                  href={resultsHref}
                  className="mt-1 inline-block text-2xl font-semibold text-[#133748] hover:underline"
                >
                  {payload.dashboard.totals.responses}
                </Link>
              ) : (
                <p className="mt-1 text-2xl font-semibold text-[#133748]">{payload.dashboard.totals.responses}</p>
              )}
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-4">
              <p className="text-xs text-[#4f6977]">Topicos</p>
              {resultsHref ? (
                <Link
                  href={resultsHref}
                  className="mt-1 inline-block text-2xl font-semibold text-[#133748] hover:underline"
                >
                  {payload.dashboard.totals.topics}
                </Link>
              ) : (
                <p className="mt-1 text-2xl font-semibold text-[#133748]">{payload.dashboard.totals.topics}</p>
              )}
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-4">
              <p className="text-xs text-[#4f6977]">Setores ativos</p>
              {resultsHref ? (
                <Link
                  href={resultsHref}
                  className="mt-1 inline-block text-2xl font-semibold text-[#133748] hover:underline"
                >
                  {payload.dashboard.totals.activeSectors}
                </Link>
              ) : (
                <p className="mt-1 text-2xl font-semibold text-[#133748]">{payload.dashboard.totals.activeSectors}</p>
              )}
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-4">
              <p className="text-xs text-[#4f6977]">Risco alto+critico</p>
              {resultsHref ? (
                <Link
                  href={resultsHref}
                  className="mt-1 inline-block text-2xl font-semibold text-[#133748] hover:underline"
                >
                  {payload.dashboard.riskDistribution.high + payload.dashboard.riskDistribution.critical}
                </Link>
              ) : (
                <p className="mt-1 text-2xl font-semibold text-[#133748]">
                  {payload.dashboard.riskDistribution.high + payload.dashboard.riskDistribution.critical}
                </p>
              )}
            </article>
          </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <article className="flex h-full flex-col rounded-[26px] border border-[#dfdfdf] bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-lg font-semibold text-[#141d24]">Risk Matrix</h4>
                  <button
                    type="button"
                    aria-label="Risk matrix info"
                    onClick={() => setActiveChartInfo("matrix")}
                    className="rounded-full border border-[#b8cfdb] px-2 py-0.5 text-xs font-semibold text-[#17465b]"
                  >
                    i
                  </button>
                </div>

                <div className="mt-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#4b6472]">
                    <span className="font-semibold text-[#223845]">Gravidade (color):</span>
                  {[
                    { label: `low (<${formatMetricRange(lowMax)})`, category: "low" as const },
                    {
                      label: `moderate (${formatMetricRange(lowMax)}-${formatMetricRange(moderateMax)})`,
                      category: "moderate" as const,
                    },
                    {
                      label: `high (${formatMetricRange(moderateMax + 0.01)}-${formatMetricRange(highMax)})`,
                      category: "high" as const,
                    },
                    { label: `critical (>=${formatMetricRange(highMax + 0.01)})`, category: "critical" as const },
                  ].map((item) => {
                    const style = riskMatrixCategoryStyles(item.category);
                    return (
                      <span
                        key={`risk-chip-${item.category}`}
                        className="inline-flex items-center gap-1 rounded-full border border-[#d8e5ec] bg-white px-2 py-0.5"
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: style.fill, borderColor: style.stroke }}
                        />
                        {item.label}
                      </span>
                    );
                  })}
                  </div>
                </div>

                <div className="mt-3 flex-1 overflow-x-auto">
                  {riskMatrixModel ? (
                    <svg
                      data-nr-chart
                      viewBox={`0 0 ${riskMatrixModel.width} ${riskMatrixModel.height}`}
                      className="h-[420px] w-full min-w-[520px]"
                    >
                      {riskMatrixModel.xTicks.map((tick) => {
                        const x =
                          riskMatrixModel.padding.left +
                          ((tick - 0.01) / 0.99) *
                            (riskMatrixModel.width - riskMatrixModel.padding.left - riskMatrixModel.padding.right);
                        return (
                          <line
                            key={`matrix-x-grid-${tick}`}
                            x1={x}
                            y1={riskMatrixModel.padding.top}
                            x2={x}
                            y2={riskMatrixModel.height - riskMatrixModel.padding.bottom}
                            stroke="#dce7ee"
                            strokeDasharray="4 6"
                          />
                        );
                      })}
                      {riskMatrixModel.yTicks.map((tick) => {
                        const y =
                          riskMatrixModel.padding.top +
                          (1 - (tick - riskMatrixModel.severityMin) / Math.max(riskMatrixModel.severityMax - riskMatrixModel.severityMin, Number.EPSILON)) *
                            (riskMatrixModel.height - riskMatrixModel.padding.top - riskMatrixModel.padding.bottom);
                        return (
                          <line
                            key={`matrix-y-grid-${tick.toFixed(4)}`}
                            x1={riskMatrixModel.padding.left}
                            y1={y}
                            x2={riskMatrixModel.width - riskMatrixModel.padding.right}
                            y2={y}
                            stroke="#dce7ee"
                            strokeDasharray="4 6"
                          />
                        );
                      })}
                      <line
                        x1={riskMatrixModel.padding.left}
                        y1={riskMatrixModel.height - riskMatrixModel.padding.bottom}
                        x2={riskMatrixModel.width - riskMatrixModel.padding.right}
                        y2={riskMatrixModel.height - riskMatrixModel.padding.bottom}
                        stroke="#64748b"
                        strokeWidth="1.2"
                      />
                      <line
                        x1={riskMatrixModel.padding.left}
                        y1={riskMatrixModel.padding.top}
                        x2={riskMatrixModel.padding.left}
                        y2={riskMatrixModel.height - riskMatrixModel.padding.bottom}
                        stroke="#64748b"
                        strokeWidth="1.2"
                      />

                      {riskMatrixModel.xTicks.map((tick) => {
                        const x =
                          riskMatrixModel.padding.left +
                          ((tick - 0.01) / 0.99) *
                            (riskMatrixModel.width - riskMatrixModel.padding.left - riskMatrixModel.padding.right);
                        return (
                          <text
                            key={`matrix-x-tick-${tick}`}
                            x={x}
                            y={riskMatrixModel.height - 20}
                            textAnchor="middle"
                            className="fill-[#475569] text-[13px]"
                          >
                            {tick.toFixed(2)}
                          </text>
                        );
                      })}
                      {riskMatrixModel.yTicks.map((tick) => {
                        const y =
                          riskMatrixModel.padding.top +
                          (1 - (tick - riskMatrixModel.severityMin) / Math.max(riskMatrixModel.severityMax - riskMatrixModel.severityMin, Number.EPSILON)) *
                            (riskMatrixModel.height - riskMatrixModel.padding.top - riskMatrixModel.padding.bottom);
                        return (
                          <text
                            key={`matrix-y-tick-${tick.toFixed(4)}`}
                            x={riskMatrixModel.padding.left - 12}
                            y={y + 6}
                            textAnchor="end"
                            className="fill-[#475569] text-[13px]"
                          >
                            {tick.toFixed(1)}
                          </text>
                        );
                      })}

                      <text
                        x={(riskMatrixModel.padding.left + riskMatrixModel.width - riskMatrixModel.padding.right) / 2}
                        y={riskMatrixModel.height - 2}
                        textAnchor="middle"
                        className="fill-[#334155] text-[15px] font-semibold"
                      >
                        Probability of occurrence
                      </text>
                      <text
                        x={14}
                        y={riskMatrixModel.height / 2}
                        transform={`rotate(-90 14 ${riskMatrixModel.height / 2})`}
                        textAnchor="middle"
                        className="fill-[#334155] text-[15px] font-semibold"
                      >
                        Severity (observed)
                      </text>
                      {riskMatrixModel.points.map((point) => (
                        <g key={`matrix-point-${point.topicId}`}>
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
                          <line
                            x1={point.x}
                            y1={point.y}
                            x2={point.labelX}
                            y2={point.labelY}
                            stroke="#64748b"
                            strokeWidth="0.7"
                          />
                          <text
                            x={point.labelX}
                            y={point.labelY}
                            textAnchor={point.labelAnchor}
                            className="fill-[#1f2937] text-[17px] font-semibold"
                          >
                            {point.label}
                          </text>
                          <title>
                            {`${topicCode(point.topicId)} ${point.label} | probability ${point.probability?.toFixed(2) ?? "-"} | severity ${point.severity.toFixed(2)} | affected ${point.affectedEmployees}`}
                          </title>
                        </g>
                      ))}
                    </svg>
                  ) : (
                    <p className="text-sm text-[#5b7482]">No matrix data available.</p>
                  )}
                </div>
              </article>

              <article className="flex h-full flex-col rounded-[26px] border border-[#dfdfdf] bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-lg font-semibold text-[#141d24]">Sector Radar Profile</h4>
                  <button
                    type="button"
                    aria-label="Sector radar info"
                    onClick={() => setActiveChartInfo("radar")}
                    className="rounded-full border border-[#b8cfdb] px-2 py-0.5 text-xs font-semibold text-[#17465b]"
                  >
                    i
                  </button>
                </div>
                <p className="mt-1 text-xs text-[#55707f]">
                  {sectorRadarModel
                    ? `${sectorRadarModel.sectorPolygons.length} sectors plotted (sorted by sector risk index)`
                    : "No sectors plotted"}
                </p>
                {sectorRadarModel ? (
                  <p className="mt-1 text-[11px] text-[#6b8290]">
                    {effectiveIsolatedRadarSector
                      ? `Isolated sector: ${effectiveIsolatedRadarSector} (click again in legend to reset)`
                      : "Click a legend item to isolate one sector on the radar."}
                  </p>
                ) : null}

                {sectorRadarModel ? (
                  <>
                    <div className="mt-3 flex-1 overflow-x-auto">
                      <svg
                        data-nr-chart
                        viewBox={`0 0 ${sectorRadarModel.size} ${sectorRadarModel.size}`}
                        className="mx-auto h-[440px] w-full min-w-[420px] max-w-[500px]"
                      >
                        {sectorRadarModel.rings.map((ring, index) => (
                          <polygon
                            key={`radar-ring-${index}`}
                            points={ring}
                            fill="none"
                            stroke="#dbe7ef"
                            strokeWidth={1}
                          />
                        ))}
                        {sectorRadarModel.axisLines.map((axis) => (
                          <line
                            key={`radar-axis-${axis.topicId}`}
                            x1={axis.x1}
                            y1={axis.y1}
                            x2={axis.x2}
                            y2={axis.y2}
                            stroke="#dbe7ef"
                            strokeWidth={1}
                          />
                        ))}
                        {radarVisibleSeries.map((series) => (
                          <g key={`radar-sector-${series.sector}`}>
                            <polygon
                              points={series.polygonPoints}
                              fill={series.fillColor}
                              stroke={series.lineColor}
                              strokeWidth={2}
                            />
                            {series.vertices.map((vertex) => (
                              <circle
                                key={`radar-vertex-${series.sector}-${vertex.topicId}`}
                                cx={vertex.x}
                                cy={vertex.y}
                                r={2.5}
                                fill={series.lineColor}
                              />
                            ))}
                          </g>
                        ))}
                        {sectorRadarModel.axes.map((axis) => (
                          <text
                            key={`radar-label-${axis.topicId}`}
                            x={axis.labelX}
                            y={axis.labelY}
                            textAnchor={axis.labelAnchor}
                            dominantBaseline="middle"
                            className="fill-[#334155] text-[15px] font-semibold"
                          >
                            {axis.label}
                          </text>
                        ))}
                      </svg>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[#4b6472]">
                      <span className="font-semibold text-[#223845]">Legend:</span>
                      {sectorRadarModel.sectorPolygons.map((series) => (
                        <button
                          type="button"
                          key={`radar-sector-legend-${series.sector}`}
                          onClick={() =>
                            setIsolatedRadarSector((previous) =>
                              previous === series.sector ? null : series.sector,
                            )
                          }
                          className={`inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-0.5 ${
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
                  </>
                ) : (
                  <p className="mt-3 text-sm text-[#5b7482]">No radar data available.</p>
                )}
              </article>
            </div>
          </>
        ) : null}
      </section>

      {activeChartInfo ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          onClick={() => setActiveChartInfo(null)}
        >
          <article
            className="w-full max-w-xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-lg font-semibold text-[#123447]">
                {activeChartInfo === "matrix" ? "Risk Matrix . Info" : "Sector Radar Profile . Info"}
              </h4>
              <button
                type="button"
                onClick={() => setActiveChartInfo(null)}
                className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447]"
              >
                Fechar
              </button>
            </div>

            {activeChartInfo === "matrix" ? (
              <div className="mt-3 space-y-2 text-sm text-[#355d72]">
                <p>x: probability | y: severity (observed from responses) | bubble: affected employees</p>
                <p>
                  gravity score = probability x company occurrence-risk weight (
                  {companyOccurrenceRiskWeight !== null ? companyOccurrenceRiskWeight.toFixed(2) : "n/a"})
                </p>
              </div>
            ) : (
              <div className="mt-3 space-y-2 text-sm text-[#355d72]">
                <p>Radar overlays sector profiles by topic, sorted by sector risk index.</p>
                <p>Click a legend item to isolate one sector on the radar.</p>
              </div>
            )}
          </article>
        </div>
      ) : null}

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-[#123447]">Diagnosticos DRPS</h3>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!resultsCampaign}
              onClick={() => {
                if (!resultsCampaign) return;
                router.push(`/client/${clientSlug}/diagnostic/${resultsCampaign.id}`);
              }}
              className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447] disabled:cursor-not-allowed disabled:border-[#d6dde2] disabled:text-[#95a4ae]"
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
        <p className="mt-2 text-xs text-[#4f6977]">
          {selectedCampaign
            ? `Questionario atual: ${campaignCollectionStatus(selectedCampaign.status)}`
            : "Sem questionario selecionado."}
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="nr-table min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Pacote</th>
                <th className="px-2 py-2 text-left">Diagnostico</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Inicio</th>
                <th className="px-2 py-2 text-left">Fechamento</th>
                <th className="px-2 py-2 text-left">Respostas</th>
                <th className="px-2 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {openCampaigns.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-xs text-[#5a7383]" colSpan={7}>
                    Sem questionarios abertos coletando respostas no momento.
                  </td>
                </tr>
              ) : (
                openCampaigns.map((campaign) => {
                  const isExpanded = expandedCampaignId === campaign.id;
                  const expandedSectors = expandedCampaignSectorsById[campaign.id] ?? [];
                  const responseTotal = expandedSectors.reduce(
                    (total, sector) => total + (sector.submissionCount ?? 0),
                    0,
                  );
                  return [
                    <tr key={`${campaign.id}-main`} className="border-b">
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => void toggleCampaignPackage(campaign.id)}
                          className="rounded-full border border-[#c9dce8] px-2 py-0.5 text-xs font-semibold text-[#123447]"
                          title="Abrir/fechar sub-questionarios por setor"
                        >
                          {isExpanded ? "-" : "+"}
                        </button>
                      </td>
                      <td className="px-2 py-2">
                        <Link
                          href={`/client/${clientSlug}/diagnostic/${campaign.id}`}
                          className="font-semibold text-[#123447] hover:text-[#0f5b73] hover:underline"
                        >
                          {campaign.name}
                        </Link>
                      </td>
                      <td className="px-2 py-2">{campaignCollectionStatus(campaign.status)}</td>
                      <td className="px-2 py-2">{fmt(campaign.starts_at)}</td>
                      <td className="px-2 py-2">{fmt(campaign.closes_at)}</td>
                      <td className="px-2 py-2">{responseTotal || campaign.responses || 0}</td>
                      <td className="px-2 py-2">
                        <div className="relative inline-flex">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenCampaignActionsFor((previous) =>
                                previous === campaign.id ? null : campaign.id,
                              )
                            }
                            className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447]"
                          >
                            ...
                          </button>
                          {openCampaignActionsFor === campaign.id ? (
                            <div className="absolute right-0 top-full z-20 mt-2 w-52 overflow-hidden rounded-xl border border-[#d8e4ee] bg-white shadow-lg">
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenCampaignActionsFor(null);
                                  openCampaignResults(campaign.id);
                                }}
                                className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#123447] hover:bg-[#f4f9fc]"
                              >
                                Ver resultados
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenCampaignActionsFor(null);
                                  void loadQuestionnaireLinks(campaign);
                                }}
                                className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#0f5b73] hover:bg-[#f4f9fc]"
                              >
                                Gerar links
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>,
                    isExpanded ? (
                      loadingExpandedCampaignId === campaign.id ? (
                        <tr key={`${campaign.id}-loading`} className="border-b bg-[#f8fbfd]">
                          <td colSpan={7} className="px-2 py-3 text-xs text-[#5a7383]">
                            Carregando sub-questionarios...
                          </td>
                        </tr>
                      ) : expandedSectors.length === 0 ? (
                        <tr key={`${campaign.id}-empty`} className="border-b bg-[#f8fbfd]">
                          <td colSpan={7} className="px-2 py-3 text-xs text-[#5a7383]">
                            Nenhum sub-questionario por setor.
                          </td>
                        </tr>
                      ) : (
                        expandedSectors.map((sector) => {
                          const subItemKey = `${campaign.id}:${sector.id}`;
                          return (
                            <tr key={subItemKey} className="border-b bg-[#f8fbfd]">
                              <td className="px-2 py-2 text-xs text-[#5a7383]">sub</td>
                              <td className="px-2 py-2 text-xs font-semibold text-[#123447]">{sector.name}</td>
                              <td className="px-2 py-2 text-xs">
                                {sector.isActive ? "Sub-questionario ativo" : "Sub-questionario inativo"}
                              </td>
                              <td className="px-2 py-2 text-xs">{fmt(campaign.starts_at)}</td>
                              <td className="px-2 py-2 text-xs">{fmt(campaign.closes_at)}</td>
                              <td className="px-2 py-2 text-xs">{sector.submissionCount}</td>
                              <td className="px-2 py-2 text-xs">
                                <div className="relative inline-flex">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setOpenCampaignSectorActionsFor((previous) =>
                                        previous === subItemKey ? null : subItemKey,
                                      )
                                    }
                                    className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447]"
                                  >
                                    ...
                                  </button>
                                  {openCampaignSectorActionsFor === subItemKey ? (
                                    <div className="absolute right-0 top-full z-20 mt-2 w-52 overflow-hidden rounded-xl border border-[#d8e4ee] bg-white shadow-lg">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenCampaignSectorActionsFor(null);
                                          openCampaignResults(campaign.id, sector.name);
                                        }}
                                        className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#123447] hover:bg-[#f4f9fc]"
                                      >
                                        Ver resultados
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenCampaignSectorActionsFor(null);
                                          openSingleSectorLinkModal(campaign, sector);
                                        }}
                                        className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#0f5b73] hover:bg-[#f4f9fc]"
                                      >
                                        Gerar link (singulo)
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )
                    ) : null,
                  ];
                })
              )}
            </tbody>
          </table>
        </div>
        {drpsActionError ? <p className="mt-3 text-sm text-red-600">{drpsActionError}</p> : null}
        {drpsActionNotice ? <p className="mt-2 text-sm text-[#1f6b2f]">{drpsActionNotice}</p> : null}
      </section>

      <section className="h-auto max-h-none overflow-visible rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Processos continuos atribuidos</h3>
        <div className="mt-3 max-h-none overflow-x-auto overflow-y-visible">
          <table className="nr-table min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Programa</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Aplicado em</th>
                <th className="px-2 py-2 text-left">Frequencia</th>
                <th className="px-2 py-2 text-left">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {payload.assignedPrograms.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-xs text-[#5a7383]">
                    Nenhum processo continuo atribuido.
                  </td>
                </tr>
              ) : (
                payload.assignedPrograms.map((assignment) => (
                  <tr key={assignment.id} className="border-b">
                    <td className="px-2 py-2">{assignment.programTitle}</td>
                    <td className="px-2 py-2">{assignment.status}</td>
                    <td className="px-2 py-2">{fmt(assignment.deployedAt)}</td>
                    <td className="px-2 py-2">{assignment.scheduleFrequency}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          router.push(`/client/${clientSlug}/programs/${assignment.programId}`);
                        }}
                        className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447]"
                      >
                        Ver detalhes
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">
          Chronograma ({committedContinuousMeetings.length} eventos commitados)
        </h3>
        {committedContinuousMeetings.length === 0 ? (
          <p className="mt-3 text-xs text-[#5a7383]">Nenhuma reuniao commitada no momento.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-[#d8e4ee]">
            <table className="nr-table min-w-full text-xs">
              <thead className="bg-[#f3f8fb]">
                <tr className="border-b border-[#d8e4ee]">
                  <th className="px-3 py-2 text-left font-semibold text-[#244354]">Data/hora</th>
                  <th className="px-3 py-2 text-left font-semibold text-[#244354]">Duracao</th>
                  <th className="px-3 py-2 text-left font-semibold text-[#244354]">Status</th>
                  <th className="px-3 py-2 text-left font-semibold text-[#244354]">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {committedContinuousMeetings.map((event) => {
                  const status = chronogramStatusBadge(event.status);
                  return (
                    <tr key={event.id} className="border-b border-[#e2edf3] bg-[#ebf6fd]">
                      <td className="px-3 py-2 text-[#123447]">{fmt(event.startsAt)}</td>
                      <td className="px-3 py-2 text-[#123447]">
                        {durationMinutesFromRange(event.startsAt, event.endsAt, 60)} min
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/client/${clientSlug}/history/events/${event.id}`}
                          className="inline-flex items-center justify-center rounded-full border border-[#9ec8db] px-3 py-1 font-semibold text-[#0f5b73]"
                        >
                          Event record
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isLinksModalOpen && linksPayload ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          onClick={closeLinksModal}
        >
          <div
            className="w-full max-w-5xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-lg font-semibold text-[#123447]">
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
                  className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447]"
                >
                  Fechar
                </button>
              </div>
            </div>
            <div className="mt-4 max-h-[65vh] overflow-auto">
              <table className="nr-table min-w-full text-sm">
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
                        <td className="px-2 py-2">{fmt(sector.lastSubmittedAt)}</td>
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

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[#123447]">Calendario mestre (DRPS + reunioes + bloqueios)</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCalendarMonth((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1))}
              className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs"
            >
              Mes anterior
            </button>
            <button
              type="button"
              onClick={() => setCalendarMonth((p) => new Date(p.getFullYear(), p.getMonth() + 1, 1))}
              className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs"
            >
              Proximo
            </button>
          </div>
        </div>
        <p className="mt-2 text-sm text-[#3d5a69]">
          {new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(calendarMonth)}
        </p>
        {payload.masterCalendar.calendarEventsUnavailable ? (
          <p className="mt-1 text-xs text-[#8a5b2d]">
            Eventos de reunioes/bloqueios indisponiveis no momento. Exibindo somente marcos DRPS.
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#4f6977]">
          <span className="font-semibold">Legenda:</span>
          <span className="rounded-full bg-[#e6f3f8] px-2 py-0.5 text-[#1f5f79]">
            Reuniao provisoria
          </span>
          <span className="rounded-full bg-[#2f6f8d] px-2 py-0.5 text-white">
            Reuniao commitada
          </span>
        </div>
        <div className="mt-4 grid grid-cols-7 gap-2">
          {WEEK.map((label) => (
            <p key={label} className="text-center text-xs font-semibold text-[#5e7d8d]">
              {label}
            </p>
          ))}
          {days.map((day) => (
            <div
              key={day.key}
              className={`min-h-[145px] rounded-xl border p-2 ${
                day.inMonth ? "border-[#d7e6ee] bg-white" : "border-[#edf3f7] bg-[#f8fbfd]"
              }`}
            >
              <p className={`text-xs font-semibold ${day.inMonth ? "text-[#163748]" : "text-[#86a0ac]"}`}>
                {day.value.getDate()}
              </p>
              <div className="mt-2 space-y-1.5">
                {day.events.slice(0, MAX_CALENDAR_EVENTS_PER_DAY).map((event) => {
                  const cardClass = `rounded-md border px-1.5 py-1 ${
                    event.type === "start"
                      ? "border-[#b9dfc6] bg-[#eaf8ef] text-[#1b5437]"
                      : event.type === "close"
                        ? "border-[#f2d6ad] bg-[#fff4e4] text-[#7a4b00]"
                        : event.type === "meeting"
                          ? event.details.eventLifecycle === "committed"
                            ? "border-[#2f6f8d] bg-[#2f6f8d] text-white"
                            : "border-[#b8d8e6] bg-[#edf7fb] text-[#1f5f79]"
                          : "border-[#efc1d6] bg-[#fcecf4] text-[#7a2755]"
                  }`;
                  return (
                    <div key={event.id} className={cardClass}>
                      <button
                        type="button"
                        onClick={() => setSelectedCalendarEventId(event.id)}
                        title={`${event.title} (${fmt(event.startsAt)})`}
                        className="block min-w-0 w-full text-left"
                      >
                        <p className="truncate text-[10px] font-semibold">{event.title}</p>
                        <p className="truncate text-[10px] opacity-90">{event.timeLabel}</p>
                        <p className="truncate text-[10px] opacity-90">{event.companyLabel}</p>
                        <p className="truncate text-[10px] opacity-90">
                          {event.typeLabel}
                          {event.lifecycleLabel ? ` . ${event.lifecycleLabel}` : ""}
                        </p>
                      </button>
                    </div>
                  );
                })}
                {day.events.length > MAX_CALENDAR_EVENTS_PER_DAY ? (
                  <p className="text-[10px] text-[#527083]">+{day.events.length - MAX_CALENDAR_EVENTS_PER_DAY}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      {selectedCalendarEvent ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          onClick={() => setSelectedCalendarEventId(null)}
        >
          <article
            className="w-full max-w-2xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-lg font-semibold text-[#123447]">Detalhes do evento</h4>
              <button
                type="button"
                onClick={() => setSelectedCalendarEventId(null)}
                className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447]"
              >
                Fechar
              </button>
            </div>

            {selectedCalendarEventRecordHref || selectedCalendarEventLink ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {selectedCalendarEventRecordHref ? (
                  <Link
                    href={selectedCalendarEventRecordHref}
                    className="inline-flex rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                  >
                    Event record
                  </Link>
                ) : null}
                {selectedCalendarEventLink ? (
                  <Link
                    href={selectedCalendarEventLink.href}
                    className="inline-flex rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                  >
                    {selectedCalendarEventLink.label}
                  </Link>
                ) : null}
              </div>
            ) : null}

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-[#e0e9ee] bg-[#f7fbfd] p-3">
                <p className="text-xs text-[#4d6a79]">Tipo</p>
                <p className="text-sm font-semibold text-[#123447]">{selectedCalendarEventTypeLabel}</p>
              </div>
              <div className="rounded-lg border border-[#e0e9ee] bg-[#f7fbfd] p-3">
                <p className="text-xs text-[#4d6a79]">Empresa</p>
                <p className="text-sm font-semibold text-[#123447]">
                  {selectedCalendarEvent.clientName ?? payload.client.companyName}
                </p>
              </div>
              <div className="rounded-lg border border-[#e0e9ee] bg-[#f7fbfd] p-3 md:col-span-2">
                <p className="text-xs text-[#4d6a79]">Data/hora marcada</p>
                <p className="text-sm font-semibold text-[#123447]">{fmt(selectedCalendarEvent.startsAt)}</p>
              </div>
              <div className="rounded-lg border border-[#e0e9ee] bg-[#f7fbfd] p-3 md:col-span-2">
                <p className="text-xs text-[#4d6a79]">Duracao do workshop</p>
                <p className="text-sm font-semibold text-[#123447]">
                  {durationMinutesFromRange(selectedCalendarEvent.startsAt, selectedCalendarEvent.endsAt)} min
                </p>
              </div>
              <div className="rounded-lg border border-[#e0e9ee] bg-[#f7fbfd] p-3 md:col-span-2">
                <p className="text-xs text-[#4d6a79]">Ciclo</p>
                <p className="text-sm font-semibold text-[#123447]">{selectedCalendarEventLifecycleLabel}</p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-[#e0e9ee] p-3">
                <p className="text-xs text-[#4d6a79]">Conteudo</p>
                <p className="mt-1 text-sm text-[#123447]">{selectedCalendarEventContent}</p>
              </div>
              <div className="rounded-lg border border-[#e0e9ee] p-3">
                <p className="text-xs text-[#4d6a79]">Preparacao necessaria</p>
                <p className="mt-1 text-sm text-[#123447]">{selectedCalendarEventPreparation}</p>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Relatorios disponibilizados</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="nr-table min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Titulo</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Data</th>
                <th className="px-2 py-2 text-left">Acao</th>
              </tr>
            </thead>
            <tbody>
              {payload.reports.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-xs text-[#5a7383]" colSpan={4}>
                    Sem relatorios ainda.
                  </td>
                </tr>
              ) : (
                payload.reports.map((report) => (
                  <tr key={report.id} className="border-b">
                    <td className="px-2 py-2">{report.report_title}</td>
                    <td className="px-2 py-2">{report.status}</td>
                    <td className="px-2 py-2">{fmt(report.created_at)}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => void downloadReport(report)}
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

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Contratos e faturamento</h3>
        <p className="mt-2 text-sm">Financeiro: {payload.client.billingStatus}</p>
        <p className="mt-1 text-sm">
          Contrato: {fmtDate(payload.client.contractStartDate)} - {fmtDate(payload.client.contractEndDate)}
        </p>
        <p className="mt-1 text-sm">Ultima atualizacao: {fmt(payload.client.updatedAt)}</p>
      </section>

      {selectedCampaign ? (
        <p className="text-xs text-[#5a7383]">
          Diagnostico ativo: {selectedCampaign.name} ({selectedCampaign.public_slug})
        </p>
      ) : null}
    </div>
  );
}
