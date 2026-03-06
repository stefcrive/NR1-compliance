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
  evaluation: {
    submissions: number;
    overallAverage: number | null;
    unavailable: boolean;
    byQuestion: Array<{
      question: string;
      average: number | null;
    }>;
  };
};

type RiskTopicMeta = {
  id: number;
  code: string;
  labelEn: string;
  labelPt: string;
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

type ClientOption = {
  id: string;
  companyName: string;
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
    prgRiskGroup: "Psychosocial risk",
    prgEvaluation: "Evaluation averages",
    prgSubmissions: "Submissions",
    prgOverall: "Overall",
    prgViewAverages: "View averages",
    prgCloseAverages: "Close averages",
    prgModalTitle: "Questionnaire average by question",
    prgNoEvaluation: "No questionnaire submissions yet.",
    prgEvaluationUnavailable:
      "Evaluation data unavailable (apply migration 20260306013000_client_program_evaluations_and_online_activity_seed.sql).",
    prgTopicUnknown: "Unmapped topic",
    assignCompany: "Company",
    assignStatus: "Status",
    assignSelectAll: "Select all",
    assignClear: "Clear",
    assignSelected: "Assign selected",
    assignSelectingHint: "Select one or more programs below and assign them to a company.",
    assignValidationCompany: "Select a company before assigning programs.",
    assignValidationPrograms: "Select at least one program to assign.",
    assignPartialError: "Some assignments failed:",
    assigning: "Assigning...",
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
    prgRiskGroup: "Risco psicossocial",
    prgEvaluation: "Medias de avaliacao",
    prgSubmissions: "Submissoes",
    prgOverall: "Media geral",
    prgViewAverages: "Ver medias",
    prgCloseAverages: "Fechar medias",
    prgModalTitle: "Media do questionario por pergunta",
    prgNoEvaluation: "Sem submissoes do questionario ate o momento.",
    prgEvaluationUnavailable:
      "Dados de avaliacao indisponiveis (aplique a migration 20260306013000_client_program_evaluations_and_online_activity_seed.sql).",
    prgTopicUnknown: "Topico nao mapeado",
    assignCompany: "Empresa",
    assignStatus: "Status",
    assignSelectAll: "Selecionar todos",
    assignClear: "Limpar",
    assignSelected: "Atribuir selecionados",
    assignSelectingHint: "Selecione um ou mais programas abaixo e atribua para uma empresa.",
    assignValidationCompany: "Selecione uma empresa antes de atribuir programas.",
    assignValidationPrograms: "Selecione ao menos um programa para atribuir.",
    assignPartialError: "Algumas atribuicoes falharam:",
    assigning: "Atribuindo...",
    prgNone: "Nenhum programa continuo disponivel.",
    draft: "Rascunho",
    live: "Ativo",
    closed: "Concluido",
    archived: "Arquivado",
  },
} as const;

const RISK_TOPICS: RiskTopicMeta[] = [
  { id: 1, code: "T01", labelEn: "Harassment", labelPt: "Assedio" },
  { id: 2, code: "T02", labelEn: "Lack of support", labelPt: "Falta de suporte" },
  { id: 3, code: "T03", labelEn: "Change management", labelPt: "Gestao de mudancas" },
  { id: 4, code: "T04", labelEn: "Role clarity", labelPt: "Clareza de papel" },
  { id: 5, code: "T05", labelEn: "Recognition", labelPt: "Reconhecimento" },
  { id: 6, code: "T06", labelEn: "Autonomy", labelPt: "Autonomia" },
  { id: 7, code: "T07", labelEn: "Organizational justice", labelPt: "Justica organizacional" },
  { id: 8, code: "T08", labelEn: "Traumatic events", labelPt: "Eventos traumaticos" },
  { id: 9, code: "T09", labelEn: "Underload", labelPt: "Subcarga" },
  { id: 10, code: "T10", labelEn: "Overload", labelPt: "Sobrecarga" },
  { id: 11, code: "T11", labelEn: "Relationships", labelPt: "Relacionamentos" },
  { id: 12, code: "T12", labelEn: "Communication", labelPt: "Comunicacao" },
  { id: 13, code: "T13", labelEn: "Remote/isolated work", labelPt: "Trabalho remoto/isolado" },
];

const RISK_TOPIC_BY_ID = new Map<number, RiskTopicMeta>(RISK_TOPICS.map((item) => [item.id, item]));

function formatRiskTopic(topicId: number, locale: "pt" | "en", fallback: string) {
  const topic = RISK_TOPIC_BY_ID.get(topicId);
  if (!topic) return fallback;
  return `${topic.code} - ${locale === "pt" ? topic.labelPt : topic.labelEn}`;
}

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
  const [selectedEvaluationProgramId, setSelectedEvaluationProgramId] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedProgramIds, setSelectedProgramIds] = useState<string[]>([]);
  const [assignStatus, setAssignStatus] = useState<"Recommended" | "Active" | "Completed">("Active");
  const [isAssigningSelected, setIsAssigningSelected] = useState(false);

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
  const groupedContinuousPrograms = useMemo(() => {
    const groups = new Map<number, { topicId: number; label: string; programs: ContinuousProgram[] }>();
    const sorted = [...continuousPrograms].sort((left, right) => left.title.localeCompare(right.title));

    for (const program of sorted) {
      const topicId = Number.isInteger(program.targetRiskTopic) ? program.targetRiskTopic : 999;
      const label = formatRiskTopic(topicId, locale, t.prgTopicUnknown);
      const current = groups.get(topicId) ?? { topicId, label, programs: [] as ContinuousProgram[] };
      current.programs.push(program);
      groups.set(topicId, current);
    }

    return Array.from(groups.values()).sort((left, right) => left.topicId - right.topicId);
  }, [continuousPrograms, locale, t.prgTopicUnknown]);
  const selectedEvaluationProgram = useMemo(
    () =>
      selectedEvaluationProgramId
        ? continuousPrograms.find((item) => item.id === selectedEvaluationProgramId) ?? null
        : null,
    [continuousPrograms, selectedEvaluationProgramId],
  );
  const selectedProgramIdSet = useMemo(() => new Set(selectedProgramIds), [selectedProgramIds]);

  async function loadDatabase() {
    setIsLoading(true);
    setError("");
    try {
      const [databaseResponse, clientsResponse] = await Promise.all([
        fetch("/api/admin/programs-database", { cache: "no-store" }),
        fetch("/api/admin/clients", { cache: "no-store" }),
      ]);

      if (!databaseResponse.ok) {
        const payload = (await databaseResponse.json()) as { error?: string };
        throw new Error(payload.error ?? "Could not load programs database.");
      }

      if (!clientsResponse.ok) {
        const payload = (await clientsResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Could not load clients.");
      }

      const payload = (await databaseResponse.json()) as {
        drpsDiagnostics: DrpsDiagnostic[];
        continuousPrograms: ContinuousProgram[];
      };
      const clientsPayload = (await clientsResponse.json()) as {
        clients: Array<{ id: string; companyName: string }>;
      };
      const nextClients = (clientsPayload.clients ?? []).map((item) => ({
        id: item.id,
        companyName: item.companyName,
      }));
      const nextPrograms = payload.continuousPrograms ?? [];

      setDiagnostics(payload.drpsDiagnostics ?? []);
      setContinuousPrograms(nextPrograms);
      setClients(nextClients);
      setSelectedClientId((current) => {
        if (current && nextClients.some((item) => item.id === current)) return current;
        return nextClients[0]?.id ?? "";
      });
      setSelectedProgramIds((current) =>
        current.filter((programId) => nextPrograms.some((program) => program.id === programId)),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load programs database.");
      setDiagnostics([]);
      setContinuousPrograms([]);
      setClients([]);
      setSelectedClientId("");
      setSelectedProgramIds([]);
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

  function toggleProgramSelection(programId: string) {
    setSelectedProgramIds((current) =>
      current.includes(programId)
        ? current.filter((item) => item !== programId)
        : [...current, programId],
    );
  }

  async function handleAssignSelectedPrograms() {
    setNotice("");
    setError("");

    if (!selectedClientId) {
      setError(t.assignValidationCompany);
      return;
    }
    if (selectedProgramIds.length === 0) {
      setError(t.assignValidationPrograms);
      return;
    }

    setIsAssigningSelected(true);
    const failedProgramIds: string[] = [];
    const successfulProgramIds: string[] = [];
    const failureMessages: string[] = [];
    try {
      for (const programId of selectedProgramIds) {
        const response = await fetch(`/api/admin/clients/${selectedClientId}/programs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            programId,
            status: assignStatus,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          failedProgramIds.push(programId);
          failureMessages.push(payload.error ?? `Could not assign program ${programId}.`);
        } else {
          successfulProgramIds.push(programId);
        }
      }

      setSelectedProgramIds(failedProgramIds);
      await loadDatabase();

      if (successfulProgramIds.length > 0) {
        setNotice(
          successfulProgramIds.length === 1
            ? "1 program assigned."
            : `${successfulProgramIds.length} programs assigned.`,
        );
      }

      if (failedProgramIds.length > 0) {
        setError(`${t.assignPartialError} ${failureMessages.join(" ")}`);
      }
    } finally {
      setIsAssigningSelected(false);
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
            <table className="nr-table min-w-full text-sm">
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
        <div className="mt-3 rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
          <p className="text-xs text-[#35515f]">{t.assignSelectingHint}</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-xs text-[#4f6977]">
              {t.assignCompany}
              <select
                value={selectedClientId}
                onChange={(event) => setSelectedClientId(event.target.value)}
                className="mt-1 min-w-56 rounded border border-[#c9dce8] px-3 py-2 text-sm"
              >
                {clients.length === 0 ? <option value="">-</option> : null}
                {clients.map((clientOption) => (
                  <option key={`assign-client-${clientOption.id}`} value={clientOption.id}>
                    {clientOption.companyName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[#4f6977]">
              {t.assignStatus}
              <select
                value={assignStatus}
                onChange={(event) =>
                  setAssignStatus(event.target.value as "Recommended" | "Active" | "Completed")
                }
                className="mt-1 rounded border border-[#c9dce8] px-3 py-2 text-sm"
              >
                <option value="Recommended">Recommended</option>
                <option value="Active">Active</option>
                <option value="Completed">Completed</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => setSelectedProgramIds(continuousPrograms.map((program) => program.id))}
              className="rounded-full border border-[#9ec8db] px-3 py-2 text-xs font-semibold text-[#0f5b73]"
            >
              {t.assignSelectAll}
            </button>
            <button
              type="button"
              onClick={() => setSelectedProgramIds([])}
              className="rounded-full border border-[#c9dce8] px-3 py-2 text-xs font-semibold text-[#35515f]"
            >
              {t.assignClear}
            </button>
            <button
              type="button"
              onClick={() => void handleAssignSelectedPrograms()}
              disabled={isAssigningSelected || selectedProgramIds.length === 0 || !selectedClientId}
              className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {isAssigningSelected
                ? t.assigning
                : `${t.assignSelected} (${selectedProgramIds.length})`}
            </button>
          </div>
        </div>
        {isContinuousOpen && !isLoading && !error ? (
          <div className="mt-3 space-y-4">
            {groupedContinuousPrograms.length === 0 ? (
              <p className="text-xs text-[#5a7383]">{t.prgNone}</p>
            ) : (
              groupedContinuousPrograms.map((group) => (
                <div key={`risk-group-${group.topicId}`} className="overflow-hidden rounded-xl border border-[#d8e4ee]">
                  <div className="border-b border-[#d8e4ee] bg-[#f4f9fc] px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#2d5569]">
                      {t.prgRiskGroup}: {group.label}
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="nr-table min-w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="px-2 py-2 text-left">#</th>
                          <th className="px-2 py-2 text-left">{t.prgName}</th>
                          <th className="px-2 py-2 text-left">{t.prgThreshold}</th>
                          <th className="px-2 py-2 text-left">{t.prgActive}</th>
                          <th className="px-2 py-2 text-left">{t.prgTotal}</th>
                          <th className="px-2 py-2 text-left">{t.prgSubmissions}</th>
                          <th className="px-2 py-2 text-left">{t.prgOverall}</th>
                          <th className="px-2 py-2 text-left">{t.prgEvaluation}</th>
                          <th className="px-2 py-2 text-left">{t.openDetails}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.programs.map((program) => (
                          <tr key={program.id} className="border-b">
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                checked={selectedProgramIdSet.has(program.id)}
                                onChange={() => toggleProgramSelection(program.id)}
                                className="h-4 w-4 rounded border-[#9ec8db] text-[#0f5b73]"
                              />
                            </td>
                            <td className="px-2 py-2">
                              <Link
                                href={`/manager/programs/continuous/${program.id}`}
                                className="font-semibold text-[#123447] hover:text-[#0f5b73] hover:underline"
                              >
                                {program.title}
                              </Link>
                              <p className="text-xs text-[#55707f]">{program.description ?? "-"}</p>
                            </td>
                            <td className="px-2 py-2">{program.triggerThreshold.toFixed(2)}</td>
                            <td className="px-2 py-2">{program.assignments.active}</td>
                            <td className="px-2 py-2">{program.assignments.total}</td>
                            <td className="px-2 py-2">{program.evaluation.submissions}</td>
                            <td className="px-2 py-2">
                              {program.evaluation.overallAverage !== null
                                ? `${program.evaluation.overallAverage.toFixed(2)} / 5`
                                : "-"}
                            </td>
                            <td className="px-2 py-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedEvaluationProgramId((current) =>
                                    current === program.id ? null : program.id,
                                  )
                                }
                                className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                              >
                                {selectedEvaluationProgramId === program.id
                                  ? t.prgCloseAverages
                                  : t.prgViewAverages}
                              </button>
                            </td>
                            <td className="px-2 py-2">
                              <Link
                                href={`/manager/programs/continuous/${program.id}`}
                                className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                              >
                                {t.openDetails}
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}
      </section>

      {selectedEvaluationProgram ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-lg font-semibold text-[#123447]">{t.prgModalTitle}</h4>
                <p className="text-sm text-[#4f6977]">
                  {selectedEvaluationProgram.title} |{" "}
                  {formatRiskTopic(selectedEvaluationProgram.targetRiskTopic, locale, t.prgTopicUnknown)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvaluationProgramId(null)}
                className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
              >
                {t.modalClose}
              </button>
            </div>

            {selectedEvaluationProgram.evaluation.unavailable ? (
              <p className="mt-4 text-sm text-amber-700">{t.prgEvaluationUnavailable}</p>
            ) : selectedEvaluationProgram.evaluation.submissions === 0 ? (
              <p className="mt-4 text-sm text-[#5a7383]">{t.prgNoEvaluation}</p>
            ) : (
              <div className="mt-4 space-y-4">
                <p className="text-sm text-[#35515f]">
                  {t.prgSubmissions}: {selectedEvaluationProgram.evaluation.submissions} | {t.prgOverall}:{" "}
                  {selectedEvaluationProgram.evaluation.overallAverage !== null
                    ? `${selectedEvaluationProgram.evaluation.overallAverage.toFixed(2)} / 5`
                    : "-"}
                </p>
                <div className="space-y-3">
                  {selectedEvaluationProgram.evaluation.byQuestion.map((item) => (
                    <div key={item.question} className="rounded-xl border border-[#e1edf4] px-3 py-2">
                      <p className="text-sm text-[#35515f]">{item.question}</p>
                      <p className="mt-1 text-sm font-semibold text-[#123447]">
                        {item.average !== null ? `${item.average.toFixed(2)} / 5` : "-"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

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
