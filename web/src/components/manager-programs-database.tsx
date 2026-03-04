"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useManagerLocale } from "@/components/manager-locale";

type DrpsDiagnostic = {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "live" | "closed" | "archived";
  linkedClientId: string | null;
  startsAt: string | null;
  closesAt: string | null;
  createdAt: string;
  source: "surveys" | "legacy_drps_campaigns";
};

type ContinuousProgram = {
  id: string;
  title: string;
  description: string | null;
  targetRiskTopic: number;
  triggerThreshold: number;
  assignments: {
    total: number;
    recommended: number;
    active: number;
    completed: number;
  };
};

const COPY = {
  en: {
    title: "Programs Database",
    subtitle:
      "Repository separated into DRPS Diagnostics and Continuous Programs for preventive/interventive actions.",
    loading: "Loading database...",
    reload: "Reload",
    diagnosticsTitle: "DRPS Diagnostics",
    diagnosticsSubtitle:
      "Template diagnostics available to assign to companies.",
    diagName: "Diagnostic",
    diagStatus: "Status",
    diagWindow: "Window",
    diagSource: "Source",
    openDetails: "Open details",
    openTable: "Open table",
    closeTable: "Close table",
    diagNone: "No DRPS templates available.",
    sourceSurvey: "Survey base",
    sourceLegacy: "Legacy DRPS",
    continuousTitle: "Continuous Programs (Campaigns)",
    continuousSubtitle:
      "Preventive and interventive programs activated according to DRPS risk thresholds.",
    prgName: "Program",
    prgTopic: "Target topic",
    prgThreshold: "Trigger",
    prgActive: "Active",
    prgTotal: "Total assignments",
    prgNone: "No continuous programs available.",
    draft: "Draft",
    live: "Active",
    closed: "Completed",
    archived: "Archived",
  },
  pt: {
    title: "Base de Programas",
    subtitle:
      "Repositorio separado em Diagnosticos DRPS e Programas Continuos para acoes preventivas/interventivas.",
    loading: "Carregando base...",
    reload: "Recarregar",
    diagnosticsTitle: "Diagnosticos DRPS",
    diagnosticsSubtitle:
      "Templates de diagnostico disponiveis para atribuicao as empresas.",
    diagName: "Diagnostico",
    diagStatus: "Status",
    diagWindow: "Janela",
    diagSource: "Origem",
    openDetails: "Abrir detalhes",
    openTable: "Abrir tabela",
    closeTable: "Fechar tabela",
    diagNone: "Nenhum template DRPS disponivel.",
    sourceSurvey: "Base surveys",
    sourceLegacy: "DRPS legado",
    continuousTitle: "Programas Continuos (Campanhas)",
    continuousSubtitle:
      "Programas preventivos e interventivos ativados por gatilhos de risco DRPS.",
    prgName: "Programa",
    prgTopic: "Topico alvo",
    prgThreshold: "Gatilho",
    prgActive: "Ativos",
    prgTotal: "Total atribuicoes",
    prgNone: "Nenhum programa continuo disponivel.",
    draft: "Rascunho",
    live: "Ativo",
    closed: "Concluido",
    archived: "Arquivado",
  },
} as const;

function fmtDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

function fmtWindow(startsAt: string | null, closesAt: string | null) {
  return `${fmtDate(startsAt)} - ${fmtDate(closesAt)}`;
}

export function ManagerProgramsDatabase() {
  const { locale } = useManagerLocale();
  const t = COPY[locale];
  const [diagnostics, setDiagnostics] = useState<DrpsDiagnostic[]>([]);
  const [continuousPrograms, setContinuousPrograms] = useState<ContinuousProgram[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(true);
  const [isContinuousOpen, setIsContinuousOpen] = useState(true);

  const sortedDiagnostics = useMemo(
    () =>
      [...diagnostics].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [diagnostics],
  );

  async function loadDatabase() {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/programs-database", { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Could not load programs database.");
      }
      const payload = (await response.json()) as {
        drpsDiagnostics: DrpsDiagnostic[];
        continuousPrograms: ContinuousProgram[];
      };
      setDiagnostics(payload.drpsDiagnostics ?? []);
      setContinuousPrograms(payload.continuousPrograms ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load programs database.");
      setDiagnostics([]);
      setContinuousPrograms([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadDatabase();
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#123447]">{t.title}</h2>
        <p className="mt-1 text-sm text-[#35515f]">{t.subtitle}</p>
        <button
          type="button"
          onClick={() => void loadDatabase()}
          className="mt-3 rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
        >
          {t.reload}
        </button>
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[#123447]">{t.diagnosticsTitle}</h3>
            <p className="mt-1 text-sm text-[#35515f]">{t.diagnosticsSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => setIsDiagnosticsOpen((current) => !current)}
            aria-expanded={isDiagnosticsOpen}
            className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
          >
            {isDiagnosticsOpen ? t.closeTable : t.openTable}
          </button>
        </div>
        {isLoading ? <p className="mt-3 text-sm text-[#49697a]">{t.loading}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        {isDiagnosticsOpen && !isLoading && !error ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-2 text-left">{t.diagName}</th>
                  <th className="px-2 py-2 text-left">{t.diagStatus}</th>
                  <th className="px-2 py-2 text-left">{t.diagWindow}</th>
                  <th className="px-2 py-2 text-left">{t.diagSource}</th>
                  <th className="px-2 py-2 text-left">{t.openDetails}</th>
                </tr>
              </thead>
              <tbody>
                {sortedDiagnostics.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-3 text-xs text-[#5a7383]">
                      {t.diagNone}
                    </td>
                  </tr>
                ) : (
                  sortedDiagnostics.map((diagnostic) => (
                    <tr key={diagnostic.id} className="border-b">
                      <td className="px-2 py-2">
                        <Link
                          href={`/manager/programs/drps/${diagnostic.id}`}
                          className="font-semibold text-[#123447] hover:text-[#0f5b73] hover:underline"
                        >
                          {diagnostic.name}
                        </Link>
                        <p className="text-xs text-[#55707f]">
                          {diagnostic.slug ? `/${diagnostic.slug}` : diagnostic.id}
                        </p>
                      </td>
                      <td className="px-2 py-2">
                        {diagnostic.status === "draft"
                          ? t.draft
                          : diagnostic.status === "live"
                            ? t.live
                            : diagnostic.status === "closed"
                              ? t.closed
                              : t.archived}
                      </td>
                      <td className="px-2 py-2">{fmtWindow(diagnostic.startsAt, diagnostic.closesAt)}</td>
                      <td className="px-2 py-2">
                        {diagnostic.source === "surveys" ? t.sourceSurvey : t.sourceLegacy}
                      </td>
                      <td className="px-2 py-2">
                        <Link
                          href={`/manager/programs/drps/${diagnostic.id}`}
                          className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                        >
                          {t.openDetails}
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[#123447]">{t.continuousTitle}</h3>
            <p className="mt-1 text-sm text-[#35515f]">{t.continuousSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => setIsContinuousOpen((current) => !current)}
            aria-expanded={isContinuousOpen}
            className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
          >
            {isContinuousOpen ? t.closeTable : t.openTable}
          </button>
        </div>
        {isContinuousOpen && !isLoading && !error ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-2 text-left">{t.prgName}</th>
                  <th className="px-2 py-2 text-left">{t.prgTopic}</th>
                  <th className="px-2 py-2 text-left">{t.prgThreshold}</th>
                  <th className="px-2 py-2 text-left">{t.prgActive}</th>
                  <th className="px-2 py-2 text-left">{t.prgTotal}</th>
                  <th className="px-2 py-2 text-left">{t.openDetails}</th>
                </tr>
              </thead>
              <tbody>
                {continuousPrograms.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-3 text-xs text-[#5a7383]">
                      {t.prgNone}
                    </td>
                  </tr>
                ) : (
                  continuousPrograms.map((program) => (
                    <tr key={program.id} className="border-b">
                      <td className="px-2 py-2">
                        <Link
                          href={`/manager/programs/continuous/${program.id}`}
                          className="font-semibold text-[#123447] hover:text-[#0f5b73] hover:underline"
                        >
                          {program.title}
                        </Link>
                        <p className="text-xs text-[#55707f]">{program.description ?? "-"}</p>
                      </td>
                      <td className="px-2 py-2">{program.targetRiskTopic}</td>
                      <td className="px-2 py-2">{program.triggerThreshold.toFixed(2)}</td>
                      <td className="px-2 py-2">{program.assignments.active}</td>
                      <td className="px-2 py-2">{program.assignments.total}</td>
                      <td className="px-2 py-2">
                        <Link
                          href={`/manager/programs/continuous/${program.id}`}
                          className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                        >
                          {t.openDetails}
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
