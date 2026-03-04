"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { type ManagerLocale, useManagerLocale } from "@/components/manager-locale";

type EventRecordPayload = {
  record: {
    id: string;
    recordType: "calendar" | "drps";
    eventType: "drps_start" | "drps_close" | "continuous_meeting" | "blocked";
    title: string;
    status: "scheduled" | "completed" | "cancelled";
    startsAt: string;
    endsAt: string;
    clientId: string | null;
    clientName: string | null;
    clientPortalSlug: string | null;
    sourceClientProgramId: string | null;
    sourceCampaignId: string | null;
    details: {
      content: string | null;
      preparationRequired: string | null;
      eventLifecycle: "provisory" | "committed";
      proposalKind: "assignment" | "reschedule" | null;
      availabilityRequestId: string | null;
    };
    related: {
      campaign: {
        id: string;
        name: string;
        publicSlug: string | null;
        status: string;
        startsAt: string | null;
        closesAt: string | null;
      } | null;
      programAssignment: {
        id: string;
        clientId: string;
        programId: string;
        programTitle: string;
        status: "Recommended" | "Active" | "Completed";
        deployedAt: string | null;
      } | null;
    };
    diagnostics: {
      responseCount: number;
      latestResponseAt: string | null;
      latestDrpsResult: {
        id: string;
        sector: string;
        referencePeriod: string;
        probabilityScore: number;
        probabilityClass: "low" | "medium" | "high";
        recommendedPrograms: string[];
        governanceActions: string[];
        createdAt: string;
      } | null;
      drpsUnavailable: boolean;
    } | null;
  };
};

const COPY = {
  en: {
    breadcrumbHistory: "History",
    pageTitle: "Event Record",
    loading: "Loading event record...",
    loadError: "Could not load event record.",
    eventType: "Type",
    eventStatus: "Status",
    eventWhen: "When",
    eventDuration: "Duration",
    eventCompany: "Company",
    eventLifecycle: "Lifecycle",
    eventProposal: "Proposal",
    eventContent: "Content",
    eventPreparation: "Preparation",
    eventNoText: "No details registered.",
    diagnosticsTitle: "Diagnostic Snapshot",
    diagnosticsResponses: "Responses",
    diagnosticsLatestResponse: "Latest response",
    diagnosticsResult: "Latest DRPS result",
    diagnosticsUnavailable: "DRPS result snapshots are unavailable.",
    relatedTitle: "Related records",
    relatedCampaign: "Diagnostic",
    relatedProgram: "Assigned program",
    openCampaign: "Open DRPS",
    openProgram: "Open program",
    noCompany: "No company",
    noRelated: "No related records.",
    eventTypeDrpsStart: "DRPS start",
    eventTypeDrpsClose: "DRPS close",
    eventTypeMeeting: "Continuous meeting",
    eventTypeBlocked: "Blocked time",
    statusScheduled: "Scheduled",
    statusCompleted: "Completed",
    statusCancelled: "Cancelled",
    lifecycleCommitted: "Committed",
    lifecycleProvisory: "Provisory",
    proposalAssignment: "Cadence assignment",
    proposalReschedule: "Reschedule request",
    proposalNone: "No proposal",
    probabilityLow: "Low",
    probabilityMedium: "Medium",
    probabilityHigh: "High",
  },
  pt: {
    breadcrumbHistory: "Historico",
    pageTitle: "Ficha do Evento",
    loading: "Carregando ficha do evento...",
    loadError: "Nao foi possivel carregar a ficha do evento.",
    eventType: "Tipo",
    eventStatus: "Status",
    eventWhen: "Quando",
    eventDuration: "Duracao",
    eventCompany: "Empresa",
    eventLifecycle: "Ciclo",
    eventProposal: "Proposta",
    eventContent: "Conteudo",
    eventPreparation: "Preparacao",
    eventNoText: "Sem detalhes cadastrados.",
    diagnosticsTitle: "Snapshot Diagnostico",
    diagnosticsResponses: "Respostas",
    diagnosticsLatestResponse: "Ultima resposta",
    diagnosticsResult: "Ultimo resultado DRPS",
    diagnosticsUnavailable: "Snapshots DRPS indisponiveis.",
    relatedTitle: "Registros relacionados",
    relatedCampaign: "Diagnostico",
    relatedProgram: "Programa atribuido",
    openCampaign: "Abrir DRPS",
    openProgram: "Abrir programa",
    noCompany: "Sem empresa",
    noRelated: "Sem registros relacionados.",
    eventTypeDrpsStart: "Inicio DRPS",
    eventTypeDrpsClose: "Fechamento DRPS",
    eventTypeMeeting: "Reuniao continua",
    eventTypeBlocked: "Bloqueio",
    statusScheduled: "Agendado",
    statusCompleted: "Concluido",
    statusCancelled: "Cancelado",
    lifecycleCommitted: "Commitado",
    lifecycleProvisory: "Provisorio",
    proposalAssignment: "Atribuicao de cadencia",
    proposalReschedule: "Pedido de reagendamento",
    proposalNone: "Sem proposta",
    probabilityLow: "Baixa",
    probabilityMedium: "Media",
    probabilityHigh: "Alta",
  },
} as const;

function uiLocale(locale: ManagerLocale) {
  return locale === "pt" ? "pt-BR" : "en-US";
}

function fmtDateTime(value: string | null | undefined, locale: ManagerLocale) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(uiLocale(locale), { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

function eventTypeLabel(
  value: "drps_start" | "drps_close" | "continuous_meeting" | "blocked",
  locale: ManagerLocale,
) {
  const t = COPY[locale];
  if (value === "drps_start") return t.eventTypeDrpsStart;
  if (value === "drps_close") return t.eventTypeDrpsClose;
  if (value === "continuous_meeting") return t.eventTypeMeeting;
  return t.eventTypeBlocked;
}

function eventStatusLabel(
  value: "scheduled" | "completed" | "cancelled",
  locale: ManagerLocale,
) {
  const t = COPY[locale];
  if (value === "scheduled") return t.statusScheduled;
  if (value === "completed") return t.statusCompleted;
  return t.statusCancelled;
}

function lifecycleLabel(value: "provisory" | "committed", locale: ManagerLocale) {
  return value === "committed" ? COPY[locale].lifecycleCommitted : COPY[locale].lifecycleProvisory;
}

function proposalLabel(value: "assignment" | "reschedule" | null, locale: ManagerLocale) {
  const t = COPY[locale];
  if (value === "assignment") return t.proposalAssignment;
  if (value === "reschedule") return t.proposalReschedule;
  return t.proposalNone;
}

function probabilityLabel(value: "low" | "medium" | "high", locale: ManagerLocale) {
  const t = COPY[locale];
  if (value === "low") return t.probabilityLow;
  if (value === "medium") return t.probabilityMedium;
  return t.probabilityHigh;
}

function durationMinutes(startsAt: string, endsAt: string) {
  const starts = new Date(startsAt).getTime();
  const ends = new Date(endsAt).getTime();
  if (!Number.isFinite(starts) || !Number.isFinite(ends)) return "-";
  const duration = Math.max(0, Math.round((ends - starts) / (60 * 1000)));
  return `${duration} min`;
}

export function ManagerHistoryEventRecord({ eventId }: { eventId: string }) {
  const { locale } = useManagerLocale();
  const t = COPY[locale];

  const [payload, setPayload] = useState<EventRecordPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadRecord = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/history/events/${encodeURIComponent(eventId)}`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as EventRecordPayload & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? t.loadError);
      }
      setPayload(body);
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : t.loadError);
    } finally {
      setLoading(false);
    }
  }, [eventId, t.loadError]);

  useEffect(() => {
    void loadRecord();
  }, [loadRecord]);

  const record = payload?.record ?? null;
  const hasRelated = useMemo(
    () => Boolean(record?.related.campaign || record?.related.programAssignment),
    [record?.related.campaign, record?.related.programAssignment],
  );

  return (
    <div className="space-y-5">
      <nav className="text-xs text-[#4f6977]">
        <Link href="/manager/history" className="text-[#0f5b73] hover:underline">
          {t.breadcrumbHistory}
        </Link>{" "}
        / <span>{t.pageTitle}</span>
      </nav>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#121b22]">{t.pageTitle}</h2>
        {loading ? <p className="mt-3 text-sm text-[#4f5f6a]">{t.loading}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </section>

      {record ? (
        <>
          <section className="grid gap-3 rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm md:grid-cols-2 xl:grid-cols-3">
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">{t.eventType}</p>
              <p className="text-sm font-semibold text-[#123447]">{eventTypeLabel(record.eventType, locale)}</p>
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">{t.eventStatus}</p>
              <p className="text-sm font-semibold text-[#123447]">{eventStatusLabel(record.status, locale)}</p>
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">{t.eventWhen}</p>
              <p className="text-sm font-semibold text-[#123447]">{fmtDateTime(record.startsAt, locale)}</p>
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">{t.eventDuration}</p>
              <p className="text-sm font-semibold text-[#123447]">
                {durationMinutes(record.startsAt, record.endsAt)}
              </p>
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">{t.eventCompany}</p>
              <p className="text-sm font-semibold text-[#123447]">{record.clientName ?? t.noCompany}</p>
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">{t.eventLifecycle}</p>
              <p className="text-sm font-semibold text-[#123447]">
                {lifecycleLabel(record.details.eventLifecycle, locale)}
              </p>
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3 xl:col-span-3">
              <p className="text-xs text-[#4f6977]">{t.eventProposal}</p>
              <p className="text-sm font-semibold text-[#123447]">{proposalLabel(record.details.proposalKind, locale)}</p>
            </article>
          </section>

          <section className="grid gap-3 rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm md:grid-cols-2">
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">{t.eventContent}</p>
              <p className="mt-1 text-sm text-[#123447]">{record.details.content ?? t.eventNoText}</p>
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">{t.eventPreparation}</p>
              <p className="mt-1 text-sm text-[#123447]">
                {record.details.preparationRequired ?? t.eventNoText}
              </p>
            </article>
          </section>

          <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
            <h3 className="text-base font-semibold text-[#123447]">{t.relatedTitle}</h3>
            {!hasRelated ? (
              <p className="mt-3 text-sm text-[#4f6977]">{t.noRelated}</p>
            ) : (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {record.related.campaign ? (
                  <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
                    <p className="text-xs text-[#4f6977]">{t.relatedCampaign}</p>
                    <p className="mt-1 text-sm font-semibold text-[#123447]">{record.related.campaign.name}</p>
                    <p className="mt-1 text-xs text-[#4f6977]">{record.related.campaign.status}</p>
                    <Link
                      href={
                        record.clientPortalSlug
                          ? `/client/${record.clientPortalSlug}/diagnostic/${record.related.campaign.id}?from=history`
                          : `/manager/programs/drps/${record.related.campaign.id}`
                      }
                      className="mt-2 inline-flex text-xs font-semibold text-[#0f5b73] hover:underline"
                    >
                      {t.openCampaign}
                    </Link>
                  </article>
                ) : null}
                {record.related.programAssignment ? (
                  <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
                    <p className="text-xs text-[#4f6977]">{t.relatedProgram}</p>
                    <p className="mt-1 text-sm font-semibold text-[#123447]">
                      {record.related.programAssignment.programTitle}
                    </p>
                    <p className="mt-1 text-xs text-[#4f6977]">
                      {record.related.programAssignment.status} |{" "}
                      {fmtDateTime(record.related.programAssignment.deployedAt, locale)}
                    </p>
                    <Link
                      href={`/manager/clients/${record.related.programAssignment.clientId}/assigned-continuous/${record.related.programAssignment.id}?from=history`}
                      className="mt-2 inline-flex text-xs font-semibold text-[#0f5b73] hover:underline"
                    >
                      {t.openProgram}
                    </Link>
                  </article>
                ) : null}
              </div>
            )}
          </section>

          {record.diagnostics ? (
            <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
              <h3 className="text-base font-semibold text-[#123447]">{t.diagnosticsTitle}</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
                  <p className="text-xs text-[#4f6977]">{t.diagnosticsResponses}</p>
                  <p className="text-sm font-semibold text-[#123447]">{record.diagnostics.responseCount}</p>
                </article>
                <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
                  <p className="text-xs text-[#4f6977]">{t.diagnosticsLatestResponse}</p>
                  <p className="text-sm font-semibold text-[#123447]">
                    {fmtDateTime(record.diagnostics.latestResponseAt, locale)}
                  </p>
                </article>
                <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
                  <p className="text-xs text-[#4f6977]">{t.diagnosticsResult}</p>
                  {record.diagnostics.latestDrpsResult ? (
                    <p className="text-sm font-semibold text-[#123447]">
                      {record.diagnostics.latestDrpsResult.probabilityScore.toFixed(2)} (
                      {probabilityLabel(record.diagnostics.latestDrpsResult.probabilityClass, locale)})
                    </p>
                  ) : (
                    <p className="text-sm text-[#4f6977]">
                      {record.diagnostics.drpsUnavailable ? t.diagnosticsUnavailable : "-"}
                    </p>
                  )}
                </article>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
