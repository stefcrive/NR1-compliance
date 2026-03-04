"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type ManagerLocale, useManagerLocale } from "@/components/manager-locale";

type BillingStatus = "up_to_date" | "pending" | "overdue" | "blocked";
type ClientStatus = "Active" | "Pending" | "Inactive";
type Tab = "clients" | "calendar";
type ClientStatusFilter = "all" | ClientStatus;
type BillingFilter = "all" | BillingStatus;
type ClientListView = "cards" | "table";
type CalendarView = "day" | "week" | "month";

type Client = {
  id: string;
  companyName: string;
  cnpj: string;
  status: ClientStatus;
  billingStatus: BillingStatus;
  portalSlug: string;
  metrics: { campaigns: number; totalResponses: number; reports: number };
};

type Campaign = {
  id: string;
  client_id?: string | null;
  client_name?: string | null;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  starts_at?: string | null;
  closes_at?: string | null;
  created_at?: string;
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

type ActiveContinuousProgram = {
  id: string;
  clientId: string;
  clientName: string | null;
  programId: string;
  programTitle: string;
  deployedAt: string | null;
  status: "Recommended" | "Active" | "Completed";
};

type CalendarIsolationFilter =
  | { kind: "none" }
  | { kind: "drps"; campaignId: string; label: string }
  | { kind: "continuous"; assignmentId: string; label: string };

const WEEK_LABELS = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  pt: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"],
} as const;
const MAX_EVENTS_PER_DAY = 5;
const UNLINKED_CLIENT_FILTER = "__unlinked__";

const COPY = {
  en: {
    title: "Manager workspace",
    clientsTab: "Clients",
    calendarTab: "Calendar",
    createClient: "Create client",
    clientsSection: "Clients",
    loading: "Loading...",
    searchPlaceholder: "Search by company or CNPJ",
    statusFilterLabel: "Status",
    billingFilterLabel: "Billing",
    listViewLabel: "List view",
    filterAll: "All",
    filterActive: "Active",
    filterPending: "Pending",
    filterInactive: "Inactive",
    tableCompany: "Company",
    tableStatus: "Status",
    tableBilling: "Billing",
    tableCampaigns: "DRPS Diagnostics",
    tableResponses: "Responses",
    tableReports: "Reports",
    viewCards: "Cards",
    viewTable: "Table",
    openProfile: "Open profile",
    noClientsForFilters: "No clients for selected filters.",
    billingAll: "All billing",
    billingUpToDate: "Up to date",
    billingPending: "Pending",
    billingOverdue: "Overdue",
    billingBlocked: "Blocked",
    calendarTitle: "DRPS diagnostics calendar",
    calendarHint: "Click events to see details. Drag managed events to move the day.",
    calendarLegendLabel: "Legend",
    calendarLegendProvisory: "Provisory meeting",
    calendarLegendCommitted: "Committed meeting",
    calendarViewLabel: "View",
    calendarViewDay: "Day",
    calendarViewWeek: "Week",
    calendarViewMonth: "Month",
    calendarClientFilterLabel: "Client",
    calendarClientAll: "All clients",
    calendarClientUnlinked: "Unlinked",
    calendarSearchPlaceholder: "Search calendar events",
    prevPeriod: "Previous",
    nextPeriod: "Next",
    noCalendarEventsForFilters: "No events for the current calendar filters.",
    liveDrps: "Active DRPS diagnostics",
    liveContinuous: "Active continuous programs",
    noActiveCampaigns: "No active DRPS diagnostics.",
    noActiveContinuous: "No active continuous programs.",
    drpsTableDiagnostic: "Diagnostic",
    drpsTableCompany: "Company",
    drpsTableStart: "Start",
    drpsTableClose: "Close",
    continuousTableProgram: "Program",
    continuousTableCompany: "Company",
    continuousTableSince: "Since",
    clearIsolation: "Clear filter",
    isolatedBy: "Calendar isolated by",
    calendarDownError: "Master calendar is unavailable now. Clients area is still operational.",
    blockWindowTitle: "Block time window",
    blockWindowClient: "Company",
    blockWindowGeneral: "General (all companies)",
    blockWindowLabel: "Label",
    blockWindowStart: "Marked date/time",
    blockWindowEnd: "Workshop duration (minutes)",
    blockWindowSave: "Save block",
    blockWindowSaving: "Saving...",
    blockWindowSaved: "Block saved.",
    blockWindowError: "Could not save blocked window.",
    noCompany: "No company",
    noLink: "Unlinked",
    startLabel: "Start",
    notPlanned: "not planned",
    eventCreated: "Diagnostic created",
    eventStart: "Start",
    eventClose: "Close",
    statusActive: "Active",
    statusPending: "Pending",
    statusInactive: "Inactive",
    loadClientsError: "Failed to load clients.",
    campaignsDownError: "DRPS diagnostics are unavailable now. Clients area is still operational.",
    workspaceLoadError: "Failed to load manager workspace.",
    eventDetailsTitle: "Event details",
    eventDetailsType: "Type",
    eventDetailsCompany: "Company",
    eventDetailsWhen: "Marked date/time",
    eventDetailsDuration: "Workshop duration",
    eventDetailsLifecycle: "Lifecycle",
    eventDetailsContent: "Content",
    eventDetailsPreparation: "Preparation required",
    eventDetailsNoContent: "No detailed content registered.",
    eventDetailsNoPreparation: "No preparation registered.",
    eventTypeDrpsStart: "DRPS start",
    eventTypeDrpsClose: "DRPS close",
    eventTypeMeeting: "Continuous meeting",
    eventTypeBlocked: "Blocked time",
    eventReadOnly: "This event is read-only.",
    eventEditTitleLabel: "Title",
    eventEditStartLabel: "Marked date/time",
    eventEditEndLabel: "Workshop duration (minutes)",
    eventEditLifecycleLabel: "Lifecycle",
    eventLifecycleProfileHint:
      "When lifecycle is provisory, date/time can be updated in continuous program profile.",
    eventEditSave: "Save changes",
    eventEditSaving: "Saving...",
    eventEditSuccess: "Event updated.",
    eventEditError: "Could not update event.",
    invalidTimeRange: "Invalid time range.",
    eventCloseAction: "Close",
    eventOpenDrpsResults: "Open DRPS results",
    eventOpenProgramDetails: "Open process details",
    eventLifecycleCommitted: "Committed",
    eventLifecycleProvisory: "Provisory",
    eventProposalAssignment: "Cadence suggestion",
    eventProposalReschedule: "Reschedule request",
    eventCommitReschedule: "Confirm reschedule",
    eventCommitRescheduleError: "Could not confirm reschedule.",
    eventDeleteAction: "Delete event",
    eventDeleting: "Deleting...",
    eventDeleteConfirm: "Delete this calendar event?",
    eventDeleteError: "Could not delete event.",
    eventMoreCount: "more",
  },
  pt: {
    title: "Area do gestor",
    clientsTab: "Clientes",
    calendarTab: "Calendario",
    createClient: "Criar cliente",
    clientsSection: "Clientes",
    loading: "Carregando...",
    searchPlaceholder: "Buscar por empresa ou CNPJ",
    statusFilterLabel: "Status",
    billingFilterLabel: "Financeiro",
    listViewLabel: "Visualizacao",
    filterAll: "Todos",
    filterActive: "Ativos",
    filterPending: "Pendentes",
    filterInactive: "Inativos",
    tableCompany: "Empresa",
    tableStatus: "Status",
    tableBilling: "Financeiro",
    tableCampaigns: "Diagnosticos DRPS",
    tableResponses: "Respostas",
    tableReports: "Relatorios",
    viewCards: "Cards",
    viewTable: "Tabela",
    openProfile: "Abrir ficha",
    noClientsForFilters: "Nenhum cliente encontrado para os filtros selecionados.",
    billingAll: "Todo financeiro",
    billingUpToDate: "Em dia",
    billingPending: "Pendente",
    billingOverdue: "Atrasado",
    billingBlocked: "Bloqueado",
    calendarTitle: "Calendario de diagnosticos DRPS",
    calendarHint: "Clique para ver detalhes. Arraste eventos gerenciados para mover o dia.",
    calendarLegendLabel: "Legenda",
    calendarLegendProvisory: "Reuniao provisoria",
    calendarLegendCommitted: "Reuniao commitada",
    calendarViewLabel: "Visualizacao",
    calendarViewDay: "Dia",
    calendarViewWeek: "Semana",
    calendarViewMonth: "Mes",
    calendarClientFilterLabel: "Cliente",
    calendarClientAll: "Todos os clientes",
    calendarClientUnlinked: "Sem vinculo",
    calendarSearchPlaceholder: "Buscar eventos no calendario",
    prevPeriod: "Anterior",
    nextPeriod: "Proximo",
    noCalendarEventsForFilters: "Nenhum evento para os filtros atuais do calendario.",
    liveDrps: "Diagnosticos DRPS ativos",
    liveContinuous: "Programas continuos ativos",
    noActiveCampaigns: "Nenhum diagnostico DRPS ativo.",
    noActiveContinuous: "Nenhum programa continuo ativo.",
    drpsTableDiagnostic: "Diagnostico",
    drpsTableCompany: "Empresa",
    drpsTableStart: "Inicio",
    drpsTableClose: "Fechamento",
    continuousTableProgram: "Programa",
    continuousTableCompany: "Empresa",
    continuousTableSince: "Ativo desde",
    clearIsolation: "Limpar filtro",
    isolatedBy: "Calendario isolado por",
    calendarDownError: "Calendario mestre indisponivel no momento. A area de clientes segue operacional.",
    blockWindowTitle: "Bloquear horario",
    blockWindowClient: "Empresa",
    blockWindowGeneral: "Geral (todas empresas)",
    blockWindowLabel: "Descricao",
    blockWindowStart: "Data/hora marcada",
    blockWindowEnd: "Duracao do workshop (minutos)",
    blockWindowSave: "Salvar bloqueio",
    blockWindowSaving: "Salvando...",
    blockWindowSaved: "Bloqueio salvo.",
    blockWindowError: "Nao foi possivel salvar bloqueio.",
    noCompany: "Sem empresa",
    noLink: "Sem vinculo",
    startLabel: "Inicio",
    notPlanned: "nao planejado",
    eventCreated: "Diagnostico criado",
    eventStart: "Inicio",
    eventClose: "Fechamento",
    statusActive: "Ativo",
    statusPending: "Pendente",
    statusInactive: "Inativo",
    loadClientsError: "Falha ao carregar clientes.",
    campaignsDownError: "Diagnosticos DRPS indisponiveis no momento. A area de clientes segue operacional.",
    workspaceLoadError: "Erro ao carregar area do gestor.",
    eventDetailsTitle: "Detalhes do evento",
    eventDetailsType: "Tipo",
    eventDetailsCompany: "Empresa",
    eventDetailsWhen: "Data/hora marcada",
    eventDetailsDuration: "Duracao do workshop",
    eventDetailsLifecycle: "Ciclo",
    eventDetailsContent: "Conteudo",
    eventDetailsPreparation: "Preparacao necessaria",
    eventDetailsNoContent: "Nenhum conteudo detalhado cadastrado.",
    eventDetailsNoPreparation: "Nenhuma preparacao cadastrada.",
    eventTypeDrpsStart: "Inicio DRPS",
    eventTypeDrpsClose: "Fechamento DRPS",
    eventTypeMeeting: "Reuniao continua",
    eventTypeBlocked: "Bloqueio",
    eventReadOnly: "Este evento e somente leitura.",
    eventEditTitleLabel: "Titulo",
    eventEditStartLabel: "Data/hora marcada",
    eventEditEndLabel: "Duracao do workshop (minutos)",
    eventEditLifecycleLabel: "Ciclo",
    eventLifecycleProfileHint:
      "Quando o ciclo e provisorio, a data/hora pode ser ajustada no perfil do programa continuo.",
    eventEditSave: "Salvar alteracoes",
    eventEditSaving: "Salvando...",
    eventEditSuccess: "Evento atualizado.",
    eventEditError: "Nao foi possivel atualizar o evento.",
    invalidTimeRange: "Intervalo de horario invalido.",
    eventCloseAction: "Fechar",
    eventOpenDrpsResults: "Abrir resultado DRPS",
    eventOpenProgramDetails: "Abrir detalhes do processo",
    eventLifecycleCommitted: "Commitado",
    eventLifecycleProvisory: "Provisorio",
    eventProposalAssignment: "Sugestao de cadencia",
    eventProposalReschedule: "Pedido de reagendamento",
    eventCommitReschedule: "Confirmar reagendamento",
    eventCommitRescheduleError: "Nao foi possivel confirmar o reagendamento.",
    eventDeleteAction: "Excluir evento",
    eventDeleting: "Excluindo...",
    eventDeleteConfirm: "Excluir este evento do calendario?",
    eventDeleteError: "Nao foi possivel excluir o evento.",
    eventMoreCount: "a mais",
  },
} as const;

function uiLocale(locale: ManagerLocale) {
  return locale === "pt" ? "pt-BR" : "en-US";
}

function toDate(value: string, locale: ManagerLocale) {
  return new Intl.DateTimeFormat(uiLocale(locale), { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

function toTime(value: string, locale: ManagerLocale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat(uiLocale(locale), { hour: "2-digit", minute: "2-digit" }).format(date);
}

function toDatetimeLocal(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function toDatetimeLocalFromIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return toDatetimeLocal(date);
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

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function monthLabel(date: Date, locale: ManagerLocale) {
  return new Intl.DateTimeFormat(uiLocale(locale), { month: "long", year: "numeric" }).format(date);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date) {
  const value = startOfDay(date);
  value.setDate(value.getDate() - value.getDay());
  return value;
}

function addDays(date: Date, days: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function dayLabel(date: Date, locale: ManagerLocale) {
  return new Intl.DateTimeFormat(uiLocale(locale), {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function shortDateLabel(date: Date, locale: ManagerLocale) {
  return new Intl.DateTimeFormat(uiLocale(locale), { month: "short", day: "numeric" }).format(date);
}

function extractCampaignIdFromCalendarEvent(event: MasterCalendarEvent) {
  if (event.eventType !== "drps_start" && event.eventType !== "drps_close") return null;
  if (event.id.startsWith("drps-start-")) return event.id.slice("drps-start-".length);
  if (event.id.startsWith("drps-close-")) return event.id.slice("drps-close-".length);
  return null;
}

function localizeStatus(status: ClientStatus, locale: ManagerLocale) {
  const t = COPY[locale];
  if (status === "Active") return t.statusActive;
  if (status === "Pending") return t.statusPending;
  return t.statusInactive;
}

function localizeBilling(status: BillingStatus, locale: ManagerLocale) {
  const t = COPY[locale];
  if (status === "up_to_date") return t.billingUpToDate;
  if (status === "pending") return t.billingPending;
  if (status === "overdue") return t.billingOverdue;
  return t.billingBlocked;
}

function statusBadgeClass(status: ClientStatus) {
  if (status === "Active") return "bg-[#d8efe2] text-[#1a5d3b]";
  if (status === "Pending") return "bg-[#f9eed0] text-[#7a4d00]";
  return "bg-[#e3e7eb] text-[#344451]";
}

function cardBannerClass(status: ClientStatus) {
  if (status === "Active") return "from-[#1d4f78] via-[#2d86b8] to-[#88bddf]";
  if (status === "Pending") return "from-[#7e4b1e] via-[#bf7b3c] to-[#e0bf93]";
  return "from-[#434a51] via-[#6e7882] to-[#a8afb7]";
}

function CardsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path d="M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8Z" fill="currentColor" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        d="M3 4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4Zm2 2v3h14V6H5Zm0 5v3h14v-3H5Zm0 5v3h14v-3H5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ManagerWorkspace({
  initialTab = "clients",
  showTabSwitch = true,
}: {
  initialTab?: Tab;
  showTabSwitch?: boolean;
}) {
  const { locale } = useManagerLocale();
  const t = COPY[locale];
  const [tab, setTab] = useState<Tab>(initialTab);
  const [calendarView, setCalendarView] = useState<CalendarView>("month");
  const [calendarCursorDate, setCalendarCursorDate] = useState(() => startOfDay(new Date()));
  const [clients, setClients] = useState<Client[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<MasterCalendarEvent[]>([]);
  const [activeContinuousPrograms, setActiveContinuousPrograms] = useState<ActiveContinuousProgram[]>([]);
  const [calendarIsolation, setCalendarIsolation] = useState<CalendarIsolationFilter>({ kind: "none" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [clientStatusFilter, setClientStatusFilter] = useState<ClientStatusFilter>("all");
  const [billingFilter, setBillingFilter] = useState<BillingFilter>("all");
  const [clientListView, setClientListView] = useState<ClientListView>("cards");
  const [calendarClientFilter, setCalendarClientFilter] = useState("all");
  const [calendarSearchQuery, setCalendarSearchQuery] = useState("");
  const [blockClientId, setBlockClientId] = useState("");
  const [blockTitle, setBlockTitle] = useState("Bloqueio operacional");
  const [blockStartsAt, setBlockStartsAt] = useState(() => toDatetimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const [blockDurationMinutes, setBlockDurationMinutes] = useState("60");
  const [isSavingBlock, setIsSavingBlock] = useState(false);
  const [blockFeedback, setBlockFeedback] = useState("");
  const [selectedCalendarEventId, setSelectedCalendarEventId] = useState<string | null>(null);
  const [eventEditTitle, setEventEditTitle] = useState("");
  const [eventEditStartsAt, setEventEditStartsAt] = useState("");
  const [eventEditDurationMinutes, setEventEditDurationMinutes] = useState("60");
  const [eventEditLifecycle, setEventEditLifecycle] = useState<"provisory" | "committed">("committed");
  const [eventEditContent, setEventEditContent] = useState("");
  const [eventEditPreparation, setEventEditPreparation] = useState("");
  const [isSavingEventEdit, setIsSavingEventEdit] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [eventEditFeedback, setEventEditFeedback] = useState("");
  const [draggingEventId, setDraggingEventId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [clientsRes, campaignsRes, calendarRes] = await Promise.all([
        fetch("/api/admin/clients", { cache: "no-store" }),
        fetch("/api/admin/campaigns", { cache: "no-store" }),
        fetch("/api/admin/calendar", { cache: "no-store" }),
      ]);
      if (!clientsRes.ok) throw new Error(t.loadClientsError);
      const clientsPayload = (await clientsRes.json()) as { clients: Client[] };
      const campaignsPayload = campaignsRes.ok
        ? ((await campaignsRes.json()) as { campaigns: Campaign[] })
        : { campaigns: [] as Campaign[] };
      const calendarPayload = calendarRes.ok
        ? ((await calendarRes.json()) as {
            events: MasterCalendarEvent[];
            activeContinuousPrograms?: ActiveContinuousProgram[];
          })
        : { events: [] as MasterCalendarEvent[], activeContinuousPrograms: [] as ActiveContinuousProgram[] };
      setClients(clientsPayload.clients ?? []);
      setCampaigns(campaignsPayload.campaigns ?? []);
      setCalendarEvents(calendarPayload.events ?? []);
      setActiveContinuousPrograms(calendarPayload.activeContinuousPrograms ?? []);
      if (!campaignsRes.ok) {
        setError(t.campaignsDownError);
      } else if (!calendarRes.ok) {
        setError(t.calendarDownError);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t.workspaceLoadError);
    } finally {
      setLoading(false);
    }
  }, [
    t.calendarDownError,
    t.campaignsDownError,
    t.loadClientsError,
    t.workspaceLoadError,
  ]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (clients.length === 0) return;
    setBlockClientId((previous) => previous || clients[0].id);
  }, [clients]);

  const createBlockedWindow = useCallback(async () => {
    if (!blockStartsAt) return;
    const duration = Number.parseInt(blockDurationMinutes, 10);
    if (!Number.isFinite(duration) || duration < 15 || duration > 24 * 60) {
      setBlockFeedback(t.invalidTimeRange);
      return;
    }
    setIsSavingBlock(true);
    setBlockFeedback("");
    try {
      const markedAt = new Date(blockStartsAt).toISOString();
      const response = await fetch("/api/admin/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "blocked",
          clientId: blockClientId || null,
          title: blockTitle.trim() || "Bloqueio de agenda",
          markedAt,
          workshopDurationMinutes: duration,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? t.blockWindowError);
      }
      setBlockFeedback(t.blockWindowSaved);
      await loadAll();
    } catch (saveError) {
      setBlockFeedback(saveError instanceof Error ? saveError.message : t.blockWindowError);
    } finally {
      setIsSavingBlock(false);
    }
  }, [
    blockClientId,
    blockDurationMinutes,
    blockStartsAt,
    blockTitle,
    loadAll,
    t.blockWindowError,
    t.blockWindowSaved,
    t.invalidTimeRange,
  ]);

  const liveCampaigns = useMemo(() => campaigns.filter((campaign) => campaign.status === "live"), [campaigns]);
  const liveContinuousPrograms = useMemo(
    () =>
      activeContinuousPrograms
        .filter((assignment) => assignment.status === "Active")
        .slice()
        .sort((a, b) => {
          const left = a.deployedAt ? new Date(a.deployedAt).getTime() : 0;
          const right = b.deployedAt ? new Date(b.deployedAt).getTime() : 0;
          return right - left;
        }),
    [activeContinuousPrograms],
  );

  useEffect(() => {
    if (calendarIsolation.kind === "none") return;
    if (
      calendarIsolation.kind === "drps" &&
      !liveCampaigns.some((campaign) => campaign.id === calendarIsolation.campaignId)
    ) {
      setCalendarIsolation({ kind: "none" });
      return;
    }
    if (
      calendarIsolation.kind === "continuous" &&
      !liveContinuousPrograms.some((assignment) => assignment.id === calendarIsolation.assignmentId)
    ) {
      setCalendarIsolation({ kind: "none" });
    }
  }, [calendarIsolation, liveCampaigns, liveContinuousPrograms]);

  const isolatedCalendarEvents = useMemo(() => {
    if (calendarIsolation.kind === "none") return calendarEvents;
    if (calendarIsolation.kind === "drps") {
      return calendarEvents.filter(
        (event) => extractCampaignIdFromCalendarEvent(event) === calendarIsolation.campaignId,
      );
    }
    return calendarEvents.filter(
      (event) =>
        event.eventType === "continuous_meeting" &&
        event.sourceClientProgramId === calendarIsolation.assignmentId,
    );
  }, [calendarEvents, calendarIsolation]);

  const isEditableCalendarEvent = useCallback(
    (event: MasterCalendarEvent) =>
      event.eventType === "blocked" || event.eventType === "continuous_meeting",
    [],
  );

  const selectedCalendarEvent = useMemo(
    () =>
      selectedCalendarEventId
        ? calendarEvents.find((event) => event.id === selectedCalendarEventId) ?? null
        : null,
    [calendarEvents, selectedCalendarEventId],
  );

  useEffect(() => {
    if (!selectedCalendarEventId) return;
    if (calendarEvents.some((event) => event.id === selectedCalendarEventId)) return;
    setSelectedCalendarEventId(null);
  }, [calendarEvents, selectedCalendarEventId]);

  useEffect(() => {
    if (!selectedCalendarEvent) {
      setEventEditTitle("");
      setEventEditStartsAt("");
      setEventEditDurationMinutes("60");
      setEventEditLifecycle("committed");
      setEventEditContent("");
      setEventEditPreparation("");
      setEventEditFeedback("");
      return;
    }
    setEventEditTitle(selectedCalendarEvent.title);
    setEventEditStartsAt(toDatetimeLocalFromIso(selectedCalendarEvent.startsAt));
    setEventEditDurationMinutes(
      String(durationMinutesFromRange(selectedCalendarEvent.startsAt, selectedCalendarEvent.endsAt, 60)),
    );
    setEventEditLifecycle(selectedCalendarEvent.details.eventLifecycle);
    setEventEditContent(selectedCalendarEvent.details?.content ?? "");
    setEventEditPreparation(selectedCalendarEvent.details?.preparationRequired ?? "");
    setEventEditFeedback("");
  }, [selectedCalendarEvent]);

  const updateCalendarEvent = useCallback(
    async (payload: {
      eventId: string;
      title?: string;
      startsAt?: string;
      endsAt?: string;
      markedAt?: string;
      workshopDurationMinutes?: number;
      eventLifecycle?: "provisory" | "committed";
      content?: string | null;
      preparationRequired?: string | null;
      commitProvisoryReschedule?: boolean;
    }) => {
      const response = await fetch("/api/admin/calendar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        event?: MasterCalendarEvent;
      };
      if (!response.ok || !body.event) {
        throw new Error(body.error ?? t.eventEditError);
      }
      const nextEvent = body.event;
      setCalendarEvents((previous) =>
        previous.map((event) =>
          event.id === nextEvent.id
            ? {
                ...event,
                ...nextEvent,
                clientName: nextEvent.clientName ?? event.clientName,
              }
            : event,
        ),
      );
      return nextEvent;
    },
    [t.eventEditError],
  );

  const saveSelectedCalendarEvent = useCallback(async () => {
    if (!selectedCalendarEvent || !isEditableCalendarEvent(selectedCalendarEvent)) return;

    const nextMarkedAt = new Date(eventEditStartsAt);
    const durationMinutes = Number.parseInt(eventEditDurationMinutes, 10);
    if (Number.isNaN(nextMarkedAt.getTime()) || !Number.isFinite(durationMinutes) || durationMinutes < 15) {
      setEventEditFeedback(t.invalidTimeRange);
      return;
    }

    setIsSavingEventEdit(true);
    setEventEditFeedback("");
    try {
      await updateCalendarEvent({
        eventId: selectedCalendarEvent.id,
        title: eventEditTitle.trim(),
        markedAt: nextMarkedAt.toISOString(),
        workshopDurationMinutes: durationMinutes,
        eventLifecycle: eventEditLifecycle,
        content: eventEditContent.trim() || null,
        preparationRequired: eventEditPreparation.trim() || null,
      });
      setEventEditFeedback(t.eventEditSuccess);
    } catch (eventUpdateError) {
      setEventEditFeedback(
        eventUpdateError instanceof Error ? eventUpdateError.message : t.eventEditError,
      );
    } finally {
      setIsSavingEventEdit(false);
    }
  }, [
    eventEditContent,
    eventEditDurationMinutes,
    eventEditLifecycle,
    eventEditPreparation,
    eventEditStartsAt,
    eventEditTitle,
    isEditableCalendarEvent,
    selectedCalendarEvent,
    t.eventEditError,
    t.eventEditSuccess,
    t.invalidTimeRange,
    updateCalendarEvent,
  ]);

  const deleteCalendarEvent = useCallback(
    async (event: MasterCalendarEvent) => {
      if (!isEditableCalendarEvent(event)) return;
      if (!window.confirm(t.eventDeleteConfirm)) return;
      setDeletingEventId(event.id);
      setEventEditFeedback("");
      try {
        const response = await fetch("/api/admin/calendar", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: event.id }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          deletedEventId?: string;
        };
        if (!response.ok || !body.deletedEventId) {
          throw new Error(body.error ?? t.eventDeleteError);
        }
        setCalendarEvents((previous) => previous.filter((item) => item.id !== body.deletedEventId));
        setEventEditFeedback("");
      } catch (deleteError) {
        const message = deleteError instanceof Error ? deleteError.message : t.eventDeleteError;
        if (selectedCalendarEventId === event.id) {
          setEventEditFeedback(message);
        } else {
          setError(message);
        }
      } finally {
        setDeletingEventId((current) => (current === event.id ? null : current));
      }
    },
    [
      isEditableCalendarEvent,
      selectedCalendarEventId,
      t.eventDeleteConfirm,
      t.eventDeleteError,
    ],
  );

  const commitSelectedReschedule = useCallback(async () => {
    if (
      !selectedCalendarEvent ||
      selectedCalendarEvent.eventType !== "continuous_meeting" ||
      selectedCalendarEvent.details.eventLifecycle !== "provisory" ||
      selectedCalendarEvent.details.proposalKind !== "reschedule"
    ) {
      return;
    }
    setIsSavingEventEdit(true);
    setEventEditFeedback("");
    try {
      await updateCalendarEvent({
        eventId: selectedCalendarEvent.id,
        commitProvisoryReschedule: true,
      });
      setEventEditFeedback(t.eventEditSuccess);
      await loadAll();
    } catch (commitError) {
      setEventEditFeedback(
        commitError instanceof Error ? commitError.message : t.eventCommitRescheduleError,
      );
    } finally {
      setIsSavingEventEdit(false);
    }
  }, [
    loadAll,
    selectedCalendarEvent,
    t.eventCommitRescheduleError,
    t.eventEditSuccess,
    updateCalendarEvent,
  ]);

  const moveCalendarEventToDay = useCallback(
    async (eventId: string, targetDay: Date) => {
      const event = calendarEvents.find((item) => item.id === eventId) ?? null;
      if (!event || !isEditableCalendarEvent(event)) return;

      const start = new Date(event.startsAt);
      const end = new Date(event.endsAt);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;

      const movedStart = new Date(start);
      movedStart.setFullYear(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate());
      if (dayKey(movedStart) === dayKey(start)) return;

      const durationMs = end.getTime() - start.getTime();

      try {
        const updatedEvent = await updateCalendarEvent({
          eventId: event.id,
          markedAt: movedStart.toISOString(),
          workshopDurationMinutes: Math.max(15, Math.round(durationMs / 60000)),
        });
        if (selectedCalendarEventId === updatedEvent.id) {
          setEventEditStartsAt(toDatetimeLocalFromIso(updatedEvent.startsAt));
          setEventEditDurationMinutes(
            String(durationMinutesFromRange(updatedEvent.startsAt, updatedEvent.endsAt, 60)),
          );
          setEventEditFeedback(t.eventEditSuccess);
        }
      } catch (eventUpdateError) {
        setEventEditFeedback(
          eventUpdateError instanceof Error ? eventUpdateError.message : t.eventEditError,
        );
      }
    },
    [
      calendarEvents,
      isEditableCalendarEvent,
      selectedCalendarEventId,
      t.eventEditError,
      t.eventEditSuccess,
      updateCalendarEvent,
    ],
  );

  const selectedEventTypeLabel = useMemo(() => {
    if (!selectedCalendarEvent) return "";
    if (selectedCalendarEvent.eventType === "drps_start") return t.eventTypeDrpsStart;
    if (selectedCalendarEvent.eventType === "drps_close") return t.eventTypeDrpsClose;
    if (selectedCalendarEvent.eventType === "continuous_meeting") return t.eventTypeMeeting;
    return t.eventTypeBlocked;
  }, [
    selectedCalendarEvent,
    t.eventTypeBlocked,
    t.eventTypeDrpsClose,
    t.eventTypeDrpsStart,
    t.eventTypeMeeting,
  ]);

  const selectedLifecycleLabel = useMemo(() => {
    if (!selectedCalendarEvent) return "";
    const lifecycle =
      selectedCalendarEvent.details.eventLifecycle === "provisory"
        ? t.eventLifecycleProvisory
        : t.eventLifecycleCommitted;
    const proposal =
      selectedCalendarEvent.details.proposalKind === "reschedule"
        ? t.eventProposalReschedule
        : selectedCalendarEvent.details.proposalKind === "assignment"
          ? t.eventProposalAssignment
          : null;
    return proposal ? `${lifecycle} (${proposal})` : lifecycle;
  }, [
    selectedCalendarEvent,
    t.eventLifecycleCommitted,
    t.eventLifecycleProvisory,
    t.eventProposalAssignment,
    t.eventProposalReschedule,
  ]);

  const canCommitSelectedReschedule = useMemo(
    () =>
      Boolean(
        selectedCalendarEvent &&
          selectedCalendarEvent.eventType === "continuous_meeting" &&
          selectedCalendarEvent.details.eventLifecycle === "provisory" &&
          selectedCalendarEvent.details.proposalKind === "reschedule",
      ),
    [selectedCalendarEvent],
  );

  const canEditSelectedLifecycle = useMemo(
    () =>
      Boolean(
        selectedCalendarEvent &&
          !(
            selectedCalendarEvent.eventType === "continuous_meeting" &&
            selectedCalendarEvent.details.proposalKind === "reschedule"
          ),
      ),
    [selectedCalendarEvent],
  );

  const clientPortalSlugById = useMemo(
    () => new Map(clients.map((client) => [client.id, client.portalSlug])),
    [clients],
  );

  const selectedCalendarEventLink = useMemo(() => {
    if (!selectedCalendarEvent) return null;

    if (
      selectedCalendarEvent.eventType === "drps_start" ||
      selectedCalendarEvent.eventType === "drps_close"
    ) {
      const campaignId = extractCampaignIdFromCalendarEvent(selectedCalendarEvent);
      if (!campaignId) return null;
      const clientSlug = selectedCalendarEvent.clientId
        ? clientPortalSlugById.get(selectedCalendarEvent.clientId) ?? null
        : null;
      return {
        href: clientSlug
          ? `/client/${clientSlug}/diagnostic/${campaignId}`
          : `/manager/programs/drps/${campaignId}`,
        label: t.eventOpenDrpsResults,
      };
    }

    if (
      selectedCalendarEvent.eventType === "continuous_meeting" &&
      selectedCalendarEvent.sourceClientProgramId
    ) {
      const assignment =
        activeContinuousPrograms.find(
          (program) => program.id === selectedCalendarEvent.sourceClientProgramId,
        ) ?? null;
      if (!assignment) return null;
      return {
        href: `/manager/clients/${assignment.clientId}/assigned-continuous/${assignment.id}`,
        label: t.eventOpenProgramDetails,
      };
    }

    return null;
  }, [
    activeContinuousPrograms,
    clientPortalSlugById,
    selectedCalendarEvent,
    t.eventOpenDrpsResults,
    t.eventOpenProgramDetails,
  ]);

  const filteredCalendarEvents = useMemo(() => {
    const query = calendarSearchQuery.trim().toLowerCase();
    return isolatedCalendarEvents.filter((event) => {
      const byClient =
        calendarClientFilter === "all"
          ? true
          : calendarClientFilter === UNLINKED_CLIENT_FILTER
            ? !event.clientId
            : event.clientId === calendarClientFilter;
      if (!byClient) return false;
      if (!query) return true;
      const haystack = [
        event.title,
        event.clientName ?? "",
        event.details.content ?? "",
        event.details.preparationRequired ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [calendarClientFilter, calendarSearchQuery, isolatedCalendarEvents]);

  const events = useMemo(() => {
    const list: Array<{
      key: string;
      id: string;
      title: string;
      type: "start" | "close" | "meeting" | "blocked";
      startsAtMs: number;
      timeLabel: string;
      companyLabel: string;
      typeLabel: string;
      lifecycleLabel: string | null;
      canDelete: boolean;
      source: MasterCalendarEvent;
    }> = [];
    for (const event of filteredCalendarEvents) {
      const value = new Date(event.startsAt);
      if (Number.isNaN(value.getTime())) continue;
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
          ? t.eventTypeDrpsStart
          : type === "close"
            ? t.eventTypeDrpsClose
            : type === "meeting"
              ? t.eventTypeMeeting
              : t.eventTypeBlocked;
      const lifecycleLabel =
        type === "meeting" || type === "blocked"
          ? event.details.eventLifecycle === "committed"
            ? t.eventLifecycleCommitted
            : t.eventLifecycleProvisory
          : null;
      list.push({
        key: dayKey(value),
        id: event.id,
        title: event.title,
        type,
        startsAtMs: value.getTime(),
        timeLabel: `${toTime(event.startsAt, locale)} - ${toTime(event.endsAt, locale)}`,
        companyLabel: event.clientName ?? t.noCompany,
        typeLabel,
        lifecycleLabel,
        canDelete: isEditableCalendarEvent(event),
        source: event,
      });
    }
    list.sort((a, b) => a.startsAtMs - b.startsAtMs);
    return list;
  }, [
    filteredCalendarEvents,
    isEditableCalendarEvent,
    locale,
    t.eventLifecycleCommitted,
    t.eventLifecycleProvisory,
    t.eventTypeBlocked,
    t.eventTypeDrpsClose,
    t.eventTypeDrpsStart,
    t.eventTypeMeeting,
    t.noCompany,
  ]);

  const byDay = useMemo(() => {
    const map = new Map<string, typeof events>();
    for (const event of events) map.set(event.key, [...(map.get(event.key) ?? []), event]);
    return map;
  }, [events]);

  const monthReferenceDate = useMemo(
    () => new Date(calendarCursorDate.getFullYear(), calendarCursorDate.getMonth(), 1),
    [calendarCursorDate],
  );

  const monthDays = useMemo(() => {
    const start = new Date(monthReferenceDate.getFullYear(), monthReferenceDate.getMonth(), 1);
    const gridStart = new Date(start);
    gridStart.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, idx) => {
      const value = new Date(gridStart);
      value.setDate(gridStart.getDate() + idx);
      const key = dayKey(value);
      return {
        value,
        key,
        inMonth: value.getMonth() === monthReferenceDate.getMonth(),
        events: byDay.get(key) ?? [],
      };
    });
  }, [byDay, monthReferenceDate]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(calendarCursorDate);
    return Array.from({ length: 7 }, (_, idx) => {
      const value = addDays(start, idx);
      const key = dayKey(value);
      return { value, key, inMonth: true, events: byDay.get(key) ?? [] };
    });
  }, [byDay, calendarCursorDate]);

  const dayViewDays = useMemo(() => {
    const value = startOfDay(calendarCursorDate);
    const key = dayKey(value);
    return [{ value, key, inMonth: true, events: byDay.get(key) ?? [] }];
  }, [byDay, calendarCursorDate]);

  const visibleCalendarDays = useMemo(() => {
    if (calendarView === "month") return monthDays;
    if (calendarView === "week") return weekDays;
    return dayViewDays;
  }, [calendarView, dayViewDays, monthDays, weekDays]);

  const calendarPeriodLabel = useMemo(() => {
    if (calendarView === "month") return monthLabel(monthReferenceDate, locale);
    if (calendarView === "week") {
      const start = weekDays[0]?.value ?? startOfWeek(calendarCursorDate);
      const end = weekDays[6]?.value ?? addDays(start, 6);
      return `${shortDateLabel(start, locale)} - ${shortDateLabel(end, locale)}`;
    }
    return dayLabel(calendarCursorDate, locale);
  }, [calendarCursorDate, calendarView, locale, monthReferenceDate, weekDays]);

  const moveCalendarCursor = useCallback(
    (direction: -1 | 1) => {
      setCalendarCursorDate((previous) => {
        if (calendarView === "month") {
          const nextMonth = new Date(previous.getFullYear(), previous.getMonth(), 1);
          nextMonth.setMonth(nextMonth.getMonth() + direction);
          return nextMonth;
        }
        if (calendarView === "week") {
          const nextWeek = addDays(previous, direction * 7);
          return startOfDay(nextWeek);
        }
        const nextDay = addDays(previous, direction);
        return startOfDay(nextDay);
      });
    },
    [calendarView],
  );

  const filteredClients = useMemo(
    () =>
      clients.filter((client) => {
        const query = searchQuery.trim().toLowerCase();
        const normalizedQuery = query.replace(/\D/g, "");
        const cnpjDigits = client.cnpj.replace(/\D/g, "");
        const byStatus = clientStatusFilter === "all" || client.status === clientStatusFilter;
        const byBilling = billingFilter === "all" || client.billingStatus === billingFilter;
        const bySearch =
          query.length === 0 ||
          client.companyName.toLowerCase().includes(query) ||
          client.cnpj.toLowerCase().includes(query) ||
          (normalizedQuery.length > 0 && cnpjDigits.includes(normalizedQuery));
        return byStatus && byBilling && bySearch;
      }),
    [billingFilter, clientStatusFilter, clients, searchQuery],
  );

  const statusFilters: Array<{ id: ClientStatusFilter; label: string }> = [
    { id: "all", label: t.filterAll },
    { id: "Active", label: t.filterActive },
    { id: "Pending", label: t.filterPending },
    { id: "Inactive", label: t.filterInactive },
  ];

  const billingFilters: Array<{ id: BillingFilter; label: string }> = [
    { id: "all", label: t.billingAll },
    { id: "up_to_date", label: t.billingUpToDate },
    { id: "pending", label: t.billingPending },
    { id: "overdue", label: t.billingOverdue },
    { id: "blocked", label: t.billingBlocked },
  ];

  const calendarViewOptions: Array<{ id: CalendarView; label: string }> = [
    { id: "day", label: t.calendarViewDay },
    { id: "week", label: t.calendarViewWeek },
    { id: "month", label: t.calendarViewMonth },
  ];

  const calendarClientOptions = useMemo(
    () =>
      clients
        .slice()
        .sort((a, b) => a.companyName.localeCompare(b.companyName))
        .map((client) => ({ id: client.id, label: client.companyName })),
    [clients],
  );

  function toggleDrpsIsolation(campaign: Campaign) {
    setCalendarIsolation((previous) =>
      previous.kind === "drps" && previous.campaignId === campaign.id
        ? { kind: "none" }
        : { kind: "drps", campaignId: campaign.id, label: campaign.name },
    );
  }

  function toggleContinuousIsolation(program: ActiveContinuousProgram) {
    setCalendarIsolation((previous) =>
      previous.kind === "continuous" && previous.assignmentId === program.id
        ? { kind: "none" }
        : { kind: "continuous", assignmentId: program.id, label: `${program.programTitle} (${program.clientName ?? t.noLink})` },
    );
  }

  return (
    <div className="space-y-6">
      {showTabSwitch ? (
        <section className="rounded-2xl border border-[#dfdfdf] bg-[#f8f8f8] p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTab("clients")}
              className={`rounded-full px-4 py-2 text-xs font-semibold ${
                tab === "clients" ? "bg-[#111] text-white" : "border border-[#c8c8c8] bg-white text-[#202a31]"
              }`}
            >
              {t.clientsTab}
            </button>
            <button
              type="button"
              onClick={() => setTab("calendar")}
              className={`rounded-full px-4 py-2 text-xs font-semibold ${
                tab === "calendar" ? "bg-[#111] text-white" : "border border-[#c8c8c8] bg-white text-[#202a31]"
              }`}
            >
              {t.calendarTab}
            </button>
          </div>
        </section>
      ) : null}

      {tab === "clients" ? (
        <section className="space-y-4 rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-2xl font-semibold text-[#121b22] md:text-3xl">{t.clientsSection}</h3>
            <Link href="/manager/clients/new" className="rounded-full bg-[#131313] px-4 py-2 text-sm font-semibold text-white">
              {t.createClient}
            </Link>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_minmax(160px,220px)_minmax(160px,220px)_auto]">
            <label className="relative block">
              <span className="sr-only">{t.searchPlaceholder}</span>
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full rounded-xl border border-[#d0d5da] bg-white px-3 py-2.5 pr-10 text-sm text-[#1a2630] outline-none ring-[#7ba8c0] transition focus:ring-2"
                placeholder={t.searchPlaceholder}
              />
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#60727f]"
              >
                <path
                  d="M10.5 3a7.5 7.5 0 1 1 4.86 13.21l4.21 4.2-1.42 1.42-4.2-4.21A7.5 7.5 0 0 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"
                  fill="currentColor"
                />
              </svg>
            </label>

            <label className="block">
              <span className="sr-only">{t.statusFilterLabel}</span>
              <select
                value={clientStatusFilter}
                onChange={(event) => setClientStatusFilter(event.target.value as ClientStatusFilter)}
                className="w-full rounded-xl border border-[#d0d5da] bg-white px-3 py-2.5 text-sm text-[#1a2630] outline-none ring-[#7ba8c0] transition focus:ring-2"
              >
                {statusFilters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="sr-only">{t.billingFilterLabel}</span>
              <select
                value={billingFilter}
                onChange={(event) => setBillingFilter(event.target.value as BillingFilter)}
                className="w-full rounded-xl border border-[#d0d5da] bg-white px-3 py-2.5 text-sm text-[#1a2630] outline-none ring-[#7ba8c0] transition focus:ring-2"
              >
                {billingFilters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="inline-flex items-center gap-1 rounded-xl border border-[#d0d5da] bg-white p-1 lg:justify-self-end" role="group" aria-label={t.listViewLabel}>
              <button
                type="button"
                onClick={() => setClientListView("cards")}
                title={t.viewCards}
                aria-label={t.viewCards}
                className={`rounded-lg px-2.5 py-2 ${
                  clientListView === "cards" ? "bg-[#111] text-white" : "text-[#40515c] hover:bg-[#eff2f4]"
                }`}
              >
                <CardsIcon />
              </button>
              <button
                type="button"
                onClick={() => setClientListView("table")}
                title={t.viewTable}
                aria-label={t.viewTable}
                className={`rounded-lg px-2.5 py-2 ${
                  clientListView === "table" ? "bg-[#111] text-white" : "text-[#40515c] hover:bg-[#eff2f4]"
                }`}
              >
                <TableIcon />
              </button>
            </div>
          </div>

          {loading ? <p className="text-sm text-[#4f5f6a]">{t.loading}</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          {!loading && filteredClients.length === 0 ? <p className="text-sm text-[#4f5f6a]">{t.noClientsForFilters}</p> : null}

          {clientListView === "cards" ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredClients.map((client) => (
                <Link
                  key={client.id}
                  href={`/manager/clients/${client.id}`}
                  className="group block rounded-2xl border border-[#dcdcdc] bg-[#efefef] p-3 transition hover:border-[#b9c6cf] hover:shadow-sm"
                >
                  <div
                    className={`relative h-32 rounded-xl bg-gradient-to-br ${cardBannerClass(client.status)} p-3 text-white`}
                  >
                    <span className="rounded-full bg-black/25 px-2 py-1 text-[11px] font-semibold">
                      {localizeStatus(client.status, locale)}
                    </span>
                    <p className="absolute bottom-2 right-2 text-xs font-medium uppercase tracking-wide">NR1</p>
                  </div>

                  <div className="mt-3 space-y-1">
                    <p className="text-[27px] font-semibold leading-[1.12] text-[#101a21] break-words">{client.companyName}</p>
                    <p className="text-xs text-[#4a5862]">CNPJ {client.cnpj}</p>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className={`rounded-full px-2 py-1 font-semibold ${statusBadgeClass(client.status)}`}>
                      {localizeStatus(client.status, locale)}
                    </span>
                    <span className="rounded-full bg-[#e3e7eb] px-2 py-1 font-semibold text-[#374a57]">
                      {localizeBilling(client.billingStatus, locale)}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-white px-1 py-2">
                      <p className="text-[10px] text-[#50606a]">{t.tableCampaigns}</p>
                      <p className="text-sm font-semibold text-[#141f27]">{client.metrics.campaigns}</p>
                    </div>
                    <div className="rounded-lg bg-white px-1 py-2">
                      <p className="text-[10px] text-[#50606a]">{t.tableResponses}</p>
                      <p className="text-sm font-semibold text-[#141f27]">{client.metrics.totalResponses}</p>
                    </div>
                    <div className="rounded-lg bg-white px-1 py-2">
                      <p className="text-[10px] text-[#50606a]">{t.tableReports}</p>
                      <p className="text-sm font-semibold text-[#141f27]">{client.metrics.reports}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs font-semibold text-[#1e2b33]">
                    <span>{t.openProfile}</span>
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 text-[#445761] transition group-hover:translate-x-0.5">
                      <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-[#dcdcdc] bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-[#f2f2f2] text-left text-[#344451]">
                  <tr>
                    <th className="px-3 py-2 font-semibold">{t.tableCompany}</th>
                    <th className="px-3 py-2 font-semibold">{t.tableStatus}</th>
                    <th className="px-3 py-2 font-semibold">{t.tableBilling}</th>
                    <th className="px-3 py-2 font-semibold">{t.tableCampaigns}</th>
                    <th className="px-3 py-2 font-semibold">{t.tableResponses}</th>
                    <th className="px-3 py-2 font-semibold">{t.tableReports}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.map((client) => (
                    <tr key={client.id} className="border-t border-[#ececec] align-top">
                      <td className="px-3 py-3">
                        <Link href={`/manager/clients/${client.id}`} className="font-semibold text-[#101a21] hover:underline">
                          {client.companyName}
                        </Link>
                        <p className="text-xs text-[#4a5862]">CNPJ {client.cnpj}</p>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusBadgeClass(client.status)}`}>
                          {localizeStatus(client.status, locale)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[#374a57]">{localizeBilling(client.billingStatus, locale)}</td>
                      <td className="px-3 py-3 text-[#141f27]">{client.metrics.campaigns}</td>
                      <td className="px-3 py-3 text-[#141f27]">{client.metrics.totalResponses}</td>
                      <td className="px-3 py-3 text-[#141f27]">{client.metrics.reports}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-5">
          <article className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-[#123447]">{t.calendarTitle}</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => moveCalendarCursor(-1)}
                  className="rounded-full border border-[#c8c8c8] bg-white px-3 py-1 text-xs"
                >
                  {t.prevPeriod}
                </button>
                <button
                  type="button"
                  onClick={() => moveCalendarCursor(1)}
                  className="rounded-full border border-[#c8c8c8] bg-white px-3 py-1 text-xs"
                >
                  {t.nextPeriod}
                </button>
              </div>
            </div>
            <p className="mt-2 text-sm text-[#465864]">{calendarPeriodLabel}</p>
            <p className="mt-1 text-xs text-[#58717f]">{t.calendarHint}</p>
            <div className="mt-3 grid gap-2 lg:grid-cols-[auto_minmax(180px,220px)_minmax(260px,1fr)]">
              <div
                className="inline-flex items-center gap-1 rounded-xl border border-[#d0d5da] bg-white p-1"
                role="group"
                aria-label={t.calendarViewLabel}
              >
                {calendarViewOptions.map((viewOption) => (
                  <button
                    key={viewOption.id}
                    type="button"
                    onClick={() => setCalendarView(viewOption.id)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      calendarView === viewOption.id
                        ? "bg-[#111] text-white"
                        : "text-[#40515c] hover:bg-[#eff2f4]"
                    }`}
                  >
                    {viewOption.label}
                  </button>
                ))}
              </div>
              <label className="block">
                <span className="sr-only">{t.calendarClientFilterLabel}</span>
                <select
                  value={calendarClientFilter}
                  onChange={(event) => setCalendarClientFilter(event.target.value)}
                  className="w-full rounded-xl border border-[#d0d5da] bg-white px-3 py-2 text-sm text-[#1a2630] outline-none ring-[#7ba8c0] transition focus:ring-2"
                >
                  <option value="all">{t.calendarClientAll}</option>
                  <option value={UNLINKED_CLIENT_FILTER}>{t.calendarClientUnlinked}</option>
                  {calendarClientOptions.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="relative block">
                <span className="sr-only">{t.calendarSearchPlaceholder}</span>
                <input
                  value={calendarSearchQuery}
                  onChange={(event) => setCalendarSearchQuery(event.target.value)}
                  className="w-full rounded-xl border border-[#d0d5da] bg-white px-3 py-2.5 pr-10 text-sm text-[#1a2630] outline-none ring-[#7ba8c0] transition focus:ring-2"
                  placeholder={t.calendarSearchPlaceholder}
                />
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#60727f]"
                >
                  <path
                    d="M10.5 3a7.5 7.5 0 1 1 4.86 13.21l4.21 4.2-1.42 1.42-4.2-4.21A7.5 7.5 0 0 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"
                    fill="currentColor"
                  />
                </svg>
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#4f6977]">
              <span className="font-semibold">{t.calendarLegendLabel}:</span>
              <span className="rounded-full bg-[#e6f3f8] px-2 py-0.5 text-[#1f5f79]">
                {t.calendarLegendProvisory}
              </span>
              <span className="rounded-full bg-[#2f6f8d] px-2 py-0.5 text-white">
                {t.calendarLegendCommitted}
              </span>
            </div>
            {calendarIsolation.kind !== "none" ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#3e5a68]">
                <span>
                  {t.isolatedBy}: <strong>{calendarIsolation.label}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setCalendarIsolation({ kind: "none" })}
                  className="rounded-full border border-[#c8c8c8] bg-white px-3 py-1 font-semibold text-[#123447]"
                >
                  {t.clearIsolation}
                </button>
              </div>
            ) : null}
            {events.length === 0 ? (
              <p className="mt-4 text-sm text-[#5a7383]">{t.noCalendarEventsForFilters}</p>
            ) : calendarView === "month" ? (
              <div className="mt-4 grid grid-cols-7 gap-2">
                {WEEK_LABELS[locale].map((w) => (
                  <p key={w} className="text-center text-xs font-semibold text-[#5e7d8d]">
                    {w}
                  </p>
                ))}
                {monthDays.map((d) => (
                  <div
                    key={d.key}
                    className={`min-h-[170px] rounded-xl border p-2 xl:min-h-[190px] ${
                      d.inMonth ? "border-[#dbdbdb] bg-white" : "border-[#e8e8e8] bg-[#f1f1f1]"
                    }`}
                    onDragOver={(event) => {
                      if (!draggingEventId) return;
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (!draggingEventId) return;
                      const movedEventId = draggingEventId;
                      setDraggingEventId(null);
                      void moveCalendarEventToDay(movedEventId, d.value);
                    }}
                  >
                    <p className={`text-xs font-semibold ${d.inMonth ? "text-[#163748]" : "text-[#8497a4]"}`}>
                      {d.value.getDate()}
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {d.events.slice(0, MAX_EVENTS_PER_DAY).map((e) => (
                        <div
                          key={e.id}
                          className={`rounded-md border px-1.5 py-1 ${
                            e.type === "start"
                              ? "border-[#b9dfc6] bg-[#eaf8ef] text-[#1b5437]"
                              : e.type === "close"
                                ? "border-[#f2d6ad] bg-[#fff4e4] text-[#7a4b00]"
                                : e.type === "meeting"
                                  ? e.source.details.eventLifecycle === "committed"
                                    ? "border-[#2f6f8d] bg-[#2f6f8d] text-white"
                                    : "border-[#b8d8e6] bg-[#edf7fb] text-[#1f5f79]"
                                  : "border-[#efc1d6] bg-[#fcecf4] text-[#7a2755]"
                          }`}
                        >
                          <div className="flex items-start gap-1">
                            <button
                              type="button"
                              draggable={isEditableCalendarEvent(e.source)}
                              onDragStart={() => {
                                if (!isEditableCalendarEvent(e.source)) return;
                                setDraggingEventId(e.id);
                              }}
                              onDragEnd={() => setDraggingEventId(null)}
                              onClick={() => setSelectedCalendarEventId(e.id)}
                              className={`min-w-0 flex-1 text-left ${
                                isEditableCalendarEvent(e.source) ? "cursor-move" : "cursor-pointer"
                              }`}
                              title={`${e.title} - ${toDate(e.source.startsAt, locale)}`}
                            >
                              <p className="truncate text-[10px] font-semibold">{e.title}</p>
                              <p className="truncate text-[10px] opacity-90">{e.timeLabel}</p>
                              <p className="truncate text-[10px] opacity-90">{e.companyLabel}</p>
                              <p className="truncate text-[10px] opacity-90">
                                {e.typeLabel}
                                {e.lifecycleLabel ? ` . ${e.lifecycleLabel}` : ""}
                              </p>
                            </button>
                            {e.canDelete ? (
                              <button
                                type="button"
                                onClick={() => void deleteCalendarEvent(e.source)}
                                disabled={deletingEventId === e.id}
                                className={`rounded px-1 text-[11px] font-semibold ${
                                  e.source.details.eventLifecycle === "committed"
                                    ? "bg-white/30 text-current"
                                    : "bg-white/70 text-current"
                                } disabled:opacity-50`}
                                title={t.eventDeleteAction}
                                aria-label={t.eventDeleteAction}
                              >
                                {deletingEventId === e.id ? "..." : "x"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                      {d.events.length > MAX_EVENTS_PER_DAY ? (
                        <p className="text-[10px] text-[#527083]">
                          +{d.events.length - MAX_EVENTS_PER_DAY} {t.eventMoreCount}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`mt-4 grid gap-2 ${calendarView === "week" ? "md:grid-cols-7" : "grid-cols-1"}`}>
                {visibleCalendarDays.map((d) => (
                  <div
                    key={d.key}
                    className="min-h-[180px] rounded-xl border border-[#dbdbdb] bg-white p-2"
                    onDragOver={(event) => {
                      if (!draggingEventId) return;
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (!draggingEventId) return;
                      const movedEventId = draggingEventId;
                      setDraggingEventId(null);
                      void moveCalendarEventToDay(movedEventId, d.value);
                    }}
                  >
                    <p className="text-xs font-semibold text-[#163748]">
                      {calendarView === "week"
                        ? `${WEEK_LABELS[locale][d.value.getDay()]} ${d.value.getDate()}`
                        : dayLabel(d.value, locale)}
                    </p>
                    <div className="mt-2 space-y-2">
                      {d.events.length === 0 ? (
                        <p className="text-xs text-[#527083]">-</p>
                      ) : (
                        d.events.map((e) => (
                          <div
                            key={e.id}
                            className={`rounded-md border px-2 py-1.5 ${
                              e.type === "start"
                                ? "border-[#b9dfc6] bg-[#eaf8ef] text-[#1b5437]"
                                : e.type === "close"
                                  ? "border-[#f2d6ad] bg-[#fff4e4] text-[#7a4b00]"
                                  : e.type === "meeting"
                                    ? e.source.details.eventLifecycle === "committed"
                                      ? "border-[#2f6f8d] bg-[#2f6f8d] text-white"
                                      : "border-[#b8d8e6] bg-[#edf7fb] text-[#1f5f79]"
                                    : "border-[#efc1d6] bg-[#fcecf4] text-[#7a2755]"
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <button
                                type="button"
                                draggable={isEditableCalendarEvent(e.source)}
                                onDragStart={() => {
                                  if (!isEditableCalendarEvent(e.source)) return;
                                  setDraggingEventId(e.id);
                                }}
                                onDragEnd={() => setDraggingEventId(null)}
                                onClick={() => setSelectedCalendarEventId(e.id)}
                                className={`min-w-0 flex-1 text-left ${
                                  isEditableCalendarEvent(e.source) ? "cursor-move" : "cursor-pointer"
                                }`}
                                title={`${e.title} - ${toDate(e.source.startsAt, locale)}`}
                              >
                                <p className="truncate text-xs font-semibold">{e.title}</p>
                                <p className="truncate text-[11px] opacity-90">{e.timeLabel}</p>
                                <p className="truncate text-[11px] opacity-90">{e.companyLabel}</p>
                                <p className="truncate text-[11px] opacity-90">
                                  {e.typeLabel}
                                  {e.lifecycleLabel ? ` . ${e.lifecycleLabel}` : ""}
                                </p>
                              </button>
                              {e.canDelete ? (
                                <button
                                  type="button"
                                  onClick={() => void deleteCalendarEvent(e.source)}
                                  disabled={deletingEventId === e.id}
                                  className={`rounded px-1 text-[11px] font-semibold ${
                                    e.source.details.eventLifecycle === "committed"
                                      ? "bg-white/30 text-current"
                                      : "bg-white/70 text-current"
                                  } disabled:opacity-50`}
                                  title={t.eventDeleteAction}
                                  aria-label={t.eventDeleteAction}
                                >
                                  {deletingEventId === e.id ? "..." : "x"}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
            <div className="grid gap-4 xl:grid-cols-2">
              <section>
                <h4 className="text-base font-semibold text-[#123447]">{t.liveDrps}</h4>
                <div className="mt-3 overflow-x-auto rounded-lg border border-[#d8e4ee] bg-white">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="px-2 py-2 text-left">{t.drpsTableDiagnostic}</th>
                        <th className="px-2 py-2 text-left">{t.drpsTableCompany}</th>
                        <th className="px-2 py-2 text-left">{t.drpsTableStart}</th>
                        <th className="px-2 py-2 text-left">{t.drpsTableClose}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveCampaigns.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-2 py-3 text-xs text-[#5a7383]">
                            {t.noActiveCampaigns}
                          </td>
                        </tr>
                      ) : (
                        liveCampaigns.map((campaign) => {
                          const selected =
                            calendarIsolation.kind === "drps" &&
                            calendarIsolation.campaignId === campaign.id;
                          return (
                            <tr key={campaign.id} className={`border-b ${selected ? "bg-[#e8f3f8]" : ""}`}>
                              <td className="px-2 py-2">
                                <button
                                  type="button"
                                  onClick={() => toggleDrpsIsolation(campaign)}
                                  className="text-left font-semibold text-[#123447] hover:text-[#0f5b73] hover:underline"
                                >
                                  {campaign.name}
                                </button>
                              </td>
                              <td className="px-2 py-2 text-[#3e5a68]">{campaign.client_name ?? t.noLink}</td>
                              <td className="px-2 py-2 text-[#3e5a68]">
                                {campaign.starts_at ? toDate(campaign.starts_at, locale) : t.notPlanned}
                              </td>
                              <td className="px-2 py-2 text-[#3e5a68]">
                                {campaign.closes_at ? toDate(campaign.closes_at, locale) : t.notPlanned}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h4 className="text-base font-semibold text-[#123447]">{t.liveContinuous}</h4>
                <div className="mt-3 overflow-x-auto rounded-lg border border-[#d8e4ee] bg-white">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="px-2 py-2 text-left">{t.continuousTableProgram}</th>
                        <th className="px-2 py-2 text-left">{t.continuousTableCompany}</th>
                        <th className="px-2 py-2 text-left">{t.continuousTableSince}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveContinuousPrograms.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-2 py-3 text-xs text-[#5a7383]">
                            {t.noActiveContinuous}
                          </td>
                        </tr>
                      ) : (
                        liveContinuousPrograms.map((program) => {
                          const selected =
                            calendarIsolation.kind === "continuous" &&
                            calendarIsolation.assignmentId === program.id;
                          return (
                            <tr key={program.id} className={`border-b ${selected ? "bg-[#e8f3f8]" : ""}`}>
                              <td className="px-2 py-2">
                                <button
                                  type="button"
                                  onClick={() => toggleContinuousIsolation(program)}
                                  className="text-left font-semibold text-[#123447] hover:text-[#0f5b73] hover:underline"
                                >
                                  {program.programTitle}
                                </button>
                              </td>
                              <td className="px-2 py-2 text-[#3e5a68]">{program.clientName ?? t.noLink}</td>
                              <td className="px-2 py-2 text-[#3e5a68]">
                                {program.deployedAt ? toDate(program.deployedAt, locale) : t.notPlanned}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </article>

          <article className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
            <section className="rounded-lg border border-[#e2edf3] bg-white p-3">
              <h4 className="text-base font-semibold text-[#123447]">{t.blockWindowTitle}</h4>
              <div className="mt-2 space-y-2">
                <label className="block">
                  <span className="text-xs text-[#4d6a79]">{t.blockWindowClient}</span>
                  <select
                    value={blockClientId}
                    onChange={(event) => setBlockClientId(event.target.value)}
                    className="mt-1 w-full rounded border border-[#c8c8c8] px-2 py-1 text-xs"
                  >
                    <option value="">{t.blockWindowGeneral}</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.companyName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-[#4d6a79]">{t.blockWindowLabel}</span>
                  <input
                    value={blockTitle}
                    onChange={(event) => setBlockTitle(event.target.value)}
                    className="mt-1 w-full rounded border border-[#c8c8c8] px-2 py-1 text-xs"
                  />
                </label>
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="block">
                    <span className="text-xs text-[#4d6a79]">{t.blockWindowStart}</span>
                    <input
                      type="datetime-local"
                      value={blockStartsAt}
                      onChange={(event) => setBlockStartsAt(event.target.value)}
                      className="mt-1 w-full rounded border border-[#c8c8c8] px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-[#4d6a79]">{t.blockWindowEnd}</span>
                    <input
                      type="number"
                      min={15}
                      max={24 * 60}
                      step={5}
                      value={blockDurationMinutes}
                      onChange={(event) => setBlockDurationMinutes(event.target.value)}
                      className="mt-1 w-full rounded border border-[#c8c8c8] px-2 py-1 text-xs"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => void createBlockedWindow()}
                  disabled={isSavingBlock}
                  className="rounded-full border border-[#c8c8c8] bg-white px-3 py-1 text-xs font-semibold text-[#123447] disabled:opacity-50"
                >
                  {isSavingBlock ? t.blockWindowSaving : t.blockWindowSave}
                </button>
                {blockFeedback ? <p className="text-xs text-[#4d6a79]">{blockFeedback}</p> : null}
              </div>
            </section>
          </article>
        </section>
      )}

      {selectedCalendarEvent ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          onClick={() => setSelectedCalendarEventId(null)}
        >
          <article
            className="w-full max-w-3xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-lg font-semibold text-[#123447]">{t.eventDetailsTitle}</h4>
              <button
                type="button"
                onClick={() => setSelectedCalendarEventId(null)}
                className="rounded-full border border-[#cad8e2] px-3 py-1 text-xs font-semibold text-[#123447]"
              >
                {t.eventCloseAction}
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-[#e0e9ee] bg-[#f7fbfd] p-3">
                <p className="text-xs text-[#4d6a79]">{t.eventDetailsType}</p>
                <p className="text-sm font-semibold text-[#123447]">{selectedEventTypeLabel}</p>
              </div>
              <div className="rounded-lg border border-[#e0e9ee] bg-[#f7fbfd] p-3">
                <p className="text-xs text-[#4d6a79]">{t.eventDetailsCompany}</p>
                <p className="text-sm font-semibold text-[#123447]">
                  {selectedCalendarEvent.clientName ?? t.noCompany}
                </p>
              </div>
              <div className="rounded-lg border border-[#e0e9ee] bg-[#f7fbfd] p-3 md:col-span-2">
                <p className="text-xs text-[#4d6a79]">{t.eventDetailsWhen}</p>
                <p className="text-sm font-semibold text-[#123447]">{toDate(selectedCalendarEvent.startsAt, locale)}</p>
              </div>
              <div className="rounded-lg border border-[#e0e9ee] bg-[#f7fbfd] p-3 md:col-span-2">
                <p className="text-xs text-[#4d6a79]">{t.eventDetailsDuration}</p>
                <p className="text-sm font-semibold text-[#123447]">
                  {durationMinutesFromRange(selectedCalendarEvent.startsAt, selectedCalendarEvent.endsAt, 60)} min
                </p>
              </div>
              <div className="rounded-lg border border-[#e0e9ee] bg-[#f7fbfd] p-3 md:col-span-2">
                <p className="text-xs text-[#4d6a79]">{t.eventDetailsLifecycle}</p>
                <p className="text-sm font-semibold text-[#123447]">{selectedLifecycleLabel}</p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-[#e0e9ee] p-3">
                <p className="text-xs text-[#4d6a79]">{t.eventDetailsContent}</p>
                <p className="mt-1 text-sm text-[#123447]">
                  {selectedCalendarEvent.details?.content ?? t.eventDetailsNoContent}
                </p>
              </div>
              <div className="rounded-lg border border-[#e0e9ee] p-3">
                <p className="text-xs text-[#4d6a79]">{t.eventDetailsPreparation}</p>
                <p className="mt-1 text-sm text-[#123447]">
                  {selectedCalendarEvent.details?.preparationRequired ?? t.eventDetailsNoPreparation}
                </p>
              </div>
            </div>

            {selectedCalendarEventLink ? (
              <div className="mt-3">
                <Link
                  href={selectedCalendarEventLink.href}
                  className="inline-flex rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                >
                  {selectedCalendarEventLink.label}
                </Link>
              </div>
            ) : null}

            {isEditableCalendarEvent(selectedCalendarEvent) ? (
              <div className="mt-4 space-y-3 rounded-lg border border-[#d8e4ee] bg-[#f8fbfd] p-3">
                <label className="block">
                  <span className="text-xs text-[#4d6a79]">{t.eventEditTitleLabel}</span>
                  <input
                    value={eventEditTitle}
                    onChange={(event) => setEventEditTitle(event.target.value)}
                    className="mt-1 w-full rounded border border-[#c8d7e1] px-2 py-1.5 text-sm"
                  />
                </label>
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="block">
                    <span className="text-xs text-[#4d6a79]">{t.eventEditStartLabel}</span>
                    <input
                      type="datetime-local"
                      value={eventEditStartsAt}
                      onChange={(event) => setEventEditStartsAt(event.target.value)}
                      className="mt-1 w-full rounded border border-[#c8d7e1] px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-[#4d6a79]">{t.eventEditEndLabel}</span>
                    <input
                      type="number"
                      min={15}
                      max={24 * 60}
                      step={5}
                      value={eventEditDurationMinutes}
                      onChange={(event) => setEventEditDurationMinutes(event.target.value)}
                      className="mt-1 w-full rounded border border-[#c8d7e1] px-2 py-1.5 text-sm"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-xs text-[#4d6a79]">{t.eventEditLifecycleLabel}</span>
                  <select
                    value={eventEditLifecycle}
                    onChange={(event) =>
                      setEventEditLifecycle(event.target.value as "provisory" | "committed")
                    }
                    disabled={!canEditSelectedLifecycle}
                    className="mt-1 w-full rounded border border-[#c8d7e1] px-2 py-1.5 text-sm disabled:opacity-60"
                  >
                    <option value="provisory">{t.eventLifecycleProvisory}</option>
                    <option value="committed">{t.eventLifecycleCommitted}</option>
                  </select>
                </label>
                {selectedCalendarEvent.eventType === "continuous_meeting" &&
                selectedCalendarEvent.details.proposalKind === "assignment" ? (
                  <p className="text-[11px] text-[#4f6977]">{t.eventLifecycleProfileHint}</p>
                ) : null}
                <label className="block">
                  <span className="text-xs text-[#4d6a79]">{t.eventDetailsContent}</span>
                  <textarea
                    rows={3}
                    value={eventEditContent}
                    onChange={(event) => setEventEditContent(event.target.value)}
                    className="mt-1 w-full rounded border border-[#c8d7e1] px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-[#4d6a79]">{t.eventDetailsPreparation}</span>
                  <textarea
                    rows={3}
                    value={eventEditPreparation}
                    onChange={(event) => setEventEditPreparation(event.target.value)}
                    className="mt-1 w-full rounded border border-[#c8d7e1] px-2 py-1.5 text-sm"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void saveSelectedCalendarEvent()}
                    disabled={isSavingEventEdit || deletingEventId === selectedCalendarEvent.id}
                    className="rounded-full bg-[#123447] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {isSavingEventEdit ? t.eventEditSaving : t.eventEditSave}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteCalendarEvent(selectedCalendarEvent)}
                    disabled={isSavingEventEdit || deletingEventId === selectedCalendarEvent.id}
                    className="rounded-full border border-[#9d304e] px-4 py-2 text-xs font-semibold text-[#9d304e] disabled:opacity-50"
                  >
                    {deletingEventId === selectedCalendarEvent.id ? t.eventDeleting : t.eventDeleteAction}
                  </button>
                </div>
                {canCommitSelectedReschedule ? (
                  <button
                    type="button"
                    onClick={() => void commitSelectedReschedule()}
                    disabled={isSavingEventEdit || deletingEventId === selectedCalendarEvent.id}
                    className="rounded-full border border-[#0f5b73] px-4 py-2 text-xs font-semibold text-[#0f5b73] disabled:opacity-50"
                  >
                    {t.eventCommitReschedule}
                  </button>
                ) : null}
                {eventEditFeedback ? <p className="text-xs text-[#365160]">{eventEditFeedback}</p> : null}
              </div>
            ) : (
              <p className="mt-4 text-xs text-[#5a7383]">{t.eventReadOnly}</p>
            )}
          </article>
        </div>
      ) : null}
    </div>
  );
}
