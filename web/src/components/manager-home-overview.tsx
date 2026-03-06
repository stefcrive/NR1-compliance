"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { type ManagerLocale, useManagerLocale } from "@/components/manager-locale";

type Campaign = {
  id: string;
  name: string;
  status: "draft" | "live" | "closed" | "archived";
  client_id?: string | null;
  client_name?: string | null;
  starts_at?: string | null;
  closes_at?: string | null;
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
    eventLifecycle: "provisory" | "committed";
    proposalKind: "assignment" | "reschedule" | null;
    content: string | null;
    preparationRequired: string | null;
    availabilityRequestId: string | null;
  };
};

type ActiveContinuousProgram = {
  id: string;
  clientId: string;
  clientName: string | null;
  programTitle: string;
  deployedAt: string | null;
  status: "Recommended" | "Active" | "Completed";
};

const COPY = {
  en: {
    pageTitle: "Home",
    loading: "Loading...",
    workspaceLoadError: "Failed to load manager home.",
    campaignsLoadError: "Could not load active DRPS diagnostics.",
    calendarLoadError: "Could not load calendar data.",
    noCompany: "No company",
    upcomingEventsTitle: "Upcoming confirmed calendar events",
    noUpcomingEvents: "No upcoming confirmed calendar events.",
    eventTypeDrpsStart: "DRPS start",
    eventTypeDrpsClose: "DRPS close",
    eventTypeMeeting: "Continuous meeting",
    eventTypeBlocked: "Blocked time",
    activeDrpsTableTitle: "Active DRPS diagnostics",
    activeProgramsTableTitle: "Active continuous programs",
    tableName: "Name",
    tableProgram: "Program",
    tableCompany: "Company",
    tableStart: "Start",
    tableClose: "Close",
    tableSince: "Since",
    noActiveCampaigns: "No active DRPS diagnostics.",
    noActivePrograms: "No active continuous programs.",
    openItem: "Open",
    notPlanned: "not planned",
  },
  pt: {
    pageTitle: "Inicio",
    loading: "Carregando...",
    workspaceLoadError: "Erro ao carregar a home do gestor.",
    campaignsLoadError: "Nao foi possivel carregar os DRPS ativos.",
    calendarLoadError: "Nao foi possivel carregar os dados do calendario.",
    noCompany: "Sem empresa",
    upcomingEventsTitle: "Proximos eventos confirmados do calendario",
    noUpcomingEvents: "Nenhum proximo evento confirmado no calendario.",
    eventTypeDrpsStart: "Inicio DRPS",
    eventTypeDrpsClose: "Fechamento DRPS",
    eventTypeMeeting: "Reuniao continua",
    eventTypeBlocked: "Bloqueio",
    activeDrpsTableTitle: "DRPS ativos",
    activeProgramsTableTitle: "Programas continuos ativos",
    tableName: "Nome",
    tableProgram: "Programa",
    tableCompany: "Empresa",
    tableStart: "Inicio",
    tableClose: "Fechamento",
    tableSince: "Ativo desde",
    noActiveCampaigns: "Nenhum diagnostico DRPS ativo.",
    noActivePrograms: "Nenhum programa continuo ativo.",
    openItem: "Abrir",
    notPlanned: "nao planejado",
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

function extractCampaignIdFromCalendarEvent(event: MasterCalendarEvent) {
  if (event.eventType !== "drps_start" && event.eventType !== "drps_close") return null;
  if (event.id.startsWith("drps-start-")) return event.id.slice("drps-start-".length);
  if (event.id.startsWith("drps-close-")) return event.id.slice("drps-close-".length);
  return null;
}

export function ManagerHomeOverview() {
  const { locale } = useManagerLocale();
  const t = COPY[locale];

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<MasterCalendarEvent[]>([]);
  const [activeContinuousPrograms, setActiveContinuousPrograms] = useState<ActiveContinuousProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadHome() {
      setLoading(true);
      setError("");
      try {
        const [campaignsRes, calendarRes] = await Promise.all([
          fetch("/api/admin/campaigns", { cache: "no-store" }),
          fetch("/api/admin/calendar", { cache: "no-store" }),
        ]);

        const campaignsPayload = campaignsRes.ok
          ? ((await campaignsRes.json()) as { campaigns: Campaign[] })
          : { campaigns: [] as Campaign[] };
        const calendarPayload = calendarRes.ok
          ? ((await calendarRes.json()) as {
              events: MasterCalendarEvent[];
              activeContinuousPrograms?: ActiveContinuousProgram[];
            })
          : { events: [] as MasterCalendarEvent[], activeContinuousPrograms: [] as ActiveContinuousProgram[] };

        if (!active) return;

        setCampaigns(campaignsPayload.campaigns ?? []);
        setCalendarEvents(calendarPayload.events ?? []);
        setActiveContinuousPrograms(calendarPayload.activeContinuousPrograms ?? []);

        if (!campaignsRes.ok) {
          setError(t.campaignsLoadError);
        } else if (!calendarRes.ok) {
          setError(t.calendarLoadError);
        }
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : t.workspaceLoadError);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadHome();

    return () => {
      active = false;
    };
  }, [t.calendarLoadError, t.campaignsLoadError, t.workspaceLoadError]);

  const upcomingEvents = useMemo(
    () => {
      const now = Date.now();
      return calendarEvents
        .filter((event) => event.status === "scheduled")
        .filter((event) => event.details.eventLifecycle === "committed")
        .filter((event) => new Date(event.startsAt).getTime() >= now)
        .slice()
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    },
    [calendarEvents],
  );

  const liveCampaigns = useMemo(
    () =>
      campaigns
        .filter(
          (campaign) =>
            campaign.status === "live" &&
            typeof campaign.client_id === "string" &&
            campaign.client_id.length > 0,
        )
        .slice()
        .sort((a, b) => {
          const left = a.starts_at ? new Date(a.starts_at).getTime() : Number.MAX_SAFE_INTEGER;
          const right = b.starts_at ? new Date(b.starts_at).getTime() : Number.MAX_SAFE_INTEGER;
          return left - right;
        }),
    [campaigns],
  );

  const liveContinuousPrograms = useMemo(
    () =>
      activeContinuousPrograms
        .filter((program) => program.status === "Active")
        .slice()
        .sort((a, b) => {
          const left = a.deployedAt ? new Date(a.deployedAt).getTime() : Number.MAX_SAFE_INTEGER;
          const right = b.deployedAt ? new Date(b.deployedAt).getTime() : Number.MAX_SAFE_INTEGER;
          return left - right;
        }),
    [activeContinuousPrograms],
  );

  function eventTypeLabel(event: MasterCalendarEvent) {
    if (event.eventType === "drps_start") return t.eventTypeDrpsStart;
    if (event.eventType === "drps_close") return t.eventTypeDrpsClose;
    if (event.eventType === "continuous_meeting") return t.eventTypeMeeting;
    return t.eventTypeBlocked;
  }

  function eventHref(event: MasterCalendarEvent) {
    if (event.eventType === "drps_start" || event.eventType === "drps_close") {
      const campaignId = extractCampaignIdFromCalendarEvent(event);
      if (!campaignId) return null;
      const campaign = campaigns.find((item) => item.id === campaignId) ?? null;
      const clientId = event.clientId ?? campaign?.client_id ?? null;
      return clientId
        ? `/manager/clients/${clientId}/diagnostic/${campaignId}?from=home`
        : `/manager/programs/drps/${campaignId}`;
    }
    if (event.eventType === "continuous_meeting" && event.sourceClientProgramId) {
      const assignment =
        activeContinuousPrograms.find((item) => item.id === event.sourceClientProgramId) ?? null;
      if (!assignment) return null;
      return `/manager/clients/${assignment.clientId}/assigned-continuous/${assignment.id}`;
    }
    return null;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm md:p-6">
        <h3 className="text-2xl font-semibold text-[#121b22] md:text-3xl">{t.pageTitle}</h3>
        {loading ? <p className="mt-3 text-sm text-[#4f5f6a]">{t.loading}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm md:p-6">
        <h4 className="text-lg font-semibold text-[#123447]">{t.upcomingEventsTitle}</h4>
        {upcomingEvents.length === 0 ? (
          <p className="mt-3 text-sm text-[#5a7383]">{t.noUpcomingEvents}</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {upcomingEvents.map((event) => {
              const href = eventHref(event);
              return (
                <li key={event.id} className="rounded-md border border-[#d8e4ee] bg-white px-2.5 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-[#123447]">{toDate(event.startsAt, locale)}</span>
                    <span className="rounded-full bg-[#eef4f8] px-1.5 py-0.5 text-[11px] font-semibold text-[#365d72]">
                      {eventTypeLabel(event)}
                    </span>
                    {href ? (
                      <Link href={href} className="ml-auto inline-flex font-semibold text-[#0f5b73] hover:underline">
                        {t.openItem}
                      </Link>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-sm text-[#1e3644]">
                    <span className="font-medium">{event.title}</span>
                    <span className="text-xs text-[#5a7383]"> - {event.clientName ?? t.noCompany}</span>
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm md:p-6">
        <div className="grid gap-4 xl:grid-cols-2">
          <section>
            <h4 className="text-lg font-semibold text-[#123447]">{t.activeDrpsTableTitle}</h4>
            <div className="mt-3 overflow-x-auto">
              <table className="nr-table min-w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left">{t.tableName}</th>
                    <th className="px-2 py-2 text-left">{t.tableCompany}</th>
                    <th className="px-2 py-2 text-left">{t.tableStart}</th>
                    <th className="px-2 py-2 text-left">{t.tableClose}</th>
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
                    liveCampaigns.map((campaign) => (
                      <tr key={campaign.id} className="border-b">
                        <td className="px-2 py-2">
                          <Link
                            href={`/manager/clients/${campaign.client_id}/diagnostic/${campaign.id}?from=home`}
                            className="font-semibold text-[#123447] hover:text-[#0f5b73] hover:underline"
                          >
                            {campaign.name}
                          </Link>
                        </td>
                        <td className="px-2 py-2">{campaign.client_name ?? t.noCompany}</td>
                        <td className="px-2 py-2">
                          {campaign.starts_at ? toDate(campaign.starts_at, locale) : t.notPlanned}
                        </td>
                        <td className="px-2 py-2">
                          {campaign.closes_at ? toDate(campaign.closes_at, locale) : t.notPlanned}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h4 className="text-lg font-semibold text-[#123447]">{t.activeProgramsTableTitle}</h4>
            <div className="mt-3 overflow-x-auto">
              <table className="nr-table min-w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left">{t.tableProgram}</th>
                    <th className="px-2 py-2 text-left">{t.tableCompany}</th>
                    <th className="px-2 py-2 text-left">{t.tableSince}</th>
                  </tr>
                </thead>
                <tbody>
                  {liveContinuousPrograms.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-2 py-3 text-xs text-[#5a7383]">
                        {t.noActivePrograms}
                      </td>
                    </tr>
                  ) : (
                    liveContinuousPrograms.map((program) => (
                      <tr key={program.id} className="border-b">
                        <td className="px-2 py-2">
                          <Link
                            href={`/manager/clients/${program.clientId}/assigned-continuous/${program.id}`}
                            className="font-semibold text-[#123447] hover:text-[#0f5b73] hover:underline"
                          >
                            {program.programTitle}
                          </Link>
                        </td>
                        <td className="px-2 py-2">{program.clientName ?? t.noCompany}</td>
                        <td className="px-2 py-2">
                          {program.deployedAt ? toDate(program.deployedAt, locale) : t.notPlanned}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
