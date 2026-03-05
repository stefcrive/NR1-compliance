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
};

type Report = {
  id: string;
  report_title: string;
  status: "draft" | "processing" | "ready" | "failed";
  created_at: string;
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

function campaignCollectionStatus(status: Campaign["status"]) {
  if (status === "live") return "Questionario aberto (coletando respostas)";
  if (status === "closed") return "Questionario fechado";
  if (status === "draft") return "Questionario em rascunho";
  return "Questionario arquivado";
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
  const [drpsActionError, setDrpsActionError] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [downloadingReportId, setDownloadingReportId] = useState<string | null>(null);
  const [reportFeedback, setReportFeedback] = useState("");
  const [selectedCalendarEventId, setSelectedCalendarEventId] = useState<string | null>(null);
  const [appliedCalendarDeepLinkId, setAppliedCalendarDeepLinkId] = useState<string | null>(null);

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
  const linksActionCampaign =
    selectedCampaign?.status === "live" ? selectedCampaign : openCampaigns[0] ?? null;

  useEffect(() => {
    if (!payload || !resultsCampaign) return;
    if (payload.selectedCampaign?.id === resultsCampaign.id) return;
    setSelectedCampaignId(resultsCampaign.id);
    void loadData(resultsCampaign.id);
  }, [loadData, payload, resultsCampaign]);

  async function loadQuestionnaireLinks(campaign: Campaign) {
    setIsLoadingLinksFor(campaign.id);
    setDrpsActionError("");
    setLinksPayload(null);
    setIsLinksModalOpen(false);
    try {
      const response = await fetch(`/api/client/portal/${clientSlug}/campaigns/${campaign.id}/sectors`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setDrpsActionError("Falha ao carregar links do questionario.");
        return;
      }
      setLinksPayload((await response.json()) as SectorPayload);
      setCopiedSectorId(null);
      setIsLinksModalOpen(true);
    } catch {
      setDrpsActionError("Falha ao carregar links do questionario.");
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
      setDrpsActionError("Nenhum setor ativo para copiar.");
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

  const calendarEventLinkById = useMemo(() => {
    const map = new Map<
      string,
      { href: string; label: string }
    >();
    for (const event of calendarEvents) {
      const link = calendarEventLinkFor(event);
      if (link) map.set(event.id, link);
    }
    return map;
  }, [calendarEventLinkFor, calendarEvents]);

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

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Resultados atuais</h3>
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
        ) : null}
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-[#123447]">Diagnosticos DRPS</h3>
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
        <p className="mt-2 text-xs text-[#4f6977]">
          {selectedCampaign
            ? `Questionario atual: ${campaignCollectionStatus(selectedCampaign.status)}`
            : "Sem questionario selecionado."}
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Diagnostico</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Inicio</th>
                <th className="px-2 py-2 text-left">Fechamento</th>
                <th className="px-2 py-2 text-left">Respostas</th>
                <th className="px-2 py-2 text-left">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {openCampaigns.length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-xs text-[#5a7383]" colSpan={6}>
                    Sem questionarios abertos coletando respostas no momento.
                  </td>
                </tr>
              ) : (
                openCampaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-b">
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
                    <td className="px-2 py-2">{campaign.responses ?? 0}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          router.push(`/client/${clientSlug}/diagnostic/${campaign.id}`);
                        }}
                        className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447]"
                      >
                        Ver resultados
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {drpsActionError ? <p className="mt-3 text-sm text-red-600">{drpsActionError}</p> : null}
      </section>

      <section className="h-auto max-h-none overflow-visible rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Processos continuos atribuidos</h3>
        <div className="mt-3 max-h-none overflow-x-auto overflow-y-visible">
          <table className="min-w-full text-sm">
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
                  const eventLink = calendarEventLinkById.get(event.id) ?? null;
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
                  if (eventLink) {
                    return (
                      <div key={event.id} className={cardClass}>
                        <Link
                          href={eventLink.href}
                          title={`${event.title} (${fmt(event.startsAt)})`}
                          className="block min-w-0 text-left hover:underline"
                        >
                          <p className="truncate text-[10px] font-semibold">{event.title}</p>
                          <p className="truncate text-[10px] opacity-90">{event.timeLabel}</p>
                          <p className="truncate text-[10px] opacity-90">{event.companyLabel}</p>
                          <p className="truncate text-[10px] opacity-90">
                            {event.typeLabel}
                            {event.lifecycleLabel ? ` . ${event.lifecycleLabel}` : ""}
                          </p>
                        </Link>
                      </div>
                    );
                  }
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

            {selectedCalendarEventLink ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCalendarEventId(null);
                    router.push(selectedCalendarEventLink.href);
                  }}
                  className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                >
                  {selectedCalendarEventLink.label}
                </button>
              </div>
            ) : null}
          </article>
        </div>
      ) : null}

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Relatorios disponibilizados</h3>
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
