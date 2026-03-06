"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { type ManagerLocale, useManagerLocale } from "@/components/manager-locale";

type HistoryPayload = {
  companies: Array<{ id: string; name: string; portalSlug: string | null }>;
  concludedCampaigns: Array<{
    id: string;
    clientId: string | null;
    clientName: string | null;
    name: string;
    publicSlug: string | null;
    status: "closed" | "archived" | "completed";
    startsAt: string | null;
    closesAt: string | null;
    createdAt: string;
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
  }>;
  assignedPrograms: Array<{
    id: string;
    clientId: string;
    clientName: string | null;
    programId: string;
    programTitle: string;
    status: "Recommended" | "Active" | "Completed";
    deployedAt: string | null;
    scheduleFrequency: string;
    annualPlanMonths: string[];
  }>;
  realizedEvents: Array<{
    id: string;
    recordType: "calendar" | "drps";
    eventType: "drps_start" | "drps_close" | "continuous_meeting" | "blocked";
    title: string;
    clientId: string | null;
    clientName: string | null;
    startsAt: string;
    endsAt: string;
    status: "scheduled" | "completed" | "cancelled";
    sourceClientProgramId: string | null;
    sourceCampaignId: string | null;
    lifecycle: "provisory" | "committed";
    proposalKind: "assignment" | "reschedule" | null;
  }>;
  reports: Array<{
    id: string;
    clientId: string;
    clientName: string | null;
    surveyId: string | null;
    surveyName: string | null;
    reportTitle: string;
    status: "draft" | "processing" | "ready" | "failed";
    createdAt: string;
  }>;
  companyRiskProfileResults: Array<{
    id: string;
    clientId: string;
    clientName: string | null;
    questionnaireVersion: string;
    sector: string | null;
    overallScore: number;
    overallClass: "baixa" | "media" | "alta";
    createdAt: string;
  }>;
  compatibility: {
    usingLegacyCampaigns: boolean;
    calendarEventsUnavailable: boolean;
    reportsUnavailable: boolean;
    drpsUnavailable: boolean;
    programsUnavailable: boolean;
    companyRiskProfileUnavailable: boolean;
  };
};

const COMPANY_FILTER_ALL = "__all__";

const COPY = {
  en: {
    pageTitle: "History",
    subtitle:
      "Archive of completed DRPS diagnostics, assigned programs, realized events, and generated reports.",
    loading: "Loading history...",
    loadError: "Could not load history.",
    companyFilterLabel: "Company",
    companyFilterAll: "All companies",
    refresh: "Refresh",
    noCompany: "No company",
    noData: "No items found for this filter.",
    compatibilityLegacy:
      "Using legacy DRPS campaigns table as fallback.",
    compatibilityCalendar:
      "Realized calendar events unavailable (calendar_events table missing).",
    compatibilityReports:
      "Reports history unavailable (client_reports table missing).",
    compatibilityDrps:
      "DRPS result snapshots unavailable (drps_assessments table missing).",
    compatibilityPrograms:
      "Assigned programs history unavailable (client_programs table missing).",
    compatibilityCompanyRisk:
      "Company risk profile questionnaire history unavailable (client_company_risk_profile_reports table missing).",
    cardConcludedDrps: "Concluded DRPS",
    cardPrograms: "Assigned programs",
    cardPastPrograms: "Past continuous programs",
    cardEvents: "Realized events",
    cardReports: "Realized reports",
    cardCompanyRisk: "Risk profiles",
    sectionDrps: "Concluded DRPS diagnostics and results",
    sectionCompanyRisk: "Completed company risk profile questionnaires",
    sectionPrograms: "Assigned programs by company",
    sectionPastPrograms: "Past continuous programs by company",
    sectionEvents: "Realized events",
    sectionReports: "Realized reports by company",
    tableDiagnostic: "Diagnostic",
    tableCompany: "Company",
    tablePeriod: "Period",
    tableResult: "Result",
    tableResponses: "Responses",
    tableActions: "Actions",
    tableProgram: "Program",
    tableStatus: "Status",
    tableDeployedAt: "Deployed at",
    tableCadence: "Cadence",
    tableEvent: "Event",
    tableWhen: "When",
    tableType: "Type",
    tableLifecycle: "Lifecycle",
    tableReport: "Report",
    tableSurvey: "Diagnostic",
    tableQuestionnaireVersion: "Version",
    tableSector: "Sector",
    tableCreatedAt: "Created at",
    open: "Open",
    openRecord: "Open record file",
    openCampaign: "Open DRPS",
    openProgram: "Open program",
    openClient: "Open client",
    probabilityLow: "Low",
    probabilityMedium: "Medium",
    probabilityHigh: "High",
    statusClosed: "Closed",
    statusArchived: "Archived",
    statusCompleted: "Completed",
    eventTypeDrpsStart: "DRPS start",
    eventTypeDrpsClose: "DRPS close",
    eventTypeMeeting: "Continuous meeting",
    eventTypeBlocked: "Blocked time",
    lifecycleCommitted: "Committed",
    lifecycleProvisory: "Provisory",
    reportStatusDraft: "Draft",
    reportStatusProcessing: "Processing",
    reportStatusReady: "Ready",
    reportStatusFailed: "Failed",
    actionsPlaceholder: "-",
  },
  pt: {
    pageTitle: "Historico",
    subtitle:
      "Arquivo de DRPS concluidos, programas atribuidos, eventos realizados e relatorios gerados.",
    loading: "Carregando historico...",
    loadError: "Nao foi possivel carregar o historico.",
    companyFilterLabel: "Empresa",
    companyFilterAll: "Todas as empresas",
    refresh: "Atualizar",
    noCompany: "Sem empresa",
    noData: "Nenhum item encontrado para este filtro.",
    compatibilityLegacy:
      "Usando tabela legada de campanhas DRPS como fallback.",
    compatibilityCalendar:
      "Historico de eventos indisponivel (tabela calendar_events ausente).",
    compatibilityReports:
      "Historico de relatorios indisponivel (tabela client_reports ausente).",
    compatibilityDrps:
      "Snapshots de resultado DRPS indisponiveis (tabela drps_assessments ausente).",
    compatibilityPrograms:
      "Historico de programas atribuidos indisponivel (tabela client_programs ausente).",
    compatibilityCompanyRisk:
      "Historico do perfil de risco da empresa indisponivel (tabela client_company_risk_profile_reports ausente).",
    cardConcludedDrps: "DRPS concluidos",
    cardPrograms: "Programas atribuidos",
    cardPastPrograms: "Processos continuos passados",
    cardEvents: "Eventos realizados",
    cardReports: "Relatorios realizados",
    cardCompanyRisk: "Perfil de risco",
    sectionDrps: "DRPS concluidos e resultados",
    sectionCompanyRisk: "Questionarios concluidos de perfil de risco da empresa",
    sectionPrograms: "Programas atribuidos por empresa",
    sectionPastPrograms: "Processos continuos passados por empresa",
    sectionEvents: "Eventos realizados",
    sectionReports: "Relatorios realizados por empresa",
    tableDiagnostic: "Diagnostico",
    tableCompany: "Empresa",
    tablePeriod: "Periodo",
    tableResult: "Resultado",
    tableResponses: "Respostas",
    tableActions: "Acoes",
    tableProgram: "Programa",
    tableStatus: "Status",
    tableDeployedAt: "Aplicado em",
    tableCadence: "Cadencia",
    tableEvent: "Evento",
    tableWhen: "Quando",
    tableType: "Tipo",
    tableLifecycle: "Ciclo",
    tableReport: "Relatorio",
    tableSurvey: "Diagnostico",
    tableQuestionnaireVersion: "Versao",
    tableSector: "Setor",
    tableCreatedAt: "Criado em",
    open: "Abrir",
    openRecord: "Abrir ficha",
    openCampaign: "Abrir DRPS",
    openProgram: "Abrir programa",
    openClient: "Abrir cliente",
    probabilityLow: "Baixa",
    probabilityMedium: "Media",
    probabilityHigh: "Alta",
    statusClosed: "Fechado",
    statusArchived: "Arquivado",
    statusCompleted: "Concluido",
    eventTypeDrpsStart: "Inicio DRPS",
    eventTypeDrpsClose: "Fechamento DRPS",
    eventTypeMeeting: "Reuniao continua",
    eventTypeBlocked: "Bloqueio",
    lifecycleCommitted: "Commitado",
    lifecycleProvisory: "Provisorio",
    reportStatusDraft: "Rascunho",
    reportStatusProcessing: "Processando",
    reportStatusReady: "Pronto",
    reportStatusFailed: "Falhou",
    actionsPlaceholder: "-",
  },
} as const;

function uiLocale(locale: ManagerLocale) {
  return locale === "pt" ? "pt-BR" : "en-US";
}

function fmtDateTime(value: string | null, locale: ManagerLocale) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(uiLocale(locale), { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

function campaignStatusLabel(
  status: "closed" | "archived" | "completed",
  locale: ManagerLocale,
) {
  const t = COPY[locale];
  if (status === "closed") return t.statusClosed;
  if (status === "archived") return t.statusArchived;
  return t.statusCompleted;
}

function eventTypeLabel(
  eventType: "drps_start" | "drps_close" | "continuous_meeting" | "blocked",
  locale: ManagerLocale,
) {
  const t = COPY[locale];
  if (eventType === "drps_start") return t.eventTypeDrpsStart;
  if (eventType === "drps_close") return t.eventTypeDrpsClose;
  if (eventType === "continuous_meeting") return t.eventTypeMeeting;
  return t.eventTypeBlocked;
}

function probabilityClassLabel(value: "low" | "medium" | "high", locale: ManagerLocale) {
  const t = COPY[locale];
  if (value === "low") return t.probabilityLow;
  if (value === "medium") return t.probabilityMedium;
  return t.probabilityHigh;
}

function companyRiskClassLabel(value: "baixa" | "media" | "alta", locale: ManagerLocale) {
  const t = COPY[locale];
  if (value === "baixa") return t.probabilityLow;
  if (value === "alta") return t.probabilityHigh;
  return t.probabilityMedium;
}

function lifecycleLabel(value: "provisory" | "committed", locale: ManagerLocale) {
  return value === "committed" ? COPY[locale].lifecycleCommitted : COPY[locale].lifecycleProvisory;
}

function reportStatusLabel(
  value: "draft" | "processing" | "ready" | "failed",
  locale: ManagerLocale,
) {
  const t = COPY[locale];
  if (value === "draft") return t.reportStatusDraft;
  if (value === "processing") return t.reportStatusProcessing;
  if (value === "ready") return t.reportStatusReady;
  return t.reportStatusFailed;
}

export function ManagerHistory({ forcedClientId }: { forcedClientId?: string }) {
  const { locale } = useManagerLocale();
  const t = COPY[locale];
  const isCompanyProfileHistory = Boolean(forcedClientId);
  const showCompanyColumn = !isCompanyProfileHistory;
  const [payload, setPayload] = useState<HistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [companyFilter, setCompanyFilter] = useState(forcedClientId ?? COMPANY_FILTER_ALL);
  const activeCompanyFilter = forcedClientId ?? companyFilter;

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/history", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as HistoryPayload & { error?: string };
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
  }, [t.loadError]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    setCompanyFilter(forcedClientId ?? COMPANY_FILTER_ALL);
  }, [forcedClientId]);

  const concludedCampaigns = useMemo(
    () =>
      (payload?.concludedCampaigns ?? []).filter((item) =>
        activeCompanyFilter === COMPANY_FILTER_ALL ? true : item.clientId === activeCompanyFilter,
      ),
    [activeCompanyFilter, payload?.concludedCampaigns],
  );

  const assignedPrograms = useMemo(
    () =>
      (payload?.assignedPrograms ?? []).filter((item) =>
        activeCompanyFilter === COMPANY_FILTER_ALL ? true : item.clientId === activeCompanyFilter,
      ),
    [activeCompanyFilter, payload?.assignedPrograms],
  );
  const pastAssignedPrograms = useMemo(
    () => assignedPrograms.filter((item) => item.status === "Completed"),
    [assignedPrograms],
  );

  const realizedEvents = useMemo(
    () =>
      (payload?.realizedEvents ?? []).filter((item) =>
        activeCompanyFilter === COMPANY_FILTER_ALL ? true : item.clientId === activeCompanyFilter,
      ),
    [activeCompanyFilter, payload?.realizedEvents],
  );

  const reports = useMemo(
    () =>
      (payload?.reports ?? []).filter((item) =>
        activeCompanyFilter === COMPANY_FILTER_ALL ? true : item.clientId === activeCompanyFilter,
      ),
    [activeCompanyFilter, payload?.reports],
  );
  const companyRiskProfileResults = useMemo(
    () =>
      (payload?.companyRiskProfileResults ?? []).filter((item) =>
        activeCompanyFilter === COMPANY_FILTER_ALL ? true : item.clientId === activeCompanyFilter,
      ),
    [activeCompanyFilter, payload?.companyRiskProfileResults],
  );
  const programsForTable = isCompanyProfileHistory ? pastAssignedPrograms : assignedPrograms;

  const clientPortalSlugById = useMemo(
    () => new Map((payload?.companies ?? []).map((company) => [company.id, company.portalSlug])),
    [payload?.companies],
  );

  const drpsResultsHref = useCallback(
    (campaignId: string, clientId: string | null) => {
      const clientSlug = clientId ? clientPortalSlugById.get(clientId) ?? null : null;
      return clientSlug
        ? `/client/${clientSlug}/diagnostic/${campaignId}?from=history`
        : `/manager/programs/drps/${campaignId}`;
    },
    [clientPortalSlugById],
  );

  const notices = useMemo(() => {
    if (!payload) return [];
    const list: string[] = [];
    if (payload.compatibility.usingLegacyCampaigns) list.push(t.compatibilityLegacy);
    if (payload.compatibility.calendarEventsUnavailable) list.push(t.compatibilityCalendar);
    if (payload.compatibility.reportsUnavailable) list.push(t.compatibilityReports);
    if (payload.compatibility.drpsUnavailable) list.push(t.compatibilityDrps);
    if (payload.compatibility.programsUnavailable) list.push(t.compatibilityPrograms);
    if (payload.compatibility.companyRiskProfileUnavailable) list.push(t.compatibilityCompanyRisk);
    return list;
  }, [
    payload,
    t.compatibilityCalendar,
    t.compatibilityCompanyRisk,
    t.compatibilityDrps,
    t.compatibilityLegacy,
    t.compatibilityPrograms,
    t.compatibilityReports,
  ]);

  return (
    <div className="space-y-6">
      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[#121b22] md:text-3xl">{t.pageTitle}</h2>
            <p className="mt-2 text-sm text-[#4f5f6a]">
              {isCompanyProfileHistory
                ? locale === "pt"
                  ? "DRPS concluidos, processos continuos passados e lista de eventos da empresa."
                  : "Concluded DRPS, past continuous programs, and company event list."
                : t.subtitle}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {forcedClientId ? null : (
              <label className="text-xs text-[#4f6977]">
                {t.companyFilterLabel}
                <select
                  value={companyFilter}
                  onChange={(event) => setCompanyFilter(event.target.value)}
                  className="mt-1 block rounded border border-[#c9dce8] bg-white px-3 py-2 text-sm"
                >
                  <option value={COMPANY_FILTER_ALL}>{t.companyFilterAll}</option>
                  {(payload?.companies ?? []).map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={() => void loadHistory()}
              className="rounded-full border border-[#c9dce8] bg-white px-4 py-2 text-xs font-semibold text-[#123447]"
            >
              {t.refresh}
            </button>
          </div>
        </div>
        {loading ? <p className="mt-3 text-sm text-[#4f5f6a]">{t.loading}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        {notices.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs text-[#8a5b2d]">
            {notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-[#dbe8ef] bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#5a7383]">{t.cardConcludedDrps}</p>
          <p className="mt-2 text-2xl font-semibold text-[#123447]">{concludedCampaigns.length}</p>
        </article>
        <article className="rounded-2xl border border-[#dbe8ef] bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#5a7383]">
            {isCompanyProfileHistory ? t.cardPastPrograms : t.cardPrograms}
          </p>
          <p className="mt-2 text-2xl font-semibold text-[#123447]">
            {isCompanyProfileHistory ? pastAssignedPrograms.length : assignedPrograms.length}
          </p>
        </article>
        <article className="rounded-2xl border border-[#dbe8ef] bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#5a7383]">{t.cardEvents}</p>
          <p className="mt-2 text-2xl font-semibold text-[#123447]">{realizedEvents.length}</p>
        </article>
        <article className="rounded-2xl border border-[#dbe8ef] bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#5a7383]">{t.cardCompanyRisk}</p>
          <p className="mt-2 text-2xl font-semibold text-[#123447]">{companyRiskProfileResults.length}</p>
        </article>
        {!isCompanyProfileHistory ? (
          <article className="rounded-2xl border border-[#dbe8ef] bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#5a7383]">{t.cardReports}</p>
            <p className="mt-2 text-2xl font-semibold text-[#123447]">{reports.length}</p>
          </article>
        ) : null}
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">{t.sectionDrps}</h3>
        <div className="mt-3 overflow-x-auto rounded-lg border border-[#d8e4ee] bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-[#f5f8fb]">
                <th className="px-2 py-2 text-left">{t.tableDiagnostic}</th>
                {showCompanyColumn ? <th className="px-2 py-2 text-left">{t.tableCompany}</th> : null}
                <th className="px-2 py-2 text-left">{t.tablePeriod}</th>
                <th className="px-2 py-2 text-left">{t.tableResult}</th>
                <th className="px-2 py-2 text-left">{t.tableResponses}</th>
                <th className="px-2 py-2 text-left">{t.tableActions}</th>
              </tr>
            </thead>
            <tbody>
              {concludedCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={showCompanyColumn ? 6 : 5} className="px-2 py-3 text-xs text-[#5a7383]">
                    {t.noData}
                  </td>
                </tr>
              ) : (
                concludedCampaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-b last:border-b-0">
                    <td className="px-2 py-2">
                      <p className="font-semibold text-[#123447]">{campaign.name}</p>
                      <p className="text-xs text-[#4f6977]">{campaignStatusLabel(campaign.status, locale)}</p>
                    </td>
                    {showCompanyColumn ? (
                      <td className="px-2 py-2 text-[#3e5a68]">{campaign.clientName ?? t.noCompany}</td>
                    ) : null}
                    <td className="px-2 py-2 text-[#3e5a68]">
                      {fmtDateTime(campaign.startsAt, locale)} - {fmtDateTime(campaign.closesAt, locale)}
                    </td>
                    <td className="px-2 py-2 text-[#3e5a68]">
                      {campaign.latestDrpsResult ? (
                        <>
                          <p className="font-medium">
                            {campaign.latestDrpsResult.probabilityScore.toFixed(2)} (
                            {probabilityClassLabel(campaign.latestDrpsResult.probabilityClass, locale)})
                          </p>
                          <p className="text-xs">
                            {campaign.latestDrpsResult.referencePeriod} | {campaign.latestDrpsResult.sector}
                          </p>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-2 py-2 text-[#3e5a68]">
                      {campaign.responseCount}
                      <p className="text-xs">{fmtDateTime(campaign.latestResponseAt, locale)}</p>
                    </td>
                    <td className="px-2 py-2">
                      <Link
                        href={drpsResultsHref(campaign.id, campaign.clientId)}
                        className="text-xs font-semibold text-[#0f5b73] hover:underline"
                      >
                        {t.openCampaign}
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
        <h3 className="text-lg font-semibold text-[#123447]">{t.sectionCompanyRisk}</h3>
        <div className="mt-3 overflow-x-auto rounded-lg border border-[#d8e4ee] bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-[#f5f8fb]">
                <th className="px-2 py-2 text-left">{t.tableQuestionnaireVersion}</th>
                {showCompanyColumn ? <th className="px-2 py-2 text-left">{t.tableCompany}</th> : null}
                <th className="px-2 py-2 text-left">{t.tableSector}</th>
                <th className="px-2 py-2 text-left">{t.tableResult}</th>
                <th className="px-2 py-2 text-left">{t.tableCreatedAt}</th>
                <th className="px-2 py-2 text-left">{t.tableActions}</th>
              </tr>
            </thead>
            <tbody>
              {companyRiskProfileResults.length === 0 ? (
                <tr>
                  <td colSpan={showCompanyColumn ? 6 : 5} className="px-2 py-3 text-xs text-[#5a7383]">
                    {t.noData}
                  </td>
                </tr>
              ) : (
                companyRiskProfileResults.map((result) => (
                  <tr key={result.id} className="border-b last:border-b-0">
                    <td className="px-2 py-2 text-[#3e5a68]">{result.questionnaireVersion}</td>
                    {showCompanyColumn ? (
                      <td className="px-2 py-2 text-[#3e5a68]">{result.clientName ?? t.noCompany}</td>
                    ) : null}
                    <td className="px-2 py-2 text-[#3e5a68]">{result.sector ?? "-"}</td>
                    <td className="px-2 py-2 text-[#3e5a68]">
                      {result.overallScore.toFixed(2)} ({companyRiskClassLabel(result.overallClass, locale)})
                    </td>
                    <td className="px-2 py-2 text-[#3e5a68]">{fmtDateTime(result.createdAt, locale)}</td>
                    <td className="px-2 py-2">
                      <Link
                        href={`/manager/clients/${result.clientId}/company-risk-profile`}
                        className="text-xs font-semibold text-[#0f5b73] hover:underline"
                      >
                        {t.open}
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
        <h3 className="text-lg font-semibold text-[#123447]">
          {isCompanyProfileHistory ? t.sectionPastPrograms : t.sectionPrograms}
        </h3>
        <div className="mt-3 overflow-x-auto rounded-lg border border-[#d8e4ee] bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-[#f5f8fb]">
                <th className="px-2 py-2 text-left">{t.tableProgram}</th>
                {showCompanyColumn ? <th className="px-2 py-2 text-left">{t.tableCompany}</th> : null}
                <th className="px-2 py-2 text-left">{t.tableStatus}</th>
                <th className="px-2 py-2 text-left">{t.tableDeployedAt}</th>
                <th className="px-2 py-2 text-left">{t.tableCadence}</th>
                <th className="px-2 py-2 text-left">{t.tableActions}</th>
              </tr>
            </thead>
            <tbody>
              {programsForTable.length === 0 ? (
                <tr>
                  <td colSpan={showCompanyColumn ? 6 : 5} className="px-2 py-3 text-xs text-[#5a7383]">
                    {t.noData}
                  </td>
                </tr>
              ) : (
                programsForTable.map((program) => (
                  <tr key={program.id} className="border-b last:border-b-0">
                    <td className="px-2 py-2">
                      <p className="font-semibold text-[#123447]">{program.programTitle}</p>
                      <p className="text-xs text-[#4f6977]">{program.programId}</p>
                    </td>
                    {showCompanyColumn ? (
                      <td className="px-2 py-2 text-[#3e5a68]">{program.clientName ?? t.noCompany}</td>
                    ) : null}
                    <td className="px-2 py-2 text-[#3e5a68]">{program.status}</td>
                    <td className="px-2 py-2 text-[#3e5a68]">{fmtDateTime(program.deployedAt, locale)}</td>
                    <td className="px-2 py-2 text-[#3e5a68]">{program.scheduleFrequency}</td>
                    <td className="px-2 py-2">
                      <Link
                        href={`/manager/clients/${program.clientId}/assigned-continuous/${program.id}?from=history`}
                        className="text-xs font-semibold text-[#0f5b73] hover:underline"
                      >
                        {t.openProgram}
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
        <h3 className="text-lg font-semibold text-[#123447]">{t.sectionEvents}</h3>
        <div className="mt-3 overflow-x-auto rounded-lg border border-[#d8e4ee] bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-[#f5f8fb]">
                <th className="px-2 py-2 text-left">{t.tableEvent}</th>
                {showCompanyColumn ? <th className="px-2 py-2 text-left">{t.tableCompany}</th> : null}
                <th className="px-2 py-2 text-left">{t.tableWhen}</th>
                <th className="px-2 py-2 text-left">{t.tableType}</th>
                <th className="px-2 py-2 text-left">{t.tableLifecycle}</th>
                <th className="px-2 py-2 text-left">{t.tableActions}</th>
              </tr>
            </thead>
            <tbody>
              {realizedEvents.length === 0 ? (
                <tr>
                  <td colSpan={showCompanyColumn ? 6 : 5} className="px-2 py-3 text-xs text-[#5a7383]">
                    {t.noData}
                  </td>
                </tr>
              ) : (
                realizedEvents.map((event) => (
                  <tr key={event.id} className="border-b last:border-b-0">
                    <td className="px-2 py-2">
                      <p className="font-semibold text-[#123447]">{event.title}</p>
                      <p className="text-xs text-[#4f6977]">{event.recordType}</p>
                    </td>
                    {showCompanyColumn ? (
                      <td className="px-2 py-2 text-[#3e5a68]">{event.clientName ?? t.noCompany}</td>
                    ) : null}
                    <td className="px-2 py-2 text-[#3e5a68]">{fmtDateTime(event.startsAt, locale)}</td>
                    <td className="px-2 py-2 text-[#3e5a68]">{eventTypeLabel(event.eventType, locale)}</td>
                    <td className="px-2 py-2 text-[#3e5a68]">{lifecycleLabel(event.lifecycle, locale)}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Link
                          href={`/manager/history/events/${event.id}`}
                          className="font-semibold text-[#0f5b73] hover:underline"
                        >
                          {t.openRecord}
                        </Link>
                        {event.sourceCampaignId ? (
                          <Link
                            href={drpsResultsHref(event.sourceCampaignId, event.clientId)}
                            className="font-semibold text-[#0f5b73] hover:underline"
                          >
                            {t.openCampaign}
                          </Link>
                        ) : null}
                        {event.sourceClientProgramId ? (
                          event.clientId ? (
                            <Link
                              href={`/manager/clients/${event.clientId}/assigned-continuous/${event.sourceClientProgramId}?from=history`}
                              className="font-semibold text-[#0f5b73] hover:underline"
                            >
                              {t.openProgram}
                            </Link>
                          ) : (
                            <span className="font-semibold text-[#7f8d95]">{t.openProgram}</span>
                          )
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

      {!isCompanyProfileHistory ? (
        <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#123447]">{t.sectionReports}</h3>
          <div className="mt-3 overflow-x-auto rounded-lg border border-[#d8e4ee] bg-white">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-[#f5f8fb]">
                  <th className="px-2 py-2 text-left">{t.tableReport}</th>
                  <th className="px-2 py-2 text-left">{t.tableCompany}</th>
                  <th className="px-2 py-2 text-left">{t.tableSurvey}</th>
                  <th className="px-2 py-2 text-left">{t.tableStatus}</th>
                  <th className="px-2 py-2 text-left">{t.tableCreatedAt}</th>
                  <th className="px-2 py-2 text-left">{t.tableActions}</th>
                </tr>
              </thead>
              <tbody>
                {reports.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-3 text-xs text-[#5a7383]">
                      {t.noData}
                    </td>
                  </tr>
                ) : (
                  reports.map((report) => (
                    <tr key={report.id} className="border-b last:border-b-0">
                      <td className="px-2 py-2">
                        <p className="font-semibold text-[#123447]">{report.reportTitle}</p>
                        <p className="text-xs text-[#4f6977]">{report.id}</p>
                      </td>
                      <td className="px-2 py-2 text-[#3e5a68]">{report.clientName ?? t.noCompany}</td>
                      <td className="px-2 py-2 text-[#3e5a68]">{report.surveyName ?? "-"}</td>
                      <td className="px-2 py-2 text-[#3e5a68]">{reportStatusLabel(report.status, locale)}</td>
                      <td className="px-2 py-2 text-[#3e5a68]">{fmtDateTime(report.createdAt, locale)}</td>
                      <td className="px-2 py-2">
                        {report.clientId ? (
                          <Link
                            href={`/manager/clients/${report.clientId}`}
                            className="text-xs font-semibold text-[#0f5b73] hover:underline"
                          >
                            {t.openClient}
                          </Link>
                        ) : (
                          <span className="text-xs text-[#7f8d95]">{t.actionsPlaceholder}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
