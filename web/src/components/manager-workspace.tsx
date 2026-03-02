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

const WEEK_LABELS = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  pt: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"],
} as const;

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
    prevMonth: "Previous month",
    nextMonth: "Next month",
    liveDrps: "Active DRPS diagnostics",
    noActiveCampaigns: "No active DRPS diagnostics.",
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
    prevMonth: "Mes anterior",
    nextMonth: "Proximo",
    liveDrps: "Diagnosticos DRPS ativos",
    noActiveCampaigns: "Nenhum diagnostico DRPS ativo.",
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

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function monthLabel(date: Date, locale: ManagerLocale) {
  return new Intl.DateTimeFormat(uiLocale(locale), { month: "long", year: "numeric" }).format(date);
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
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [clients, setClients] = useState<Client[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [clientStatusFilter, setClientStatusFilter] = useState<ClientStatusFilter>("all");
  const [billingFilter, setBillingFilter] = useState<BillingFilter>("all");
  const [clientListView, setClientListView] = useState<ClientListView>("cards");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [clientsRes, campaignsRes] = await Promise.all([
        fetch("/api/admin/clients", { cache: "no-store" }),
        fetch("/api/admin/campaigns", { cache: "no-store" }),
      ]);
      if (!clientsRes.ok) throw new Error(t.loadClientsError);
      const clientsPayload = (await clientsRes.json()) as { clients: Client[] };
      const campaignsPayload = campaignsRes.ok
        ? ((await campaignsRes.json()) as { campaigns: Campaign[] })
        : { campaigns: [] as Campaign[] };
      setClients(clientsPayload.clients ?? []);
      setCampaigns(campaignsPayload.campaigns ?? []);
      if (!campaignsRes.ok) {
        setError(t.campaignsDownError);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t.workspaceLoadError);
    } finally {
      setLoading(false);
    }
  }, [t.campaignsDownError, t.loadClientsError, t.workspaceLoadError]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const events = useMemo(() => {
    const list: Array<{ key: string; title: string; type: "start" | "close" | "created"; client: string }> = [];
    for (const campaign of campaigns) {
      const client = campaign.client_name ?? t.noCompany;
      const rows: Array<{ date?: string | null; type: "start" | "close" | "created"; title: string }> = [
        { date: campaign.created_at, type: "created", title: `${t.eventCreated}: ${campaign.name}` },
        { date: campaign.starts_at, type: "start", title: `${t.eventStart}: ${campaign.name}` },
        { date: campaign.closes_at, type: "close", title: `${t.eventClose}: ${campaign.name}` },
      ];
      for (const row of rows) {
        if (!row.date) continue;
        const value = new Date(row.date);
        if (Number.isNaN(value.getTime())) continue;
        list.push({ key: dayKey(value), title: row.title, type: row.type, client });
      }
    }
    return list;
  }, [campaigns, t.eventClose, t.eventCreated, t.eventStart, t.noCompany]);

  const byDay = useMemo(() => {
    const map = new Map<string, typeof events>();
    for (const event of events) map.set(event.key, [...(map.get(event.key) ?? []), event]);
    return map;
  }, [events]);

  const days = useMemo(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const gridStart = new Date(start);
    gridStart.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, idx) => {
      const value = new Date(gridStart);
      value.setDate(gridStart.getDate() + idx);
      const key = dayKey(value);
      return { value, key, inMonth: value.getMonth() === month.getMonth(), events: byDay.get(key) ?? [] };
    });
  }, [month, byDay]);

  const liveCampaigns = useMemo(() => campaigns.filter((c) => c.status === "live"), [campaigns]);

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
        <section className="grid gap-5 xl:grid-cols-[1.15fr_1fr]">
          <article className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-[#123447]">{t.calendarTitle}</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMonth((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1))}
                  className="rounded-full border border-[#c8c8c8] bg-white px-3 py-1 text-xs"
                >
                  {t.prevMonth}
                </button>
                <button
                  type="button"
                  onClick={() => setMonth((p) => new Date(p.getFullYear(), p.getMonth() + 1, 1))}
                  className="rounded-full border border-[#c8c8c8] bg-white px-3 py-1 text-xs"
                >
                  {t.nextMonth}
                </button>
              </div>
            </div>
            <p className="mt-2 text-sm text-[#465864]">{monthLabel(month, locale)}</p>
            <div className="mt-4 grid grid-cols-7 gap-2">
              {WEEK_LABELS[locale].map((w) => (
                <p key={w} className="text-center text-xs font-semibold text-[#5e7d8d]">
                  {w}
                </p>
              ))}
              {days.map((d) => (
                <div
                  key={d.key}
                  className={`min-h-[110px] rounded-xl border p-2 ${
                    d.inMonth ? "border-[#dbdbdb] bg-white" : "border-[#e8e8e8] bg-[#f1f1f1]"
                  }`}
                >
                  <p className={`text-xs font-semibold ${d.inMonth ? "text-[#163748]" : "text-[#8497a4]"}`}>
                    {d.value.getDate()}
                  </p>
                  <div className="mt-1 space-y-1">
                    {d.events.slice(0, 3).map((e, idx) => (
                      <p
                        key={`${e.key}-${idx}`}
                        className={`rounded px-1 py-0.5 text-[10px] ${
                          e.type === "start"
                            ? "bg-[#e2f4ea] text-[#1f5b38]"
                            : e.type === "close"
                              ? "bg-[#fff3df] text-[#7a4b00]"
                              : "bg-[#e8f3f8] text-[#0f5b73]"
                        }`}
                        title={e.title}
                      >
                        {e.client}
                      </p>
                    ))}
                    {d.events.length > 3 ? <p className="text-[10px] text-[#527083]">+{d.events.length - 3}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
            <h4 className="text-base font-semibold text-[#123447]">{t.liveDrps}</h4>
            <div className="mt-3 space-y-2">
              {liveCampaigns.length === 0 ? (
                <p className="text-sm text-[#5a7383]">{t.noActiveCampaigns}</p>
              ) : (
                liveCampaigns.map((campaign) => (
                  <article key={campaign.id} className="rounded-lg border border-[#e2edf3] bg-white p-3">
                    <p className="text-sm font-semibold text-[#163748]">{campaign.name}</p>
                    <p className="text-xs text-[#4d6a79]">{campaign.client_name ?? t.noLink}</p>
                    <p className="text-xs text-[#4d6a79]">
                      {t.startLabel}: {campaign.starts_at ? toDate(campaign.starts_at, locale) : t.notPlanned}
                    </p>
                  </article>
                ))
              )}
            </div>
          </article>
        </section>
      )}
    </div>
  );
}
