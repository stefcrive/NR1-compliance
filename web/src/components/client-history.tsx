"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type HistoryPayload = {
  client: {
    id: string;
    companyName: string;
    portalSlug: string;
  };
  concludedCampaigns: Array<{
    id: string;
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
    startsAt: string;
    endsAt: string;
    status: "scheduled" | "completed" | "cancelled";
    sourceClientProgramId: string | null;
    sourceCampaignId: string | null;
    lifecycle: "provisory" | "committed";
    proposalKind: "assignment" | "reschedule" | null;
    relatedProgramId: string | null;
  }>;
  reports: Array<{
    id: string;
    surveyId: string | null;
    surveyName: string | null;
    reportTitle: string;
    status: "draft" | "processing" | "ready" | "failed";
    createdAt: string;
  }>;
  companyRiskProfileResults: Array<{
    id: string;
    questionnaireVersion: string;
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

function fmt(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function eventTypeLabel(value: "drps_start" | "drps_close" | "continuous_meeting" | "blocked") {
  if (value === "drps_start") return "Inicio DRPS";
  if (value === "drps_close") return "Fechamento DRPS";
  if (value === "continuous_meeting") return "Reuniao continua";
  return "Bloqueio";
}

function eventStatusLabel(value: "scheduled" | "completed" | "cancelled") {
  if (value === "completed") return "Executado";
  if (value === "cancelled") return "Cancelado";
  return "Agendado";
}

function reportStatusLabel(value: "draft" | "processing" | "ready" | "failed") {
  if (value === "draft") return "Rascunho";
  if (value === "processing") return "Processando";
  if (value === "ready") return "Pronto";
  return "Falhou";
}

function probabilityLabel(value: "low" | "medium" | "high") {
  if (value === "low") return "Baixa";
  if (value === "medium") return "Media";
  return "Alta";
}

function companyRiskClassLabel(value: "baixa" | "media" | "alta") {
  if (value === "baixa") return "Baixa";
  if (value === "alta") return "Alta";
  return "Media";
}

export function ClientHistory({ clientSlug }: { clientSlug: string }) {
  const [payload, setPayload] = useState<HistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/client/portal/${clientSlug}/history`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as HistoryPayload & { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Nao foi possivel carregar o historico.");
      }
      setPayload(body);
    } catch (loadError) {
      setPayload(null);
      setError(
        loadError instanceof Error ? loadError.message : "Nao foi possivel carregar o historico.",
      );
    } finally {
      setLoading(false);
    }
  }, [clientSlug]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const notices = useMemo(() => {
    if (!payload) return [];
    const list: string[] = [];
    if (payload.compatibility.usingLegacyCampaigns) {
      list.push("Usando tabela legada de campanhas DRPS como fallback.");
    }
    if (payload.compatibility.calendarEventsUnavailable) {
      list.push("Historico de eventos indisponivel no momento.");
    }
    if (payload.compatibility.reportsUnavailable) {
      list.push("Historico de relatorios indisponivel no momento.");
    }
    if (payload.compatibility.drpsUnavailable) {
      list.push("Snapshots de resultado DRPS indisponiveis no momento.");
    }
    if (payload.compatibility.programsUnavailable) {
      list.push("Historico de programas atribuidos indisponivel no momento.");
    }
    if (payload.compatibility.companyRiskProfileUnavailable) {
      list.push("Historico do perfil de risco da empresa indisponivel no momento.");
    }
    return list;
  }, [payload]);

  const realizedEvents = useMemo(
    () => (payload?.realizedEvents ?? []).filter((event) => event.status === "completed"),
    [payload?.realizedEvents],
  );

  if (loading) return <p className="text-sm text-[#49697a]">Carregando historico...</p>;
  if (error || !payload) return <p className="text-sm text-red-600">{error || "Historico indisponivel."}</p>;

  return (
    <div className="space-y-6">
      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-[#141d24]">Historico</h2>
            <p className="mt-1 text-sm text-[#475660]">
              Registro somente leitura dos DRPS concluidos, perfil de risco, programas atribuidos, eventos e relatorios.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadHistory()}
            className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
          >
            Atualizar
          </button>
        </div>
        {notices.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs text-[#8a5b2d]">
            {notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <article className="rounded-2xl border border-[#dbe8ef] bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#5a7383]">DRPS concluidos</p>
          <p className="mt-2 text-2xl font-semibold text-[#123447]">{payload.concludedCampaigns.length}</p>
        </article>
        <article className="rounded-2xl border border-[#dbe8ef] bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#5a7383]">Programas atribuidos</p>
          <p className="mt-2 text-2xl font-semibold text-[#123447]">{payload.assignedPrograms.length}</p>
        </article>
        <article className="rounded-2xl border border-[#dbe8ef] bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#5a7383]">Eventos realizados</p>
          <p className="mt-2 text-2xl font-semibold text-[#123447]">{realizedEvents.length}</p>
        </article>
        <article className="rounded-2xl border border-[#dbe8ef] bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#5a7383]">Relatorios realizados</p>
          <p className="mt-2 text-2xl font-semibold text-[#123447]">{payload.reports.length}</p>
        </article>
        <article className="rounded-2xl border border-[#dbe8ef] bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#5a7383]">
            Perfil de risco concluido
          </p>
          <p className="mt-2 text-2xl font-semibold text-[#123447]">{payload.companyRiskProfileResults.length}</p>
        </article>
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">DRPS concluidos e resultados</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="nr-table min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Diagnostico</th>
                <th className="px-2 py-2 text-left">Periodo</th>
                <th className="px-2 py-2 text-left">Resultado</th>
                <th className="px-2 py-2 text-left">Respostas</th>
                <th className="px-2 py-2 text-left">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {payload.concludedCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-xs text-[#5a7383]">
                    Nenhum DRPS concluido encontrado.
                  </td>
                </tr>
              ) : (
                payload.concludedCampaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-b">
                    <td className="px-2 py-2">{campaign.name}</td>
                    <td className="px-2 py-2">
                      {fmt(campaign.startsAt)} - {fmt(campaign.closesAt)}
                    </td>
                    <td className="px-2 py-2">
                      {campaign.latestDrpsResult ? (
                        <>
                          <p>
                            {campaign.latestDrpsResult.probabilityScore.toFixed(2)} (
                            {probabilityLabel(campaign.latestDrpsResult.probabilityClass)})
                          </p>
                          <p className="text-xs text-[#5a7383]">
                            {campaign.latestDrpsResult.referencePeriod} | {campaign.latestDrpsResult.sector}
                          </p>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {campaign.responseCount}
                      <p className="text-xs text-[#5a7383]">{fmt(campaign.latestResponseAt)}</p>
                    </td>
                    <td className="px-2 py-2">
                      <Link
                        href={`/client/${clientSlug}/diagnostic/${campaign.id}?from=history`}
                        className="text-xs font-semibold text-[#0f5b73] hover:underline"
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

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Questionarios concluidos de perfil de risco da empresa</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="nr-table min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Versao</th>
                <th className="px-2 py-2 text-left">Resultado</th>
                <th className="px-2 py-2 text-left">Concluido em</th>
                <th className="px-2 py-2 text-left">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {payload.companyRiskProfileResults.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-3 text-xs text-[#5a7383]">
                    Nenhum questionario concluido de perfil de risco encontrado.
                  </td>
                </tr>
              ) : (
                payload.companyRiskProfileResults.map((result) => (
                  <tr key={result.id} className="border-b">
                    <td className="px-2 py-2">{result.questionnaireVersion}</td>
                    <td className="px-2 py-2">
                      {result.overallScore.toFixed(2)} ({companyRiskClassLabel(result.overallClass)})
                    </td>
                    <td className="px-2 py-2">{fmt(result.createdAt)}</td>
                    <td className="px-2 py-2">
                      <Link
                        href={`/client/${clientSlug}/company-risk-profile?from=history&reportId=${encodeURIComponent(result.id)}`}
                        className="text-xs font-semibold text-[#0f5b73] hover:underline"
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

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Programas atribuidos</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="nr-table min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Programa</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Aplicado em</th>
                <th className="px-2 py-2 text-left">Cadencia</th>
                <th className="px-2 py-2 text-left">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {payload.assignedPrograms.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-xs text-[#5a7383]">
                    Nenhum programa atribuido encontrado.
                  </td>
                </tr>
              ) : (
                payload.assignedPrograms.map((program) => (
                  <tr key={program.id} className="border-b">
                    <td className="px-2 py-2">{program.programTitle}</td>
                    <td className="px-2 py-2">{program.status}</td>
                    <td className="px-2 py-2">{fmt(program.deployedAt)}</td>
                    <td className="px-2 py-2">{program.scheduleFrequency}</td>
                    <td className="px-2 py-2">
                      <Link
                        href={`/client/${clientSlug}/programs/${program.programId}?assignmentId=${program.id}&from=history`}
                        className="text-xs font-semibold text-[#0f5b73] hover:underline"
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

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Eventos realizados</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="nr-table min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Evento</th>
                <th className="px-2 py-2 text-left">Data/hora</th>
                <th className="px-2 py-2 text-left">Tipo</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {realizedEvents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-xs text-[#5a7383]">
                    Nenhum evento realizado encontrado.
                  </td>
                </tr>
              ) : (
                realizedEvents.map((event) => (
                  <tr key={event.id} className="border-b">
                    <td className="px-2 py-2">{event.title}</td>
                    <td className="px-2 py-2">{fmt(event.startsAt)}</td>
                    <td className="px-2 py-2">{eventTypeLabel(event.eventType)}</td>
                    <td className="px-2 py-2">{eventStatusLabel(event.status)}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Link
                          href={`/client/${clientSlug}/history/events/${event.id}`}
                          className="font-semibold text-[#0f5b73] hover:underline"
                        >
                          Abrir ficha
                        </Link>
                        {event.sourceCampaignId ? (
                          <Link
                            href={`/client/${clientSlug}/diagnostic/${event.sourceCampaignId}?from=history`}
                            className="font-semibold text-[#0f5b73] hover:underline"
                          >
                            Abrir DRPS
                          </Link>
                        ) : null}
                        {event.relatedProgramId && event.sourceClientProgramId ? (
                          <Link
                            href={`/client/${clientSlug}/programs/${event.relatedProgramId}?assignmentId=${event.sourceClientProgramId}&from=history`}
                            className="font-semibold text-[#0f5b73] hover:underline"
                          >
                            Abrir programa
                          </Link>
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

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Relatorios realizados</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="nr-table min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Relatorio</th>
                <th className="px-2 py-2 text-left">Diagnostico</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Criado em</th>
                <th className="px-2 py-2 text-left">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {payload.reports.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-xs text-[#5a7383]">
                    Nenhum relatorio realizado encontrado.
                  </td>
                </tr>
              ) : (
                payload.reports.map((report) => (
                  <tr key={report.id} className="border-b">
                    <td className="px-2 py-2">{report.reportTitle}</td>
                    <td className="px-2 py-2">{report.surveyName ?? "-"}</td>
                    <td className="px-2 py-2">{reportStatusLabel(report.status)}</td>
                    <td className="px-2 py-2">{fmt(report.createdAt)}</td>
                    <td className="px-2 py-2">
                      <Link
                        href={`/client/${clientSlug}/reports?from=history`}
                        className="text-xs font-semibold text-[#0f5b73] hover:underline"
                      >
                        Abrir relatorios
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
