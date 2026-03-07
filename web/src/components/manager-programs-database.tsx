"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useManagerLocale } from "@/components/manager-locale";
import {
  CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCIES,
  DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY,
  type ContinuousProgramMaterial,
  type ContinuousProgramScheduleFrequency,
} from "@/lib/continuous-programs";

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
  sessionCount: number;
  sessions: Array<{
    id: string;
    title: string;
  }>;
  assignments: {
    total: number;
    recommended: number;
    active: number;
    completed: number;
  };
  assignedCompanies: Array<{
    id: string;
    companyName: string;
  }>;
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

type SessionCatalogItem = {
  catalogId: string;
  sourceType: "program" | "library";
  sourceProgramId: string | null;
  sourceProgramTitle: string;
  sourceTargetRiskTopic: number | null;
  sourceTriggerThreshold: number | null;
  sessionId: string;
  sessionIndex: number | null;
  sessionTitle: string;
  notes: string | null;
  preparationRequired: string | null;
  materials: ContinuousProgramMaterial[];
  materialCount: number;
  moduleOrder?: number | null;
  moduleTitle?: string | null;
  topicOrder?: number | null;
  topicTitle?: string | null;
  assignedProgramCount?: number;
  assignedPrograms?: Array<{ programId: string; programTitle: string }>;
};

type ContinuousProgramGroup = {
  key: string;
  label: string;
  programs: ContinuousProgram[];
  isSpecialCategory: boolean;
};

const LEADERSHIP_COACHING_CATEGORY_TAG = "[category:leadership-coaching-rh]";

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
    expandSection: "Expand section",
    collapseSection: "Collapse section",
    diagNone: "No DRPS templates available.",
    sourceSurvey: "Survey base",
    sourceLegacy: "Legacy DRPS",
    continuousTitle: "Continuous Programs (Campaigns)",
    continuousSubtitle:
      "Preventive and interventive programs activated according to DRPS risk thresholds.",
    leadershipCategoryTitle: "Treinamento/coaching de lideres, gestao, e RH.",
    programModalTitle: "Create continuous program",
    programModalSubtitle: "Create a new preventive or interventive program template.",
    programFieldTitle: "Title",
    programFieldDescription: "Description (optional)",
    programFieldTopic: "Risk category",
    programFieldThreshold: "Trigger threshold",
    programFieldFrequency: "Frequency",
    programFieldDuration: "Duration (months)",
    programValidationTitle: "Program title must have at least 3 characters.",
    programValidationTopic: "Target topic must be between 1 and 13.",
    programValidationThreshold: "Trigger threshold must be between 1.00 and 3.00.",
    programValidationDuration: "Duration must be between 1 and 24 months.",
    programCreateError: "Could not create continuous program.",
    programCreatedNotice: "Continuous program created.",
    prgName: "Program",
    prgTopic: "Target topic",
    prgThreshold: "Trigger",
    prgSessions: "Sessions",
    prgActive: "Active",
    prgTotal: "Total assignments",
    prgRiskGroup: "Psychosocial risk",
    prgEvaluation: "Evaluation averages",
    prgSubmissions: "Submissions",
    prgOverall: "Overall",
    prgViewAverages: "View averages",
    prgCloseAverages: "Close averages",
    prgModalTitle: "Questionnaire average by question",
    prgSessionsModalTitle: "Program Sessions",
    prgSessionsModalEmpty: "No sessions configured for this program.",
    prgAssignmentsModalTitle: "Assigned Companies",
    prgAssignmentsModalEmpty: "No companies assigned to this program.",
    prgNoEvaluation: "No questionnaire submissions yet.",
    prgEvaluationUnavailable:
      "Evaluation data unavailable (apply migration 20260306013000_client_program_evaluations_and_online_activity_seed.sql).",
    prgTopicUnknown: "Unmapped topic",
    assignCompany: "Company",
    assignStatus: "Status",
    assignSelectAll: "Select all",
    assignClear: "Clear",
    assignSelected: "Assign selected",
    assignModalTitle: "Select company",
    assignModalSubtitle: "Choose the company that will receive the selected programs.",
    assignNoCompanies: "No companies available.",
    assignSelectingHint: "Select one or more programs below and assign them to a company.",
    assignValidationCompany: "Select a company before assigning programs.",
    assignValidationPrograms: "Select at least one program to assign.",
    assignPartialError: "Some assignments failed:",
    assigning: "Assigning...",
    prgNone: "No continuous programs available.",
    sessionsLibraryTitle: "Campaign Sessions Library",
    sessionsLibrarySubtitle:
      "Topic-based session library grouped by modules. Search, filter, and assign to a program.",
    sessionsLibrarySearch: "Search sessions",
    sessionsLibraryFilterProgram: "Filter by module",
    sessionsLibraryFilterAllPrograms: "All modules",
    sessionsLibraryTargetProgram: "Target program",
    sessionsLibrarySelectAll: "Select all filtered",
    sessionsLibraryClear: "Clear",
    sessionsLibraryAssignSelected: "Assign selected sessions",
    sessionsLibraryAssigning: "Assigning sessions...",
    sessionsLibraryValidationProgram: "Select a target program for session assignment.",
    sessionsLibraryValidationSessions: "Select at least one session to assign.",
    sessionsLibraryAssignedNotice: "Sessions assigned to the selected program.",
    sessionsLibraryNone: "No sessions found.",
    sessionsLibraryProgramCol: "Module",
    sessionsLibrarySessionCol: "Topic",
    sessionsLibraryNotesCol: "Notes",
    sessionsLibraryFilesCol: "Files",
    sessionsLibraryAssignedProgramsCol: "Assigned programs",
    sessionsLibraryAssignedProgramsView: "View",
    sessionsLibraryAssignedProgramsNone: "No assigned programs for this topic.",
    sessionsLibraryAssignedProgramsModalTitle: "Assigned Programs",
    sessionsLibrarySourceFilterLibrary: "Uncategorized",
    sessionsLibraryNewSession: "New session",
    sessionsLibraryCreateTitle: "Create New Session",
    sessionsLibraryCreateSubtitle: "Add a reusable session to the sessions database.",
    sessionsLibraryCreateFieldTitle: "Session title",
    sessionsLibraryCreateFieldModule: "Module",
    sessionsLibraryCreateFieldModuleNew: "New module name",
    sessionsLibraryCreateModuleNewOption: "Create new module",
    sessionsLibraryCreateFieldNotes: "Session notes",
    sessionsLibraryCreateFieldPreparation: "Preparation guidance",
    sessionsLibraryCreateValidationTitle: "Session title must have at least 3 characters.",
    sessionsLibraryCreateValidationModule: "Select an existing module or create a new one.",
    sessionsLibraryCreateError: "Could not create session.",
    sessionsLibraryCreateSuccess: "Session created in sessions library.",
    sessionsLibraryCreating: "Creating session...",
    frequencies: {
      weekly: "Weekly",
      biweekly: "Biweekly",
      monthly: "Monthly",
      quarterly: "Quarterly",
      semiannual: "Semiannual",
      annual: "Annual",
      custom: "Custom",
    } satisfies Record<ContinuousProgramScheduleFrequency, string>,
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
    expandSection: "Expandir secao",
    collapseSection: "Recolher secao",
    diagNone: "Nenhum template DRPS disponivel.",
    sourceSurvey: "Base surveys",
    sourceLegacy: "DRPS legado",
    continuousTitle: "Programas Continuos (Campanhas)",
    continuousSubtitle:
      "Programas preventivos e interventivos ativados por gatilhos de risco DRPS.",
    leadershipCategoryTitle: "Treinamento/coaching de lideres, gestao, e RH.",
    programModalTitle: "Criar programa continuo",
    programModalSubtitle: "Crie um novo template preventivo ou interventivo.",
    programFieldTitle: "Titulo",
    programFieldDescription: "Descricao (opcional)",
    programFieldTopic: "Categoria de risco",
    programFieldThreshold: "Gatilho",
    programFieldFrequency: "Frequencia",
    programFieldDuration: "Duracao (meses)",
    programValidationTitle: "Titulo do programa deve ter pelo menos 3 caracteres.",
    programValidationTopic: "Topico alvo deve estar entre 1 e 13.",
    programValidationThreshold: "Gatilho deve estar entre 1.00 e 3.00.",
    programValidationDuration: "Duracao deve estar entre 1 e 24 meses.",
    programCreateError: "Nao foi possivel criar programa continuo.",
    programCreatedNotice: "Programa continuo criado.",
    prgName: "Programa",
    prgTopic: "Topico alvo",
    prgThreshold: "Gatilho",
    prgSessions: "Sessoes",
    prgActive: "Ativos",
    prgTotal: "Total atribuicoes",
    prgRiskGroup: "Risco psicossocial",
    prgEvaluation: "Medias de avaliacao",
    prgSubmissions: "Submissoes",
    prgOverall: "Media geral",
    prgViewAverages: "Ver medias",
    prgCloseAverages: "Fechar medias",
    prgModalTitle: "Media do questionario por pergunta",
    prgSessionsModalTitle: "Sessoes do Programa",
    prgSessionsModalEmpty: "Nenhuma sessao configurada para este programa.",
    prgAssignmentsModalTitle: "Empresas Atribuidas",
    prgAssignmentsModalEmpty: "Nenhuma empresa atribuida para este programa.",
    prgNoEvaluation: "Sem submissoes do questionario ate o momento.",
    prgEvaluationUnavailable:
      "Dados de avaliacao indisponiveis (aplique a migration 20260306013000_client_program_evaluations_and_online_activity_seed.sql).",
    prgTopicUnknown: "Topico nao mapeado",
    assignCompany: "Empresa",
    assignStatus: "Status",
    assignSelectAll: "Selecionar todos",
    assignClear: "Limpar",
    assignSelected: "Atribuir selecionados",
    assignModalTitle: "Selecionar empresa",
    assignModalSubtitle: "Escolha a empresa que recebera os programas selecionados.",
    assignNoCompanies: "Nenhuma empresa disponivel.",
    assignSelectingHint: "Selecione um ou mais programas abaixo e atribua para uma empresa.",
    assignValidationCompany: "Selecione uma empresa antes de atribuir programas.",
    assignValidationPrograms: "Selecione ao menos um programa para atribuir.",
    assignPartialError: "Algumas atribuicoes falharam:",
    assigning: "Atribuindo...",
    prgNone: "Nenhum programa continuo disponivel.",
    sessionsLibraryTitle: "Biblioteca de Sessoes de Campanha",
    sessionsLibrarySubtitle:
      "Biblioteca de sessoes por topico, agrupada em modulos. Pesquise, filtre e atribua para um programa.",
    sessionsLibrarySearch: "Buscar sessoes",
    sessionsLibraryFilterProgram: "Filtrar por modulo",
    sessionsLibraryFilterAllPrograms: "Todos os modulos",
    sessionsLibraryTargetProgram: "Programa de destino",
    sessionsLibrarySelectAll: "Selecionar filtrados",
    sessionsLibraryClear: "Limpar",
    sessionsLibraryAssignSelected: "Atribuir sessoes selecionadas",
    sessionsLibraryAssigning: "Atribuindo sessoes...",
    sessionsLibraryValidationProgram: "Selecione um programa de destino para atribuir sessoes.",
    sessionsLibraryValidationSessions: "Selecione ao menos uma sessao para atribuir.",
    sessionsLibraryAssignedNotice: "Sessoes atribuidas ao programa selecionado.",
    sessionsLibraryNone: "Nenhuma sessao encontrada.",
    sessionsLibraryProgramCol: "Modulo",
    sessionsLibrarySessionCol: "Topico",
    sessionsLibraryNotesCol: "Notas",
    sessionsLibraryFilesCol: "Arquivos",
    sessionsLibraryAssignedProgramsCol: "Programas atribuidos",
    sessionsLibraryAssignedProgramsView: "Ver",
    sessionsLibraryAssignedProgramsNone: "Nenhum programa atribuido para este topico.",
    sessionsLibraryAssignedProgramsModalTitle: "Programas Atribuidos",
    sessionsLibrarySourceFilterLibrary: "Sem modulo",
    sessionsLibraryNewSession: "Nova sessao",
    sessionsLibraryCreateTitle: "Criar Nova Sessao",
    sessionsLibraryCreateSubtitle: "Adicione uma sessao reutilizavel ao banco de sessoes.",
    sessionsLibraryCreateFieldTitle: "Titulo da sessao",
    sessionsLibraryCreateFieldModule: "Modulo",
    sessionsLibraryCreateFieldModuleNew: "Nome do novo modulo",
    sessionsLibraryCreateModuleNewOption: "Criar novo modulo",
    sessionsLibraryCreateFieldNotes: "Notas da sessao",
    sessionsLibraryCreateFieldPreparation: "Orientacao de preparacao",
    sessionsLibraryCreateValidationTitle: "Titulo da sessao deve ter pelo menos 3 caracteres.",
    sessionsLibraryCreateValidationModule:
      "Selecione um modulo existente ou crie um novo.",
    sessionsLibraryCreateError: "Nao foi possivel criar sessao.",
    sessionsLibraryCreateSuccess: "Sessao criada na biblioteca de sessoes.",
    sessionsLibraryCreating: "Criando sessao...",
    frequencies: {
      weekly: "Semanal",
      biweekly: "Quinzenal",
      monthly: "Mensal",
      quarterly: "Trimestral",
      semiannual: "Semestral",
      annual: "Anual",
      custom: "Personalizada",
    } satisfies Record<ContinuousProgramScheduleFrequency, string>,
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

function hasLeadershipCoachingCategory(program: ContinuousProgram) {
  const description = program.description ?? "";
  return description.includes(LEADERSHIP_COACHING_CATEGORY_TAG);
}

function renderProgramDescription(description: string | null) {
  if (!description) return "-";
  const normalized = description.replace(LEADERSHIP_COACHING_CATEGORY_TAG, "").trim();
  return normalized.length > 0 ? normalized : "-";
}

function ChevronToggleButton({
  isOpen,
  onToggle,
  label,
  expandLabel,
  collapseLabel,
  className = "",
}: {
  isOpen: boolean;
  onToggle: () => void;
  label: string;
  expandLabel: string;
  collapseLabel: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      aria-label={`${isOpen ? collapseLabel : expandLabel}: ${label}`}
      title={`${isOpen ? collapseLabel : expandLabel}: ${label}`}
      className={className}
    >
      <span aria-hidden="true">{isOpen ? "\u25B2" : "\u25BC"}</span>
    </button>
  );
}

function fmtDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

function fmtWindow(startsAt: string | null, closesAt: string | null) {
  return `${fmtDate(startsAt)} - ${fmtDate(closesAt)}`;
}

function sourceFilterKey(item: SessionCatalogItem) {
  const moduleOrder = Number(item.moduleOrder);
  const safeOrder = Number.isFinite(moduleOrder) ? moduleOrder : 999;
  const moduleTitle = (item.moduleTitle ?? "").trim();
  return moduleTitle ? `module:${safeOrder}:${moduleTitle}` : "__uncategorized__";
}

const CREATE_SESSION_NEW_MODULE_OPTION = "__new_module__";

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
  const [createProgramFrequency, setCreateProgramFrequency] = useState<ContinuousProgramScheduleFrequency>(
    DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY,
  );
  const [createProgramDurationMonths, setCreateProgramDurationMonths] = useState(6);
  const [createdDrpsId, setCreatedDrpsId] = useState<string | null>(null);
  const [createdProgramId, setCreatedProgramId] = useState<string | null>(null);
  const [selectedEvaluationProgramId, setSelectedEvaluationProgramId] = useState<string | null>(null);
  const [isSessionsLibraryOpen, setIsSessionsLibraryOpen] = useState(true);
  const [sessionsCatalog, setSessionsCatalog] = useState<SessionCatalogItem[]>([]);
  const [sessionSearchTerm, setSessionSearchTerm] = useState("");
  const [sessionSourceProgramFilterId, setSessionSourceProgramFilterId] = useState("all");
  const [selectedSessionCatalogIds, setSelectedSessionCatalogIds] = useState<string[]>([]);
  const [targetSessionProgramId, setTargetSessionProgramId] = useState("");
  const [isAssigningCatalogSessions, setIsAssigningCatalogSessions] = useState(false);
  const [isCreateSessionOpen, setIsCreateSessionOpen] = useState(false);
  const [createSessionTitle, setCreateSessionTitle] = useState("");
  const [createSessionModule, setCreateSessionModule] = useState("");
  const [createSessionNewModule, setCreateSessionNewModule] = useState("");
  const [createSessionNotes, setCreateSessionNotes] = useState("");
  const [createSessionPreparation, setCreateSessionPreparation] = useState("");
  const [createSessionError, setCreateSessionError] = useState("");
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [selectedSessionAssignmentItem, setSelectedSessionAssignmentItem] =
    useState<SessionCatalogItem | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedProgramIds, setSelectedProgramIds] = useState<string[]>([]);
  const [assignStatus, setAssignStatus] = useState<"Recommended" | "Active" | "Completed">("Active");
  const [isAssigningSelected, setIsAssigningSelected] = useState(false);
  const [isAssignProgramsModalOpen, setIsAssignProgramsModalOpen] = useState(false);
  const [selectedProgramSessionsProgramId, setSelectedProgramSessionsProgramId] = useState<string | null>(
    null,
  );
  const [selectedAssignedCompaniesProgramId, setSelectedAssignedCompaniesProgramId] = useState<string | null>(
    null,
  );
  const sessionReturnTo = "/manager/programs";
  function withSessionReturnTo(href: string) {
    const separator = href.includes("?") ? "&" : "?";
    return `${href}${separator}returnTo=${encodeURIComponent(sessionReturnTo)}`;
  }
  function getSessionLibraryHref(sessionId: string) {
    return withSessionReturnTo(
      `/manager/programs/sessions/library/${encodeURIComponent(sessionId)}`,
    );
  }
  function getProgramSessionHref(programId: string, sessionId: string) {
    return withSessionReturnTo(
      `/manager/programs/sessions/program/${encodeURIComponent(programId)}/${encodeURIComponent(
        sessionId,
      )}`,
    );
  }

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
  const continuousProgramGroups = useMemo(() => {
    const riskGroups = new Map<number, { topicId: number; label: string; programs: ContinuousProgram[] }>();
    const specialCategoryPrograms: ContinuousProgram[] = [];
    const sorted = [...continuousPrograms].sort((left, right) => left.title.localeCompare(right.title));

    for (const program of sorted) {
      if (hasLeadershipCoachingCategory(program)) {
        specialCategoryPrograms.push(program);
        continue;
      }
      const topicId = Number.isInteger(program.targetRiskTopic) ? program.targetRiskTopic : 999;
      const label = formatRiskTopic(topicId, locale, t.prgTopicUnknown);
      const current = riskGroups.get(topicId) ?? { topicId, label, programs: [] as ContinuousProgram[] };
      current.programs.push(program);
      riskGroups.set(topicId, current);
    }

    const nextGroups: ContinuousProgramGroup[] = [];

    if (specialCategoryPrograms.length > 0) {
      nextGroups.push({
        key: "category:leadership-coaching-rh",
        label: t.leadershipCategoryTitle,
        programs: specialCategoryPrograms,
        isSpecialCategory: true,
      });
    }

    for (const group of Array.from(riskGroups.values()).sort((left, right) => left.topicId - right.topicId)) {
      nextGroups.push({
        key: `topic:${group.topicId}`,
        label: group.label,
        programs: group.programs,
        isSpecialCategory: false,
      });
    }

    return nextGroups;
  }, [continuousPrograms, locale, t.leadershipCategoryTitle, t.prgTopicUnknown]);
  const [openContinuousGroupByKey, setOpenContinuousGroupByKey] = useState<Record<string, boolean>>({});
  const selectedEvaluationProgram = useMemo(
    () =>
      selectedEvaluationProgramId
        ? continuousPrograms.find((item) => item.id === selectedEvaluationProgramId) ?? null
        : null,
    [continuousPrograms, selectedEvaluationProgramId],
  );
  const selectedAssignedCompaniesProgram = useMemo(
    () =>
      selectedAssignedCompaniesProgramId
        ? continuousPrograms.find((item) => item.id === selectedAssignedCompaniesProgramId) ?? null
        : null,
    [continuousPrograms, selectedAssignedCompaniesProgramId],
  );
  const selectedProgramSessionsProgram = useMemo(
    () =>
      selectedProgramSessionsProgramId
        ? continuousPrograms.find((item) => item.id === selectedProgramSessionsProgramId) ?? null
        : null,
    [continuousPrograms, selectedProgramSessionsProgramId],
  );
  const selectedProgramIdSet = useMemo(() => new Set(selectedProgramIds), [selectedProgramIds]);
  const selectedSessionCatalogIdSet = useMemo(
    () => new Set(selectedSessionCatalogIds),
    [selectedSessionCatalogIds],
  );
  useEffect(() => {
    setOpenContinuousGroupByKey((previous) => {
      const next: Record<string, boolean> = {};
      for (const group of continuousProgramGroups) {
        next[group.key] = previous[group.key] ?? true;
      }
      return next;
    });
  }, [continuousProgramGroups]);
  const sessionSourceFilterOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const item of sessionsCatalog) {
      const moduleLabel = (item.moduleTitle ?? "").trim() || t.sessionsLibrarySourceFilterLibrary;
      options.set(sourceFilterKey(item), moduleLabel);
    }
    return Array.from(options.entries()).sort((left, right) => left[1].localeCompare(right[1]));
  }, [sessionsCatalog, t.sessionsLibrarySourceFilterLibrary]);
  const filteredSessionsCatalog = useMemo(() => {
    const normalizedSearch = sessionSearchTerm.trim().toLowerCase();
    return sessionsCatalog.filter((item) => {
      if (sessionSourceProgramFilterId !== "all" && sourceFilterKey(item) !== sessionSourceProgramFilterId) {
        return false;
      }
      if (!normalizedSearch) return true;
      const searchable = [
        item.moduleTitle ?? "",
        item.topicTitle ?? "",
        item.sessionTitle,
        item.notes ?? "",
        item.preparationRequired ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(normalizedSearch);
    });
  }, [sessionSearchTerm, sessionSourceProgramFilterId, sessionsCatalog]);
  const sessionModuleOptions = useMemo(() => {
    const options = new Map<string, number>();
    for (const item of sessionsCatalog) {
      const moduleTitle = (item.moduleTitle ?? "").trim();
      if (!moduleTitle) continue;
      const moduleOrder = Number(item.moduleOrder);
      const safeOrder = Number.isFinite(moduleOrder) ? moduleOrder : 999;
      const currentOrder = options.get(moduleTitle);
      if (currentOrder === undefined || safeOrder < currentOrder) {
        options.set(moduleTitle, safeOrder);
      }
    }
    return Array.from(options.entries())
      .sort((left, right) => (left[1] === right[1] ? left[0].localeCompare(right[0]) : left[1] - right[1]))
      .map(([moduleTitle]) => moduleTitle);
  }, [sessionsCatalog]);
  const groupedFilteredSessionsCatalog = useMemo(() => {
    const grouped = new Map<
      string,
      { groupKey: string; moduleLabel: string; moduleOrder: number; sessions: SessionCatalogItem[] }
    >();

    for (const item of filteredSessionsCatalog) {
      const moduleOrder = Number(item.moduleOrder);
      const safeOrder = Number.isFinite(moduleOrder) ? moduleOrder : 999;
      const moduleLabel = (item.moduleTitle ?? "").trim() || t.sessionsLibrarySourceFilterLibrary;
      const groupKey = `${safeOrder}:${moduleLabel}`;
      const key = groupKey;
      const current = grouped.get(key) ?? {
        groupKey,
        moduleLabel,
        moduleOrder: safeOrder,
        sessions: [] as SessionCatalogItem[],
      };
      current.sessions.push(item);
      grouped.set(key, current);
    }

    return Array.from(grouped.values())
      .sort((left, right) =>
        left.moduleOrder === right.moduleOrder
          ? left.moduleLabel.localeCompare(right.moduleLabel)
          : left.moduleOrder - right.moduleOrder,
      )
      .map((group) => ({
        ...group,
        sessions: [...group.sessions].sort((left, right) => {
          const leftTopicOrder = Number(left.topicOrder);
          const rightTopicOrder = Number(right.topicOrder);
          const safeLeft = Number.isFinite(leftTopicOrder) ? leftTopicOrder : 999;
          const safeRight = Number.isFinite(rightTopicOrder) ? rightTopicOrder : 999;
          if (safeLeft !== safeRight) return safeLeft - safeRight;
          return left.sessionTitle.localeCompare(right.sessionTitle);
        }),
      }));
  }, [filteredSessionsCatalog, t.sessionsLibrarySourceFilterLibrary]);
  const [openSessionModuleByKey, setOpenSessionModuleByKey] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setOpenSessionModuleByKey((previous) => {
      const next: Record<string, boolean> = {};
      for (const group of groupedFilteredSessionsCatalog) {
        next[group.groupKey] = previous[group.groupKey] ?? true;
      }
      return next;
    });
  }, [groupedFilteredSessionsCatalog]);

  async function loadDatabase() {
    setIsLoading(true);
    setError("");
    try {
      const [databaseResponse, clientsResponse, sessionsCatalogResponse] = await Promise.all([
        fetch("/api/admin/programs-database", { cache: "no-store" }),
        fetch("/api/admin/clients", { cache: "no-store" }),
        fetch("/api/admin/programs-database/continuous/sessions", { cache: "no-store" }),
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
      if (!sessionsCatalogResponse.ok) {
        const sessionsErrorPayload = (await sessionsCatalogResponse.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(sessionsErrorPayload?.error ?? "Could not load sessions catalog.");
      }
      const sessionsPayload = (await sessionsCatalogResponse.json().catch(() => ({}))) as {
        sessions?: SessionCatalogItem[];
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
      setSessionsCatalog(sessionsPayload.sessions ?? []);
      setClients(nextClients);
      setSelectedClientId((current) => {
        if (current && nextClients.some((item) => item.id === current)) return current;
        return nextClients[0]?.id ?? "";
      });
      setSelectedProgramIds((current) =>
        current.filter((programId) => nextPrograms.some((program) => program.id === programId)),
      );
      setTargetSessionProgramId((current) =>
        current && nextPrograms.some((program) => program.id === current)
          ? current
          : (nextPrograms[0]?.id ?? ""),
      );
      setSelectedSessionCatalogIds((current) =>
        current.filter((catalogId) =>
          (sessionsPayload.sessions ?? []).some((item) => item.catalogId === catalogId),
        ),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load programs database.");
      setDiagnostics([]);
      setContinuousPrograms([]);
      setSessionsCatalog([]);
      setClients([]);
      setSelectedClientId("");
      setSelectedProgramIds([]);
      setTargetSessionProgramId("");
      setSelectedSessionCatalogIds([]);
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
    setCreateProgramFrequency(DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY);
    setCreateProgramDurationMonths(6);
    setIsCreateProgramOpen(true);
  }

  function openCreateSessionModal() {
    setCreateSessionError("");
    setCreateSessionTitle("");
    setCreateSessionModule(sessionModuleOptions[0] ?? CREATE_SESSION_NEW_MODULE_OPTION);
    setCreateSessionNewModule("");
    setCreateSessionNotes("");
    setCreateSessionPreparation("");
    setIsCreateSessionOpen(true);
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
    if (
      !Number.isInteger(createProgramDurationMonths) ||
      createProgramDurationMonths < 1 ||
      createProgramDurationMonths > 24
    ) {
      setCreateProgramError(t.programValidationDuration);
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
          scheduleFrequency: createProgramFrequency,
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

  async function handleCreateSession() {
    setCreateSessionError("");
    setNotice("");
    if (createSessionTitle.trim().length < 3) {
      setCreateSessionError(t.sessionsLibraryCreateValidationTitle);
      return;
    }
    const resolvedModuleTitle =
      createSessionModule === CREATE_SESSION_NEW_MODULE_OPTION
        ? createSessionNewModule.trim()
        : createSessionModule.trim();
    if (!resolvedModuleTitle) {
      setCreateSessionError(t.sessionsLibraryCreateValidationModule);
      return;
    }

    setIsCreatingSession(true);
    try {
      const response = await fetch("/api/admin/programs-database/continuous/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          title: createSessionTitle.trim(),
          moduleTitle: resolvedModuleTitle,
          notes: createSessionNotes.trim() || null,
          preparationRequired: createSessionPreparation.trim() || null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? t.sessionsLibraryCreateError);
      }

      setIsCreateSessionOpen(false);
      setNotice(t.sessionsLibraryCreateSuccess);
      await loadDatabase();
    } catch (createError) {
      setCreateSessionError(
        createError instanceof Error ? createError.message : t.sessionsLibraryCreateError,
      );
    } finally {
      setIsCreatingSession(false);
    }
  }

  function toggleProgramSelection(programId: string) {
    setSelectedProgramIds((current) =>
      current.includes(programId)
        ? current.filter((item) => item !== programId)
        : [...current, programId],
    );
  }

  function openAssignSelectedProgramsModal() {
    setNotice("");
    setError("");
    if (selectedProgramIds.length === 0) {
      setError(t.assignValidationPrograms);
      return;
    }
    if (clients.length === 0) {
      setError(t.assignNoCompanies);
      return;
    }
    setSelectedClientId((current) => {
      if (current && clients.some((item) => item.id === current)) return current;
      return clients[0]?.id ?? "";
    });
    setIsAssignProgramsModalOpen(true);
  }

  async function handleAssignSelectedPrograms(clientId: string) {
    setNotice("");
    setError("");

    if (!clientId) {
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
      setIsAssignProgramsModalOpen(false);
      for (const programId of selectedProgramIds) {
        const response = await fetch(`/api/admin/clients/${clientId}/programs`, {
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

  function toggleSessionCatalogSelection(catalogId: string) {
    setSelectedSessionCatalogIds((current) =>
      current.includes(catalogId)
        ? current.filter((item) => item !== catalogId)
        : [...current, catalogId],
    );
  }

  function toggleContinuousGroup(groupKey: string) {
    setOpenContinuousGroupByKey((current) => ({
      ...current,
      [groupKey]: !(current[groupKey] ?? true),
    }));
  }

  function toggleSessionModuleGroup(groupKey: string) {
    setOpenSessionModuleByKey((current) => ({
      ...current,
      [groupKey]: !(current[groupKey] ?? true),
    }));
  }

  async function handleAssignSelectedSessionsToProgram() {
    setNotice("");
    setError("");

    if (!targetSessionProgramId) {
      setError(t.sessionsLibraryValidationProgram);
      return;
    }
    if (selectedSessionCatalogIds.length === 0) {
      setError(t.sessionsLibraryValidationSessions);
      return;
    }

    const selectedSessions = selectedSessionCatalogIds
      .map((catalogId) => sessionsCatalog.find((item) => item.catalogId === catalogId))
      .filter((item): item is SessionCatalogItem => Boolean(item))
      .map((item) => ({ catalogId: item.catalogId }));

    if (selectedSessions.length === 0) {
      setError(t.sessionsLibraryValidationSessions);
      return;
    }

    setIsAssigningCatalogSessions(true);
    try {
      const response = await fetch("/api/admin/programs-database/continuous/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign",
          targetProgramId: targetSessionProgramId,
          sessions: selectedSessions,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not assign sessions.");
      }

      setSelectedSessionCatalogIds([]);
      setNotice(t.sessionsLibraryAssignedNotice);
      await loadDatabase();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Could not assign sessions.");
    } finally {
      setIsAssigningCatalogSessions(false);
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
          <button
            type="button"
            onClick={openCreateSessionModal}
            className="rounded-full border border-[#0f5b73] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
          >
            {t.sessionsLibraryNewSession}
          </button>
          <ChevronToggleButton
            isOpen={isSessionsLibraryOpen}
            onToggle={() => setIsSessionsLibraryOpen((current) => !current)}
            label={t.sessionsLibraryTitle}
            expandLabel={t.expandSection}
            collapseLabel={t.collapseSection}
            className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
          />
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
            <ChevronToggleButton
              isOpen={isDiagnosticsOpen}
              onToggle={() => setIsDiagnosticsOpen((current) => !current)}
              label={t.diagnosticsTitle}
              expandLabel={t.expandSection}
              collapseLabel={t.collapseSection}
              className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
            />
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
            <ChevronToggleButton
              isOpen={isContinuousOpen}
              onToggle={() => setIsContinuousOpen((current) => !current)}
              label={t.continuousTitle}
              expandLabel={t.expandSection}
              collapseLabel={t.collapseSection}
              className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
            />
          </div>
        </div>
        {isContinuousOpen ? (
          <div className="mt-3 rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
            <div className="flex flex-wrap items-end gap-2">
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
                onClick={openAssignSelectedProgramsModal}
                disabled={isAssigningSelected || selectedProgramIds.length === 0}
                className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {isAssigningSelected
                  ? t.assigning
                  : `${t.assignSelected} (${selectedProgramIds.length})`}
              </button>
            </div>
          </div>
        ) : null}
        {isContinuousOpen && !isLoading && !error ? (
          <div className="mt-3 space-y-4">
            {continuousProgramGroups.length === 0 ? (
              <p className="text-xs text-[#5a7383]">{t.prgNone}</p>
            ) : (
              continuousProgramGroups.map((group) => {
                const isGroupOpen = openContinuousGroupByKey[group.key] ?? true;
                return (
                  <div key={group.key} className="overflow-hidden rounded-xl border border-[#d8e4ee]">
                    <div className="border-b border-[#d8e4ee] bg-gradient-to-r from-[#eaf4fb] to-[#f4f9fc] px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          {!group.isSpecialCategory ? (
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#2d5569]">
                              {t.prgRiskGroup}
                            </p>
                          ) : null}
                          <p className="mt-1 text-base font-bold text-[#123447]">{group.label}</p>
                        </div>
                        <ChevronToggleButton
                          isOpen={isGroupOpen}
                          onToggle={() => toggleContinuousGroup(group.key)}
                          label={group.label}
                          expandLabel={t.expandSection}
                          collapseLabel={t.collapseSection}
                          className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                        />
                      </div>
                    </div>
                    {isGroupOpen ? (
                      <div className="overflow-x-auto">
                        <table className="nr-table min-w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="px-2 py-2 text-left">#</th>
                              <th className="px-2 py-2 text-left">{t.prgName}</th>
                              <th className="px-2 py-2 text-left">{t.prgThreshold}</th>
                              <th className="px-2 py-2 text-left">{t.prgSessions}</th>
                              <th className="px-2 py-2 text-left">{t.prgTotal}</th>
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
                                  <p className="text-xs text-[#55707f]">
                                    {renderProgramDescription(program.description)}
                                  </p>
                                </td>
                                <td className="px-2 py-2">{program.triggerThreshold.toFixed(2)}</td>
                                <td className="px-2 py-2">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedProgramSessionsProgramId(program.id)}
                                    className="font-semibold text-[#0f5b73] hover:underline"
                                  >
                                    {program.sessionCount}
                                  </button>
                                </td>
                                <td className="px-2 py-2">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedAssignedCompaniesProgramId(program.id)}
                                    className="font-semibold text-[#0f5b73] hover:underline"
                                  >
                                    {program.assignments.total}
                                  </button>
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
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[#123447]">{t.sessionsLibraryTitle}</h3>
            <p className="mt-1 text-sm text-[#35515f]">{t.sessionsLibrarySubtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openCreateSessionModal}
              className="rounded-full border border-[#0f5b73] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
            >
              {t.sessionsLibraryNewSession}
            </button>
            <ChevronToggleButton
              isOpen={isSessionsLibraryOpen}
              onToggle={() => setIsSessionsLibraryOpen((current) => !current)}
              label={t.sessionsLibraryTitle}
              expandLabel={t.expandSection}
              collapseLabel={t.collapseSection}
              className="rounded-full border border-[#9ec8db] px-3 py-2 text-xs font-semibold text-[#0f5b73]"
            />
          </div>
        </div>

        {isSessionsLibraryOpen ? (
          <>
            <div className="mt-3 rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex min-w-[18rem] flex-1 items-center gap-2 text-sm text-[#35515f]">
                  <span className="shrink-0 font-medium text-[#2f5163]">{t.sessionsLibraryTargetProgram}</span>
                  <select
                    value={targetSessionProgramId}
                    onChange={(event) => setTargetSessionProgramId(event.target.value)}
                    className="h-12 min-w-56 flex-1 rounded-lg border border-[#b8cfde] bg-white px-4 text-sm text-[#234457]"
                  >
                    {continuousPrograms.length === 0 ? <option value="">-</option> : null}
                    {continuousPrograms.map((program) => (
                      <option key={`session-target-program-${program.id}`} value={program.id}>
                        {program.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedSessionCatalogIds(filteredSessionsCatalog.map((item) => item.catalogId))
                  }
                  className="h-12 rounded-full border border-[#97c3d9] bg-white px-5 text-sm font-semibold text-[#0f5b73]"
                >
                  {t.sessionsLibrarySelectAll}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSessionCatalogIds([])}
                  className="h-12 rounded-full border border-[#b8cfde] bg-white px-5 text-sm font-semibold text-[#35515f]"
                >
                  {t.sessionsLibraryClear}
                </button>
                <button
                  type="button"
                  onClick={() => void handleAssignSelectedSessionsToProgram()}
                  disabled={
                    isAssigningCatalogSessions ||
                    selectedSessionCatalogIds.length === 0 ||
                    !targetSessionProgramId
                  }
                  className="h-12 rounded-full bg-[#8eafbe] px-6 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {isAssigningCatalogSessions
                    ? t.sessionsLibraryAssigning
                    : `${t.sessionsLibraryAssignSelected} (${selectedSessionCatalogIds.length})`}
                </button>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <label className="text-sm text-[#35515f]">
                  {t.sessionsLibrarySearch}
                  <input
                    value={sessionSearchTerm}
                    onChange={(event) => setSessionSearchTerm(event.target.value)}
                    className="mt-1 h-12 w-full rounded-md border border-[#b8cfde] bg-white px-4 text-sm text-[#234457] placeholder:text-[#8aa0ae]"
                    placeholder={t.sessionsLibrarySearch}
                  />
                </label>
                <label className="text-sm text-[#35515f]">
                  {t.sessionsLibraryFilterProgram}
                  <select
                    value={sessionSourceProgramFilterId}
                    onChange={(event) => setSessionSourceProgramFilterId(event.target.value)}
                    className="mt-1 h-12 w-full rounded-md border border-[#b8cfde] bg-white px-4 text-sm text-[#234457]"
                  >
                    <option value="all">{t.sessionsLibraryFilterAllPrograms}</option>
                    {sessionSourceFilterOptions.map(([filterKey, label]) => (
                      <option key={`session-source-filter-${filterKey}`} value={filterKey}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {isLoading ? <p className="mt-3 text-sm text-[#49697a]">{t.loading}</p> : null}
            {!isLoading ? (
              <div className="mt-3 space-y-3">
                {groupedFilteredSessionsCatalog.length === 0 ? (
                  <p className="text-xs text-[#5a7383]">{t.sessionsLibraryNone}</p>
                ) : null}
                {groupedFilteredSessionsCatalog.map((group) => {
                  const isModuleOpen = openSessionModuleByKey[group.groupKey] ?? true;
                  return (
                    <div key={`session-module-group-${group.groupKey}`} className="space-y-1">
                      <div className="rounded-lg border border-[#d8e4ee] bg-gradient-to-r from-[#edf6fb] to-[#f8fbfd] px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-bold text-[#123447]">{group.moduleLabel}</p>
                          <ChevronToggleButton
                            isOpen={isModuleOpen}
                            onToggle={() => toggleSessionModuleGroup(group.groupKey)}
                            label={group.moduleLabel}
                            expandLabel={t.expandSection}
                            collapseLabel={t.collapseSection}
                            className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                          />
                        </div>
                      </div>
                      {isModuleOpen ? (
                        <div className="overflow-x-auto rounded-lg border border-[#d8e4ee]">
                          <table className="nr-table min-w-full text-sm">
                            <thead>
                              <tr className="border-b">
                                <th className="px-2 py-2 text-left">#</th>
                                <th className="px-2 py-2 text-left">{t.sessionsLibrarySessionCol}</th>
                                <th className="px-2 py-2 text-left">{t.sessionsLibraryNotesCol}</th>
                                <th className="px-2 py-2 text-left">{t.sessionsLibraryFilesCol}</th>
                                <th className="px-2 py-2 text-left">{t.sessionsLibraryAssignedProgramsCol}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.sessions.map((item) => (
                                <tr key={item.catalogId} className="border-b">
                                  <td className="px-2 py-2">
                                    <input
                                      type="checkbox"
                                      checked={selectedSessionCatalogIdSet.has(item.catalogId)}
                                      onChange={() => toggleSessionCatalogSelection(item.catalogId)}
                                      className="h-4 w-4 rounded border-[#9ec8db] text-[#0f5b73]"
                                    />
                                  </td>
                                  <td className="px-2 py-2">
                                    <Link
                                      href={getSessionLibraryHref(item.sessionId)}
                                      className="font-medium text-[#123447] hover:text-[#0f5b73] hover:underline"
                                    >
                                      {item.topicTitle ?? item.sessionTitle}
                                    </Link>
                                    <p className="text-xs text-[#55707f]">
                                      {Number.isFinite(Number(item.topicOrder))
                                        ? `${t.sessionsLibrarySessionCol} #${Number(item.topicOrder)}`
                                        : t.sessionsLibrarySessionCol}
                                    </p>
                                  </td>
                                  <td className="px-2 py-2 text-xs text-[#35515f]">
                                    {(item.notes ?? item.preparationRequired ?? "-").slice(0, 140)}
                                  </td>
                                  <td className="px-2 py-2">{item.materialCount}</td>
                                  <td className="px-2 py-2">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedSessionAssignmentItem(item)}
                                      className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                                    >
                                      {t.sessionsLibraryAssignedProgramsView} (
                                      {item.assignedProgramCount ?? item.assignedPrograms?.length ?? 0})
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      {isAssignProgramsModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-lg font-semibold text-[#123447]">{t.assignModalTitle}</h4>
                <p className="text-sm text-[#4f6977]">{t.assignModalSubtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsAssignProgramsModalOpen(false)}
                className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
              >
                {t.modalClose}
              </button>
            </div>

            <label className="mt-4 block text-xs text-[#4f6977]">
              {t.assignCompany}
              <select
                value={selectedClientId}
                onChange={(event) => setSelectedClientId(event.target.value)}
                className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
              >
                {clients.length === 0 ? <option value="">-</option> : null}
                {clients.map((clientOption) => (
                  <option key={`assign-client-modal-${clientOption.id}`} value={clientOption.id}>
                    {clientOption.companyName}
                  </option>
                ))}
              </select>
            </label>

            {clients.length === 0 ? <p className="mt-3 text-sm text-[#5a7383]">{t.assignNoCompanies}</p> : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleAssignSelectedPrograms(selectedClientId)}
                disabled={isAssigningSelected || selectedProgramIds.length === 0 || !selectedClientId}
                className="rounded-full bg-[#0f5b73] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isAssigningSelected ? t.assigning : `${t.assignSelected} (${selectedProgramIds.length})`}
              </button>
              <button
                type="button"
                onClick={() => setIsAssignProgramsModalOpen(false)}
                className="rounded-full border border-[#9ec8db] px-4 py-2 text-sm font-semibold text-[#0f5b73]"
              >
                {t.modalCancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCreateSessionOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-lg font-semibold text-[#123447]">{t.sessionsLibraryCreateTitle}</h4>
                <p className="text-sm text-[#4f6977]">{t.sessionsLibraryCreateSubtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateSessionOpen(false)}
                className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
              >
                {t.modalClose}
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-xs text-[#4f6977]">
                {t.sessionsLibraryCreateFieldTitle}
                <input
                  value={createSessionTitle}
                  onChange={(event) => setCreateSessionTitle(event.target.value)}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs text-[#4f6977]">
                {t.sessionsLibraryCreateFieldModule}
                <select
                  value={createSessionModule}
                  onChange={(event) => setCreateSessionModule(event.target.value)}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                >
                  {sessionModuleOptions.map((moduleTitle) => (
                    <option key={`create-session-module-${moduleTitle}`} value={moduleTitle}>
                      {moduleTitle}
                    </option>
                  ))}
                  <option value={CREATE_SESSION_NEW_MODULE_OPTION}>
                    {t.sessionsLibraryCreateModuleNewOption}
                  </option>
                </select>
              </label>
              {createSessionModule === CREATE_SESSION_NEW_MODULE_OPTION ? (
                <label className="text-xs text-[#4f6977]">
                  {t.sessionsLibraryCreateFieldModuleNew}
                  <input
                    value={createSessionNewModule}
                    onChange={(event) => setCreateSessionNewModule(event.target.value)}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                  />
                </label>
              ) : null}
              <label className="text-xs text-[#4f6977]">
                {t.sessionsLibraryCreateFieldNotes}
                <textarea
                  value={createSessionNotes}
                  onChange={(event) => setCreateSessionNotes(event.target.value)}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                  rows={3}
                />
              </label>
              <label className="text-xs text-[#4f6977]">
                {t.sessionsLibraryCreateFieldPreparation}
                <textarea
                  value={createSessionPreparation}
                  onChange={(event) => setCreateSessionPreparation(event.target.value)}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                  rows={3}
                />
              </label>
            </div>

            {createSessionError ? <p className="mt-3 text-sm text-red-600">{createSessionError}</p> : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCreateSession()}
                disabled={isCreatingSession}
                className="rounded-full bg-[#0f5b73] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isCreatingSession ? t.sessionsLibraryCreating : t.sessionsLibraryNewSession}
              </button>
              <button
                type="button"
                onClick={() => setIsCreateSessionOpen(false)}
                className="rounded-full border border-[#9ec8db] px-4 py-2 text-sm font-semibold text-[#0f5b73]"
              >
                {t.modalCancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedSessionAssignmentItem ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-lg font-semibold text-[#123447]">
                  {t.sessionsLibraryAssignedProgramsModalTitle}
                </h4>
                <p className="text-sm text-[#4f6977]">
                  {selectedSessionAssignmentItem.topicTitle ?? selectedSessionAssignmentItem.sessionTitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSessionAssignmentItem(null)}
                className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
              >
                {t.modalClose}
              </button>
            </div>

            <div className="mt-4 max-h-[50vh] overflow-auto rounded-lg border border-[#d8e4ee]">
              {(selectedSessionAssignmentItem.assignedPrograms ?? []).length === 0 ? (
                <p className="px-3 py-3 text-sm text-[#5a7383]">{t.sessionsLibraryAssignedProgramsNone}</p>
              ) : (
                <ul className="divide-y divide-[#d8e4ee]">
                  {(selectedSessionAssignmentItem.assignedPrograms ?? [])
                    .slice()
                    .sort((left, right) => left.programTitle.localeCompare(right.programTitle))
                    .map((program) => (
                      <li key={`${selectedSessionAssignmentItem.catalogId}-${program.programId}`} className="px-3 py-2">
                        <Link
                          href={`/manager/programs/continuous/${program.programId}`}
                          className="font-semibold text-[#123447] hover:text-[#0f5b73] hover:underline"
                        >
                          {program.programTitle}
                        </Link>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {selectedProgramSessionsProgram ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-lg font-semibold text-[#123447]">{t.prgSessionsModalTitle}</h4>
                <p className="text-sm text-[#4f6977]">{selectedProgramSessionsProgram.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProgramSessionsProgramId(null)}
                className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
              >
                {t.modalClose}
              </button>
            </div>

            <div className="mt-4 max-h-[50vh] overflow-auto rounded-lg border border-[#d8e4ee]">
              {selectedProgramSessionsProgram.sessions.length === 0 ? (
                <p className="px-3 py-3 text-sm text-[#5a7383]">{t.prgSessionsModalEmpty}</p>
              ) : (
                <ul className="divide-y divide-[#d8e4ee]">
                  {selectedProgramSessionsProgram.sessions.map((session, index) => (
                    <li key={`${selectedProgramSessionsProgram.id}-${session.id}`} className="px-3 py-2">
                      <Link
                        href={
                          session.id.startsWith("library-")
                            ? getSessionLibraryHref(
                                session.id.slice("library-".length),
                              )
                            : getProgramSessionHref(selectedProgramSessionsProgram.id, session.id)
                        }
                        className="font-semibold text-[#123447] hover:text-[#0f5b73] hover:underline"
                      >
                        {session.title}
                      </Link>
                      <p className="text-xs text-[#55707f]">
                        {t.sessionsLibrarySessionCol} #{index + 1}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {selectedAssignedCompaniesProgram ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-lg font-semibold text-[#123447]">{t.prgAssignmentsModalTitle}</h4>
                <p className="text-sm text-[#4f6977]">{selectedAssignedCompaniesProgram.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAssignedCompaniesProgramId(null)}
                className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
              >
                {t.modalClose}
              </button>
            </div>

            <div className="mt-4 max-h-[50vh] overflow-auto rounded-lg border border-[#d8e4ee]">
              {selectedAssignedCompaniesProgram.assignedCompanies.length === 0 ? (
                <p className="px-3 py-3 text-sm text-[#5a7383]">{t.prgAssignmentsModalEmpty}</p>
              ) : (
                <ul className="divide-y divide-[#d8e4ee]">
                  {selectedAssignedCompaniesProgram.assignedCompanies.map((company) => (
                    <li key={`${selectedAssignedCompaniesProgram.id}-${company.id}`} className="px-3 py-2">
                      <Link
                        href={`/manager/clients/${company.id}`}
                        className="font-semibold text-[#123447] hover:text-[#0f5b73] hover:underline"
                      >
                        {company.companyName}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

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
                <select
                  value={createProgramTopic}
                  onChange={(event) => setCreateProgramTopic(Number(event.target.value || 1))}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                >
                  {RISK_TOPICS.map((topic) => (
                    <option key={`create-program-topic-${topic.id}`} value={topic.id}>
                      {topic.code} - {locale === "pt" ? topic.labelPt : topic.labelEn}
                    </option>
                  ))}
                </select>
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

              <label className="text-xs text-[#4f6977]">
                {t.programFieldFrequency}
                <select
                  value={createProgramFrequency}
                  onChange={(event) =>
                    setCreateProgramFrequency(event.target.value as ContinuousProgramScheduleFrequency)
                  }
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                >
                  {CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCIES.map((frequency) => (
                    <option key={`create-program-frequency-${frequency}`} value={frequency}>
                      {t.frequencies[frequency]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-[#4f6977]">
                {t.programFieldDuration}
                <input
                  type="number"
                  min={1}
                  max={24}
                  step={1}
                  value={createProgramDurationMonths}
                  onChange={(event) =>
                    setCreateProgramDurationMonths(Number.parseInt(event.target.value || "0", 10))
                  }
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
