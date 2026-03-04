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

type DrpsTemplateCreatePayload = {
  campaign?: {
    id: string;
    name: string;
    public_slug: string;
    status: string;
  };
  error?: string;
};

type ProgramTemplateCreatePayload = {
  program?: {
    id: string;
    title: string;
  };
  error?: string;
};

const COPY = {
  en: {
    title: "Programs Database",
    subtitle:
      "Repository separated into DRPS Diagnostics and Continuous Programs for preventive/interventive actions.",
    loading: "Loading database...",
    reload: "Reload",
    createDrps: "New DRPS",
    createProgram: "New program",
    modalClose: "Close",
    modalCancel: "Cancel",
    modalCreate: "Create",
    creating: "Creating...",
    createdOpen: "Open details",
    diagnosticsTitle: "DRPS Diagnostics",
    diagnosticsSubtitle:
      "Template diagnostics available to assign to companies.",
    drpsModalTitle: "Create DRPS diagnostic",
    drpsModalSubtitle: "Create a new DRPS template in the programs database.",
    drpsFieldName: "Name",
    drpsFieldSlug: "Public slug (optional)",
    drpsFieldStatus: "Initial status",
    drpsFieldClone: "Clone questionnaire from",
    drpsFieldKAnon: "k-anonymity minimum",
    drpsCloneNone: "Do not clone",
    drpsValidationName: "Diagnostic name must have at least 3 characters.",
    drpsValidationKAnon: "k-anonymity must be between 3 and 20.",
    drpsCreateError: "Could not create DRPS diagnostic.",
    drpsCreatedNotice: "DRPS template created.",
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
    programModalTitle: "Create continuous program",
    programModalSubtitle: "Create a new preventive or interventive program template.",
    programFieldTitle: "Title",
    programFieldDescription: "Description (optional)",
    programFieldTopic: "Target risk topic",
    programFieldThreshold: "Trigger threshold",
    programValidationTitle: "Program title must have at least 3 characters.",
    programValidationTopic: "Target topic must be between 1 and 13.",
    programValidationThreshold: "Trigger threshold must be between 1.00 and 3.00.",
    programCreateError: "Could not create continuous program.",
    programCreatedNotice: "Continuous program created.",
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
    createDrps: "Novo DRPS",
    createProgram: "Novo programa",
    modalClose: "Fechar",
    modalCancel: "Cancelar",
    modalCreate: "Criar",
    creating: "Criando...",
    createdOpen: "Abrir detalhes",
    diagnosticsTitle: "Diagnosticos DRPS",
    diagnosticsSubtitle:
      "Templates de diagnostico disponiveis para atribuicao as empresas.",
    drpsModalTitle: "Criar diagnostico DRPS",
    drpsModalSubtitle: "Crie um novo template DRPS na base de programas.",
    drpsFieldName: "Nome",
    drpsFieldSlug: "Slug publico (opcional)",
    drpsFieldStatus: "Status inicial",
    drpsFieldClone: "Clonar questionario de",
    drpsFieldKAnon: "k-anonimato minimo",
    drpsCloneNone: "Nao clonar",
    drpsValidationName: "Nome do diagnostico deve ter pelo menos 3 caracteres.",
    drpsValidationKAnon: "k-anonimato deve estar entre 3 e 20.",
    drpsCreateError: "Nao foi possivel criar diagnostico DRPS.",
    drpsCreatedNotice: "Template DRPS criado.",
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
    programModalTitle: "Criar programa continuo",
    programModalSubtitle: "Crie um novo template preventivo ou interventivo.",
    programFieldTitle: "Titulo",
    programFieldDescription: "Descricao (opcional)",
    programFieldTopic: "Topico de risco alvo",
    programFieldThreshold: "Gatilho",
    programValidationTitle: "Titulo do programa deve ter pelo menos 3 caracteres.",
    programValidationTopic: "Topico alvo deve estar entre 1 e 13.",
    programValidationThreshold: "Gatilho deve estar entre 1.00 e 3.00.",
    programCreateError: "Nao foi possivel criar programa continuo.",
    programCreatedNotice: "Programa continuo criado.",
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
  const [notice, setNotice] = useState("");
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(true);
  const [isContinuousOpen, setIsContinuousOpen] = useState(true);
  const [isCreateDrpsOpen, setIsCreateDrpsOpen] = useState(false);
  const [isCreateProgramOpen, setIsCreateProgramOpen] = useState(false);
  const [isCreatingDrps, setIsCreatingDrps] = useState(false);
  const [isCreatingProgram, setIsCreatingProgram] = useState(false);
  const [createDrpsError, setCreateDrpsError] = useState("");
  const [createProgramError, setCreateProgramError] = useState("");
  const [createDrpsName, setCreateDrpsName] = useState("");
  const [createDrpsSlug, setCreateDrpsSlug] = useState("");
  const [createDrpsStatus, setCreateDrpsStatus] = useState<"draft" | "live">("draft");
  const [createDrpsSourceId, setCreateDrpsSourceId] = useState("");
  const [createDrpsKAnon, setCreateDrpsKAnon] = useState(5);
  const [createProgramTitle, setCreateProgramTitle] = useState("");
  const [createProgramDescription, setCreateProgramDescription] = useState("");
  const [createProgramTopic, setCreateProgramTopic] = useState(1);
  const [createProgramThreshold, setCreateProgramThreshold] = useState(1);
  const [createdDrpsId, setCreatedDrpsId] = useState<string | null>(null);
  const [createdProgramId, setCreatedProgramId] = useState<string | null>(null);

  const sortedDiagnostics = useMemo(
    () =>
      [...diagnostics].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [diagnostics],
  );
  const clonableDiagnostics = useMemo(
    () => sortedDiagnostics.filter((item) => item.source === "surveys"),
    [sortedDiagnostics],
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

  function openCreateDrpsModal() {
    setCreateDrpsError("");
    setCreateDrpsName("");
    setCreateDrpsSlug("");
    setCreateDrpsStatus("draft");
    setCreateDrpsSourceId("");
    setCreateDrpsKAnon(5);
    setIsCreateDrpsOpen(true);
  }

  function openCreateProgramModal() {
    setCreateProgramError("");
    setCreateProgramTitle("");
    setCreateProgramDescription("");
    setCreateProgramTopic(1);
    setCreateProgramThreshold(1);
    setIsCreateProgramOpen(true);
  }

  async function handleCreateDrps() {
    setCreateDrpsError("");
    setNotice("");
    setCreatedDrpsId(null);
    if (createDrpsName.trim().length < 3) {
      setCreateDrpsError(t.drpsValidationName);
      return;
    }
    if (!Number.isInteger(createDrpsKAnon) || createDrpsKAnon < 3 || createDrpsKAnon > 20) {
      setCreateDrpsError(t.drpsValidationKAnon);
      return;
    }

    setIsCreatingDrps(true);
    try {
      const response = await fetch("/api/admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createDrpsName.trim(),
          publicSlug: createDrpsSlug.trim() || undefined,
          status: createDrpsStatus,
          kAnonymityMin: createDrpsKAnon,
          sourceSurveyId: createDrpsSourceId || undefined,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as DrpsTemplateCreatePayload;
      if (!response.ok && response.status !== 207) {
        throw new Error(payload.error ?? t.drpsCreateError);
      }

      if (!payload.campaign?.id) {
        throw new Error(t.drpsCreateError);
      }

      setCreatedDrpsId(payload.campaign.id);
      setIsCreateDrpsOpen(false);
      setNotice(t.drpsCreatedNotice);
      await loadDatabase();
    } catch (createError) {
      setCreateDrpsError(createError instanceof Error ? createError.message : t.drpsCreateError);
    } finally {
      setIsCreatingDrps(false);
    }
  }

  async function handleCreateProgram() {
    setCreateProgramError("");
    setNotice("");
    setCreatedProgramId(null);
    if (createProgramTitle.trim().length < 3) {
      setCreateProgramError(t.programValidationTitle);
      return;
    }
    if (!Number.isInteger(createProgramTopic) || createProgramTopic < 1 || createProgramTopic > 13) {
      setCreateProgramError(t.programValidationTopic);
      return;
    }
    if (
      !Number.isFinite(createProgramThreshold) ||
      createProgramThreshold < 1 ||
      createProgramThreshold > 3
    ) {
      setCreateProgramError(t.programValidationThreshold);
      return;
    }

    setIsCreatingProgram(true);
    try {
      const response = await fetch("/api/admin/programs-database/continuous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createProgramTitle.trim(),
          description: createProgramDescription.trim() || null,
          targetRiskTopic: createProgramTopic,
          triggerThreshold: Number(createProgramThreshold.toFixed(2)),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as ProgramTemplateCreatePayload;
      if (!response.ok || !payload.program?.id) {
        throw new Error(payload.error ?? t.programCreateError);
      }

      setCreatedProgramId(payload.program.id);
      setIsCreateProgramOpen(false);
      setNotice(t.programCreatedNotice);
      await loadDatabase();
    } catch (createError) {
      setCreateProgramError(createError instanceof Error ? createError.message : t.programCreateError);
    } finally {
      setIsCreatingProgram(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#123447]">{t.title}</h2>
        <p className="mt-1 text-sm text-[#35515f]">{t.subtitle}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadDatabase()}
            className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
          >
            {t.reload}
          </button>
          <button
            type="button"
            onClick={openCreateDrpsModal}
            className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white"
          >
            {t.createDrps}
          </button>
          <button
            type="button"
            onClick={openCreateProgramModal}
            className="rounded-full border border-[#0f5b73] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
          >
            {t.createProgram}
          </button>
        </div>
        {notice ? <p className="mt-2 text-sm text-[#1f6b3d]">{notice}</p> : null}
        {createdDrpsId || createdProgramId ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {createdDrpsId ? (
              <Link
                href={`/manager/programs/drps/${createdDrpsId}`}
                className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
              >
                {t.createdOpen}: DRPS
              </Link>
            ) : null}
            {createdProgramId ? (
              <Link
                href={`/manager/programs/continuous/${createdProgramId}`}
                className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
              >
                {t.createdOpen}: {t.prgName}
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[#123447]">{t.diagnosticsTitle}</h3>
            <p className="mt-1 text-sm text-[#35515f]">{t.diagnosticsSubtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openCreateDrpsModal}
              className="rounded-full border border-[#0f5b73] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
            >
              {t.createDrps}
            </button>
            <button
              type="button"
              onClick={() => setIsDiagnosticsOpen((current) => !current)}
              aria-expanded={isDiagnosticsOpen}
              className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
            >
              {isDiagnosticsOpen ? t.closeTable : t.openTable}
            </button>
          </div>
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
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openCreateProgramModal}
              className="rounded-full border border-[#0f5b73] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
            >
              {t.createProgram}
            </button>
            <button
              type="button"
              onClick={() => setIsContinuousOpen((current) => !current)}
              aria-expanded={isContinuousOpen}
              className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
            >
              {isContinuousOpen ? t.closeTable : t.openTable}
            </button>
          </div>
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

      {isCreateDrpsOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-lg font-semibold text-[#123447]">{t.drpsModalTitle}</h4>
                <p className="text-sm text-[#4f6977]">{t.drpsModalSubtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateDrpsOpen(false)}
                className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
              >
                {t.modalClose}
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-xs text-[#4f6977] md:col-span-2">
                {t.drpsFieldName}
                <input
                  value={createDrpsName}
                  onChange={(event) => setCreateDrpsName(event.target.value)}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                  placeholder="Ex: DRPS 2026 - Unidade Sul"
                />
              </label>

              <label className="text-xs text-[#4f6977]">
                {t.drpsFieldSlug}
                <input
                  value={createDrpsSlug}
                  onChange={(event) => setCreateDrpsSlug(event.target.value)}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                  placeholder="drps-2026-unidade-sul"
                />
              </label>

              <label className="text-xs text-[#4f6977]">
                {t.drpsFieldStatus}
                <select
                  value={createDrpsStatus}
                  onChange={(event) => setCreateDrpsStatus(event.target.value as "draft" | "live")}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                >
                  <option value="draft">{t.draft}</option>
                  <option value="live">{t.live}</option>
                </select>
              </label>

              <label className="text-xs text-[#4f6977]">
                {t.drpsFieldKAnon}
                <input
                  type="number"
                  min={3}
                  max={20}
                  value={createDrpsKAnon}
                  onChange={(event) => setCreateDrpsKAnon(Number(event.target.value || 5))}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                />
              </label>

              <label className="text-xs text-[#4f6977]">
                {t.drpsFieldClone}
                <select
                  value={createDrpsSourceId}
                  onChange={(event) => setCreateDrpsSourceId(event.target.value)}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                >
                  <option value="">{t.drpsCloneNone}</option>
                  {clonableDiagnostics.map((diagnostic) => (
                    <option key={`clone-${diagnostic.id}`} value={diagnostic.id}>
                      {diagnostic.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {createDrpsError ? <p className="mt-3 text-sm text-red-600">{createDrpsError}</p> : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCreateDrps()}
                disabled={isCreatingDrps}
                className="rounded-full bg-[#0f5b73] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isCreatingDrps ? t.creating : t.modalCreate}
              </button>
              <button
                type="button"
                onClick={() => setIsCreateDrpsOpen(false)}
                className="rounded-full border border-[#9ec8db] px-4 py-2 text-sm font-semibold text-[#0f5b73]"
              >
                {t.modalCancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCreateProgramOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-lg font-semibold text-[#123447]">{t.programModalTitle}</h4>
                <p className="text-sm text-[#4f6977]">{t.programModalSubtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateProgramOpen(false)}
                className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
              >
                {t.modalClose}
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-xs text-[#4f6977] md:col-span-2">
                {t.programFieldTitle}
                <input
                  value={createProgramTitle}
                  onChange={(event) => setCreateProgramTitle(event.target.value)}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                  placeholder="Ex: Programa de acolhimento psicossocial"
                />
              </label>

              <label className="text-xs text-[#4f6977] md:col-span-2">
                {t.programFieldDescription}
                <textarea
                  value={createProgramDescription}
                  onChange={(event) => setCreateProgramDescription(event.target.value)}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                  rows={3}
                />
              </label>

              <label className="text-xs text-[#4f6977]">
                {t.programFieldTopic}
                <input
                  type="number"
                  min={1}
                  max={13}
                  value={createProgramTopic}
                  onChange={(event) => setCreateProgramTopic(Number(event.target.value || 1))}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                />
              </label>

              <label className="text-xs text-[#4f6977]">
                {t.programFieldThreshold}
                <input
                  type="number"
                  min={1}
                  max={3}
                  step={0.01}
                  value={createProgramThreshold}
                  onChange={(event) => setCreateProgramThreshold(Number(event.target.value || 1))}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                />
              </label>
            </div>

            {createProgramError ? (
              <p className="mt-3 text-sm text-red-600">{createProgramError}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCreateProgram()}
                disabled={isCreatingProgram}
                className="rounded-full bg-[#0f5b73] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isCreatingProgram ? t.creating : t.modalCreate}
              </button>
              <button
                type="button"
                onClick={() => setIsCreateProgramOpen(false)}
                className="rounded-full border border-[#9ec8db] px-4 py-2 text-sm font-semibold text-[#0f5b73]"
              >
                {t.modalCancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
