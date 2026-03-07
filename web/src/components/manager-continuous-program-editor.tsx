"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";

import { useManagerLocale } from "@/components/manager-locale";
import {
  CONTINUOUS_PROGRAM_MAX_SESSIONS,
  CONTINUOUS_PROGRAM_MATERIAL_ACCEPT_ATTR,
  CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCIES,
  DEFAULT_CONTINUOUS_PROGRAM_METRICS,
  DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS,
  DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY,
  type ContinuousProgramMaterial,
  type ContinuousProgramMetrics,
  type ContinuousProgramSession,
  type ContinuousProgramScheduleFrequency,
  flattenContinuousProgramSessionMaterials,
  parseContinuousProgramSessions,
} from "@/lib/continuous-programs";

type ContinuousProgram = {
  id: string;
  title: string;
  description: string | null;
  targetRiskTopic: number;
  triggerThreshold: number;
  scheduleFrequency: ContinuousProgramScheduleFrequency;
  scheduleAnchorDate: string | null;
  evaluationQuestions: string[];
  materials: ContinuousProgramMaterial[];
  sessions: ContinuousProgramSession[];
  metrics: ContinuousProgramMetrics;
  assignments: {
    total: number;
    recommended: number;
    active: number;
    completed: number;
  };
};

type ClientStatus = "Active" | "Pending" | "Inactive";

type AssignableClient = {
  id: string;
  companyName: string;
  cnpj: string;
  status: ClientStatus;
};

type AssignmentStatus = "Recommended" | "Active" | "Completed";

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
};

const COPY = {
  en: {
    breadcrumbBase: "Programs database",
    loading: "Loading continuous program...",
    notFound: "Continuous program not found.",
    title: "Program details",
    subtitle: "Edit the program definition and save changes to the database.",
    fieldTitle: "Title",
    fieldDescription: "Description",
    fieldTopic: "Target risk topic",
    fieldThreshold: "Trigger threshold",
    fieldFrequency: "Calendar frequency",
    fieldAnchorDate: "Calendar anchor date",
    materialsTitle: "Campaign materials",
    materialsHint: "Upload PDF, PPT, DOC, XLS and support assets for this campaign.",
    materialsUpload: "Upload files",
    materialsUploading: "Uploading...",
    materialsNone: "No materials uploaded yet.",
    materialsTitleField: "Material title",
    materialsRemove: "Remove",
    materialsRemoving: "Removing...",
    materialsUploaded: "Material uploaded.",
    materialsRemoved: "Material removed.",
    sessionsTitle: "Campaign sessions",
    sessionsHint:
      "Split this campaign into sessions and attach dedicated files/notes/preparation for each one.",
    sessionsCount: "Number of sessions",
    sessionTitle: "Session title",
    sessionNotes: "Session notes",
    sessionPreparation: "Preparation guidance",
    sessionMaterials: "Session files",
    sessionMaterialNone: "No files in this session.",
    sessionPrevious: "Previous session",
    sessionNext: "Next session",
    sessionJumpTo: "Jump to session",
    sessionsAddButton: "Add sessions",
    sessionsLibraryTitle: "Add Sessions From Library",
    sessionsLibrarySubtitle:
      "Search topic sessions grouped by modules and add them to this campaign.",
    sessionsLibrarySearch: "Search sessions",
    sessionsLibraryFilterProgram: "Filter by module",
    sessionsLibraryFilterAllPrograms: "All modules",
    sessionsLibrarySelectAll: "Select all filtered",
    sessionsLibraryClear: "Clear",
    sessionsLibraryApply: "Apply selected sessions",
    sessionsLibraryLoading: "Loading sessions...",
    sessionsLibraryNone: "No sessions found.",
    sessionsLibraryProgramCol: "Module",
    sessionsLibrarySessionCol: "Topic",
    sessionsLibraryNotesCol: "Notes",
    sessionsLibraryFilesCol: "Files",
    sessionsLibraryValidationSelect: "Select at least one session.",
    sessionsLibraryValidationLimit: "Session limit reached. Reduce selected sessions.",
    sessionsLibraryApplied: "Selected sessions added to this program.",
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
    sessionsLibraryCreating: "Creating session...",
    sessionsViewDetails: "Details view",
    sessionsViewList: "List view",
    sessionOpenDetails: "Open session details",
    sessionDelete: "Delete session",
    sessionEdit: "Edit",
    sessionDeleteLastError: "At least one session is required.",
    evaluationTitle: "Evaluation questionnaire",
    evaluationHint: "Define short post-campaign questions (1 to 5 score in client portal).",
    evaluationAdd: "Add question",
    evaluationRemove: "Remove",
    metricsTitle: "Target metrics",
    metricParticipation: "Participation target (%)",
    metricCompletion: "Completion target (%)",
    metricAdherence: "Adherence target (%)",
    metricSatisfaction: "Satisfaction target (1-5)",
    assignments: "Assignments",
    assignedTotal: "Total",
    assignedRecommended: "Recommended",
    assignedActive: "Active",
    assignedCompleted: "Completed",
    assignButton: "Assign program to company",
    assignTitle: "Assign Program To Company",
    assignSubtitle: "Select a company and apply this program.",
    assignCompany: "Company",
    assignStatus: "Status",
    assignDeployAt: "Applied at",
    assignFrequency: "Cadence",
    assignDuration: "Duration (months)",
    assignLoadingClients: "Loading companies...",
    assignNoClients: "No companies available.",
    assignErrorNoClient: "Select a company.",
    assignErrorDuration: "Duration must be between 1 and 24 months.",
    assignErrorLoadClients: "Could not load companies.",
    assignError: "Could not assign program.",
    assignSuccess: "Program assigned to company.",
    assignConfirm: "Assign program",
    assigning: "Assigning...",
    close: "Close",
    cancel: "Cancel",
    reload: "Reload",
    save: "Save program",
    saving: "Saving...",
    saved: "Program saved.",
    loadError: "Could not load continuous program.",
    saveError: "Could not save program.",
    uploadError: "Could not upload material.",
    removeError: "Could not remove material.",
    validationTitle: "Title must have at least 3 characters.",
    validationTopic: "Target topic must be between 1 and 13.",
    validationThreshold: "Trigger threshold must be between 1.00 and 3.00.",
    validationQuestions: "Add at least one evaluation question.",
    validationQuestionLength: "Each evaluation question must have at least 5 characters.",
    validationSessions: "Define at least one session.",
    validationMetrics: "Metrics are invalid.",
    frequencies: {
      weekly: "Weekly",
      biweekly: "Biweekly",
      monthly: "Monthly",
      quarterly: "Quarterly",
      semiannual: "Semiannual",
      annual: "Annual",
      custom: "Custom",
    } satisfies Record<ContinuousProgramScheduleFrequency, string>,
  },
  pt: {
    breadcrumbBase: "Base de programas",
    loading: "Carregando programa continuo...",
    notFound: "Programa continuo nao encontrado.",
    title: "Detalhes do programa",
    subtitle: "Edite a definicao do programa e salve as alteracoes no banco de dados.",
    fieldTitle: "Titulo",
    fieldDescription: "Descricao",
    fieldTopic: "Topico de risco alvo",
    fieldThreshold: "Gatilho",
    fieldFrequency: "Frequencia no calendario",
    fieldAnchorDate: "Data de referencia",
    materialsTitle: "Materiais da campanha",
    materialsHint: "Envie PDF, PPT, DOC, XLS e materiais de apoio para esta campanha.",
    materialsUpload: "Enviar arquivos",
    materialsUploading: "Enviando...",
    materialsNone: "Nenhum material enviado.",
    materialsTitleField: "Titulo do material",
    materialsRemove: "Remover",
    materialsRemoving: "Removendo...",
    materialsUploaded: "Material enviado.",
    materialsRemoved: "Material removido.",
    sessionsTitle: "Sessoes da campanha",
    sessionsHint:
      "Divida esta campanha em sessoes e vincule arquivos/notas/preparacao para cada sessao.",
    sessionsCount: "Quantidade de sessoes",
    sessionTitle: "Titulo da sessao",
    sessionNotes: "Notas da sessao",
    sessionPreparation: "Preparacao da sessao",
    sessionMaterials: "Arquivos da sessao",
    sessionMaterialNone: "Sem arquivos nesta sessao.",
    sessionPrevious: "Sessao anterior",
    sessionNext: "Proxima sessao",
    sessionJumpTo: "Ir para sessao",
    sessionsAddButton: "Adicionar sessoes",
    sessionsLibraryTitle: "Adicionar Sessoes Da Biblioteca",
    sessionsLibrarySubtitle:
      "Busque sessoes por topico, agrupadas em modulos, para incluir nesta campanha.",
    sessionsLibrarySearch: "Buscar sessoes",
    sessionsLibraryFilterProgram: "Filtrar por modulo",
    sessionsLibraryFilterAllPrograms: "Todos os modulos",
    sessionsLibrarySelectAll: "Selecionar filtrados",
    sessionsLibraryClear: "Limpar",
    sessionsLibraryApply: "Aplicar sessoes selecionadas",
    sessionsLibraryLoading: "Carregando sessoes...",
    sessionsLibraryNone: "Nenhuma sessao encontrada.",
    sessionsLibraryProgramCol: "Modulo",
    sessionsLibrarySessionCol: "Topico",
    sessionsLibraryNotesCol: "Notas",
    sessionsLibraryFilesCol: "Arquivos",
    sessionsLibraryValidationSelect: "Selecione ao menos uma sessao.",
    sessionsLibraryValidationLimit: "Limite de sessoes atingido. Reduza as sessoes selecionadas.",
    sessionsLibraryApplied: "Sessoes selecionadas adicionadas ao programa.",
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
    sessionsLibraryCreating: "Criando sessao...",
    sessionsViewDetails: "Visao detalhada",
    sessionsViewList: "Visao em lista",
    sessionOpenDetails: "Abrir detalhes da sessao",
    sessionDelete: "Excluir sessao",
    sessionEdit: "Editar",
    sessionDeleteLastError: "Pelo menos uma sessao e obrigatoria.",
    evaluationTitle: "Questionario de avaliacao",
    evaluationHint: "Defina perguntas curtas de pos-campanha (nota 1 a 5 no portal do cliente).",
    evaluationAdd: "Adicionar pergunta",
    evaluationRemove: "Remover",
    metricsTitle: "Metas de metricas",
    metricParticipation: "Meta de participacao (%)",
    metricCompletion: "Meta de conclusao (%)",
    metricAdherence: "Meta de aderencia (%)",
    metricSatisfaction: "Meta de satisfacao (1-5)",
    assignments: "Atribuicoes",
    assignedTotal: "Total",
    assignedRecommended: "Recomendados",
    assignedActive: "Ativos",
    assignedCompleted: "Concluidos",
    assignButton: "Atribuir programa a empresa",
    assignTitle: "Atribuir Programa A Empresa",
    assignSubtitle: "Selecione a empresa e aplique este programa.",
    assignCompany: "Empresa",
    assignStatus: "Status",
    assignDeployAt: "Aplicado em",
    assignFrequency: "Cadencia",
    assignDuration: "Duracao (meses)",
    assignLoadingClients: "Carregando empresas...",
    assignNoClients: "Nenhuma empresa disponivel.",
    assignErrorNoClient: "Selecione uma empresa.",
    assignErrorDuration: "Duracao deve estar entre 1 e 24 meses.",
    assignErrorLoadClients: "Nao foi possivel carregar empresas.",
    assignError: "Nao foi possivel atribuir o programa.",
    assignSuccess: "Programa atribuido a empresa.",
    assignConfirm: "Atribuir programa",
    assigning: "Atribuindo...",
    close: "Fechar",
    cancel: "Cancelar",
    reload: "Recarregar",
    save: "Salvar programa",
    saving: "Salvando...",
    saved: "Programa salvo.",
    loadError: "Nao foi possivel carregar o programa continuo.",
    saveError: "Nao foi possivel salvar o programa.",
    uploadError: "Nao foi possivel enviar o material.",
    removeError: "Nao foi possivel remover o material.",
    validationTitle: "Titulo deve ter pelo menos 3 caracteres.",
    validationTopic: "Topico alvo deve estar entre 1 e 13.",
    validationThreshold: "Gatilho deve estar entre 1.00 e 3.00.",
    validationQuestions: "Adicione pelo menos uma pergunta de avaliacao.",
    validationQuestionLength: "Cada pergunta de avaliacao precisa ter pelo menos 5 caracteres.",
    validationSessions: "Defina pelo menos uma sessao.",
    validationMetrics: "Metricas invalidas.",
    frequencies: {
      weekly: "Semanal",
      biweekly: "Quinzenal",
      monthly: "Mensal",
      quarterly: "Trimestral",
      semiannual: "Semestral",
      annual: "Anual",
      custom: "Personalizada",
    } satisfies Record<ContinuousProgramScheduleFrequency, string>,
  },
} as const;

function clampToTwoDecimals(value: number) {
  return Number(value.toFixed(2));
}

function formatFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "-";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toDatetimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromDatetimeLocal(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function monthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function buildAnnualPlanMonthsFromDuration(startIso: string, durationMonths: number): string[] {
  if (!Number.isInteger(durationMonths) || durationMonths < 1) return [];
  const parsedStart = new Date(startIso);
  const safeStart = Number.isNaN(parsedStart.getTime()) ? new Date() : parsedStart;
  const startMonth = new Date(Date.UTC(safeStart.getUTCFullYear(), safeStart.getUTCMonth(), 1));

  const months: string[] = [];
  for (let index = 0; index < durationMonths; index += 1) {
    const monthDate = new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + index, 1));
    months.push(monthKey(monthDate));
  }
  return months;
}

function sourceFilterKey(item: SessionCatalogItem) {
  const moduleOrder = Number(item.moduleOrder);
  const safeOrder = Number.isFinite(moduleOrder) ? moduleOrder : 999;
  const moduleTitle = (item.moduleTitle ?? "").trim();
  return moduleTitle ? `module:${safeOrder}:${moduleTitle}` : "__uncategorized__";
}

const CREATE_SESSION_NEW_MODULE_OPTION = "__new_module__";

export function ManagerContinuousProgramEditor({ programId }: { programId: string }) {
  const { locale } = useManagerLocale();
  const t = COPY[locale];

  const [program, setProgram] = useState<ContinuousProgram | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetRiskTopic, setTargetRiskTopic] = useState(1);
  const [triggerThreshold, setTriggerThreshold] = useState(1);
  const [scheduleFrequency, setScheduleFrequency] = useState<ContinuousProgramScheduleFrequency>(
    DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY,
  );
  const [evaluationQuestions, setEvaluationQuestions] = useState<string[]>(
    DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS,
  );
  const [sessions, setSessions] = useState<ContinuousProgramSession[]>(
    parseContinuousProgramSessions([], { minCount: 1 }),
  );
  const [activeSessionIndex, setActiveSessionIndex] = useState(0);
  const [metrics, setMetrics] = useState<ContinuousProgramMetrics>(DEFAULT_CONTINUOUS_PROGRAM_METRICS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingSessionId, setUploadingSessionId] = useState<string | null>(null);
  const [removingMaterialId, setRemovingMaterialId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sessionViewMode, setSessionViewMode] = useState<"details" | "list">("details");
  const [isSessionsLibraryOpen, setIsSessionsLibraryOpen] = useState(false);
  const [isLoadingSessionsLibrary, setIsLoadingSessionsLibrary] = useState(false);
  const [sessionsLibraryError, setSessionsLibraryError] = useState("");
  const [sessionsCatalog, setSessionsCatalog] = useState<SessionCatalogItem[]>([]);
  const [sessionsCatalogSearchTerm, setSessionsCatalogSearchTerm] = useState("");
  const [sessionsCatalogSourceProgramFilterId, setSessionsCatalogSourceProgramFilterId] =
    useState("all");
  const [selectedSessionCatalogIds, setSelectedSessionCatalogIds] = useState<string[]>([]);
  const [createSessionTitle, setCreateSessionTitle] = useState("");
  const [createSessionModule, setCreateSessionModule] = useState("");
  const [createSessionNewModule, setCreateSessionNewModule] = useState("");
  const [createSessionNotes, setCreateSessionNotes] = useState("");
  const [createSessionPreparation, setCreateSessionPreparation] = useState("");
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  const sessionReturnTo = `/manager/programs/continuous/${encodeURIComponent(programId)}`;
  function withSessionReturnTo(href: string) {
    const separator = href.includes("?") ? "&" : "?";
    return `${href}${separator}returnTo=${encodeURIComponent(sessionReturnTo)}`;
  }
  function getSessionDetailsHref(sessionId: string) {
    if (sessionId.startsWith("library-")) {
      return withSessionReturnTo(`/manager/programs/sessions/library/${encodeURIComponent(
        sessionId.slice("library-".length),
      )}`);
    }
    return withSessionReturnTo(
      `/manager/programs/sessions/program/${encodeURIComponent(programId)}/${encodeURIComponent(
      sessionId,
    )}`,
    );
  }
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assignClients, setAssignClients] = useState<AssignableClient[]>([]);
  const [isLoadingAssignClients, setIsLoadingAssignClients] = useState(false);
  const [isAssigningProgram, setIsAssigningProgram] = useState(false);
  const [assignClientId, setAssignClientId] = useState("");
  const [assignStatus, setAssignStatus] = useState<AssignmentStatus>("Active");
  const [assignDeployedAt, setAssignDeployedAt] = useState(toDatetimeLocal(new Date().toISOString()));
  const [assignFrequency, setAssignFrequency] = useState<ContinuousProgramScheduleFrequency>(
    DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY,
  );
  const [assignDurationMonths, setAssignDurationMonths] = useState(6);
  const [assignError, setAssignError] = useState("");

  const loadProgram = useCallback(async () => {
    setIsLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/programs-database/continuous/${programId}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? t.loadError);
      }
      const payload = (await response.json()) as { program: ContinuousProgram };
      if (!payload.program) {
        throw new Error(t.notFound);
      }
      setProgram(payload.program);
      setTitle(payload.program.title);
      setDescription(payload.program.description ?? "");
      setTargetRiskTopic(payload.program.targetRiskTopic);
      setTriggerThreshold(payload.program.triggerThreshold);
      setScheduleFrequency(payload.program.scheduleFrequency);
      setEvaluationQuestions(
        payload.program.evaluationQuestions.length > 0
          ? payload.program.evaluationQuestions
          : DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS,
      );
      setSessions(
        parseContinuousProgramSessions(payload.program.sessions, {
          fallbackMaterials: payload.program.materials,
          minCount: 1,
        }),
      );
      setMetrics(payload.program.metrics ?? DEFAULT_CONTINUOUS_PROGRAM_METRICS);
    } catch (loadError) {
      setProgram(null);
      setError(loadError instanceof Error ? loadError.message : t.loadError);
    } finally {
      setIsLoading(false);
    }
  }, [programId, t.loadError, t.notFound]);

  useEffect(() => {
    void loadProgram();
  }, [loadProgram]);

  useEffect(() => {
    setActiveSessionIndex((previous) => {
      if (sessions.length <= 1) return 0;
      return Math.min(previous, sessions.length - 1);
    });
  }, [sessions.length]);

  const selectedSessionCatalogIdSet = useMemo(
    () => new Set(selectedSessionCatalogIds),
    [selectedSessionCatalogIds],
  );
  const sessionsCatalogSourceOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const item of sessionsCatalog) {
      const moduleLabel = (item.moduleTitle ?? "").trim() || t.sessionsLibrarySourceFilterLibrary;
      options.set(sourceFilterKey(item), moduleLabel);
    }
    return Array.from(options.entries()).sort((left, right) => left[1].localeCompare(right[1]));
  }, [sessionsCatalog, t.sessionsLibrarySourceFilterLibrary]);
  const filteredSessionsCatalog = useMemo(() => {
    const normalizedSearch = sessionsCatalogSearchTerm.trim().toLowerCase();
    return sessionsCatalog.filter((item) => {
      if (
        sessionsCatalogSourceProgramFilterId !== "all" &&
        sourceFilterKey(item) !== sessionsCatalogSourceProgramFilterId
      ) {
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
  }, [sessionsCatalog, sessionsCatalogSearchTerm, sessionsCatalogSourceProgramFilterId]);
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
      { moduleLabel: string; moduleOrder: number; sessions: SessionCatalogItem[] }
    >();

    for (const item of filteredSessionsCatalog) {
      const moduleOrder = Number(item.moduleOrder);
      const safeOrder = Number.isFinite(moduleOrder) ? moduleOrder : 999;
      const moduleLabel = (item.moduleTitle ?? "").trim() || t.sessionsLibrarySourceFilterLibrary;
      const key = `${safeOrder}:${moduleLabel}`;
      const current = grouped.get(key) ?? {
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

  async function loadAssignClients() {
    setIsLoadingAssignClients(true);
    setAssignError("");
    try {
      const response = await fetch("/api/admin/clients", { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? t.assignErrorLoadClients);
      }
      const payload = (await response.json().catch(() => ({}))) as { clients?: AssignableClient[] };
      const clients = Array.isArray(payload.clients) ? payload.clients : [];
      setAssignClients(clients);
      setAssignClientId((previous) =>
        previous && clients.some((client) => client.id === previous) ? previous : (clients[0]?.id ?? ""),
      );
    } catch (loadError) {
      setAssignClients([]);
      setAssignError(loadError instanceof Error ? loadError.message : t.assignErrorLoadClients);
    } finally {
      setIsLoadingAssignClients(false);
    }
  }

  function openAssignModal() {
    setAssignStatus("Active");
    setAssignDeployedAt(toDatetimeLocal(new Date().toISOString()));
    setAssignFrequency(DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY);
    setAssignDurationMonths(Math.max(1, Math.min(24, sessions.length)));
    setAssignError("");
    setIsAssignModalOpen(true);
    if (assignClients.length === 0 && !isLoadingAssignClients) {
      void loadAssignClients();
    }
  }

  async function loadSessionsCatalog() {
    setIsLoadingSessionsLibrary(true);
    setSessionsLibraryError("");
    try {
      const response = await fetch("/api/admin/programs-database/continuous/sessions", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        sessions?: SessionCatalogItem[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? t.loadError);
      }
      setSessionsCatalog(Array.isArray(payload.sessions) ? payload.sessions : []);
    } catch (catalogError) {
      setSessionsLibraryError(catalogError instanceof Error ? catalogError.message : t.loadError);
      setSessionsCatalog([]);
    } finally {
      setIsLoadingSessionsLibrary(false);
    }
  }

  function openSessionsLibraryModal() {
    setSessionsLibraryError("");
    setSessionsCatalogSearchTerm("");
    setSessionsCatalogSourceProgramFilterId("all");
    setSelectedSessionCatalogIds([]);
    setCreateSessionTitle("");
    setCreateSessionModule(sessionModuleOptions[0] ?? CREATE_SESSION_NEW_MODULE_OPTION);
    setCreateSessionNewModule("");
    setCreateSessionNotes("");
    setCreateSessionPreparation("");
    setIsSessionsLibraryOpen(true);
    void loadSessionsCatalog();
  }

  function toggleSessionCatalogSelection(catalogId: string) {
    setSelectedSessionCatalogIds((current) =>
      current.includes(catalogId)
        ? current.filter((item) => item !== catalogId)
        : [...current, catalogId],
    );
  }

  function applySelectedSessionsFromLibrary() {
    const selectedCatalogSessions = selectedSessionCatalogIds
      .map((catalogId) => sessionsCatalog.find((item) => item.catalogId === catalogId))
      .filter((item): item is SessionCatalogItem => Boolean(item));

    if (selectedCatalogSessions.length === 0) {
      setSessionsLibraryError(t.sessionsLibraryValidationSelect);
      return;
    }

    if (sessions.length + selectedCatalogSessions.length > CONTINUOUS_PROGRAM_MAX_SESSIONS) {
      setSessionsLibraryError(t.sessionsLibraryValidationLimit);
      return;
    }

    const importedSessions: ContinuousProgramSession[] = selectedCatalogSessions.map((item) => ({
      id: item.sourceType === "library" ? `library-${item.sessionId}` : item.sessionId,
      title: item.sessionTitle,
      notes: item.notes,
      preparationRequired: item.preparationRequired,
      materials: item.materials.map((material) => ({ ...material })),
    }));

    setSessions((previous) => {
      const next = parseContinuousProgramSessions([...previous, ...importedSessions], {
        minCount: 1,
      });
      setActiveSessionIndex(Math.max(0, previous.length));
      return next;
    });
    setError("");
    setNotice(t.sessionsLibraryApplied);
    setIsSessionsLibraryOpen(false);
    setSelectedSessionCatalogIds([]);
  }

  async function createSessionInLibrary() {
    setSessionsLibraryError("");
    if (createSessionTitle.trim().length < 3) {
      setSessionsLibraryError(t.sessionsLibraryCreateValidationTitle);
      return;
    }
    const resolvedModuleTitle =
      createSessionModule === CREATE_SESSION_NEW_MODULE_OPTION
        ? createSessionNewModule.trim()
        : createSessionModule.trim();
    if (!resolvedModuleTitle) {
      setSessionsLibraryError(t.sessionsLibraryCreateValidationModule);
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

      setCreateSessionTitle("");
      setCreateSessionModule(sessionModuleOptions[0] ?? CREATE_SESSION_NEW_MODULE_OPTION);
      setCreateSessionNewModule("");
      setCreateSessionNotes("");
      setCreateSessionPreparation("");
      await loadSessionsCatalog();
    } catch (createError) {
      setSessionsLibraryError(
        createError instanceof Error ? createError.message : t.sessionsLibraryCreateError,
      );
    } finally {
      setIsCreatingSession(false);
    }
  }

  function removeSession(sessionId: string) {
    if (sessions.length <= 1) {
      setError(t.sessionDeleteLastError);
      return;
    }
    setError("");
    setSessions((previous) => previous.filter((session) => session.id !== sessionId));
  }

  async function assignProgramToCompany() {
    if (!assignClientId) {
      setAssignError(t.assignErrorNoClient);
      return;
    }
    if (!Number.isInteger(assignDurationMonths) || assignDurationMonths < 1 || assignDurationMonths > 24) {
      setAssignError(t.assignErrorDuration);
      return;
    }

    setIsAssigningProgram(true);
    setAssignError("");
    const deployedAtIso = fromDatetimeLocal(assignDeployedAt);
    const annualPlanMonths = buildAnnualPlanMonthsFromDuration(
      deployedAtIso || new Date().toISOString(),
      assignDurationMonths,
    );
    try {
      const response = await fetch(`/api/admin/clients/${assignClientId}/programs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programId,
          status: assignStatus,
          ...(deployedAtIso ? { deployedAt: deployedAtIso } : {}),
          scheduleFrequency: assignFrequency,
          annualPlanMonths,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? t.assignError);
      }
      setIsAssignModalOpen(false);
      setError("");
      await loadProgram();
      setNotice(t.assignSuccess);
    } catch (assignProgramError) {
      setAssignError(assignProgramError instanceof Error ? assignProgramError.message : t.assignError);
    } finally {
      setIsAssigningProgram(false);
    }
  }

  async function uploadSessionMaterials(sessionId: string, files: FileList | null) {
    if (!files || files.length === 0) return;

    setUploadingSessionId(sessionId);
    setError("");
    setNotice("");

    try {
      const uploads = Array.from(files);
      const addedMaterials: ContinuousProgramMaterial[] = [];

      for (const file of uploads) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("sessionId", sessionId);

        const response = await fetch(
          `/api/admin/programs-database/continuous/${programId}/materials`,
          {
            method: "POST",
            body: formData,
          },
        );

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? t.uploadError);
        }

        const payload = (await response.json()) as {
          material?: ContinuousProgramMaterial;
          sessionId?: string;
        };
        if (payload.material) {
          addedMaterials.push(payload.material);
        }
      }

      if (addedMaterials.length > 0) {
        setSessions((previous) =>
          previous.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  materials: [...session.materials, ...addedMaterials],
                }
              : session,
          ),
        );
        setNotice(t.materialsUploaded);
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t.uploadError);
    } finally {
      setUploadingSessionId(null);
    }
  }

  async function removeMaterial(materialId: string) {
    setRemovingMaterialId(materialId);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `/api/admin/programs-database/continuous/${programId}/materials`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ materialId }),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? t.removeError);
      }

      setSessions((previous) =>
        previous.map((session) => ({
          ...session,
          materials: session.materials.filter((item) => item.id !== materialId),
        })),
      );
      setNotice(t.materialsRemoved);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : t.removeError);
    } finally {
      setRemovingMaterialId(null);
    }
  }

  function updateQuestion(index: number, value: string) {
    setEvaluationQuestions((prev) => prev.map((question, itemIndex) => (itemIndex === index ? value : question)));
  }

  function removeQuestion(index: number) {
    setEvaluationQuestions((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  function addQuestion() {
    setEvaluationQuestions((prev) => [...prev, ""]);
  }

  function updateSessionMaterialTitle(
    sessionId: string,
    materialId: string,
    nextTitle: string,
  ) {
    setSessions((previous) =>
      previous.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              materials: session.materials.map((item) =>
                item.id === materialId ? { ...item, title: nextTitle } : item,
              ),
            }
          : session,
      ),
    );
  }

  function updateSessionField(
    sessionId: string,
    field: "title" | "notes" | "preparationRequired",
    value: string,
  ) {
    setSessions((previous) =>
      previous.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              [field]: value,
            }
          : session,
      ),
    );
  }

  async function saveProgram() {
    if (title.trim().length < 3) {
      setError(t.validationTitle);
      return;
    }
    if (!Number.isInteger(targetRiskTopic) || targetRiskTopic < 1 || targetRiskTopic > 13) {
      setError(t.validationTopic);
      return;
    }
    if (!Number.isFinite(triggerThreshold) || triggerThreshold < 1 || triggerThreshold > 3) {
      setError(t.validationThreshold);
      return;
    }

    const normalizedQuestions = evaluationQuestions.map((item) => item.trim()).filter((item) => item.length > 0);
    if (normalizedQuestions.length === 0) {
      setError(t.validationQuestions);
      return;
    }
    if (normalizedQuestions.some((item) => item.length < 5)) {
      setError(t.validationQuestionLength);
      return;
    }

    const normalizedMetrics = {
      participationTarget: clampToTwoDecimals(metrics.participationTarget),
      completionTarget: clampToTwoDecimals(metrics.completionTarget),
      adherenceTarget: clampToTwoDecimals(metrics.adherenceTarget),
      satisfactionTarget: clampToTwoDecimals(metrics.satisfactionTarget),
    };

    const metricsAreValid =
      Number.isFinite(normalizedMetrics.participationTarget) &&
      normalizedMetrics.participationTarget >= 0 &&
      normalizedMetrics.participationTarget <= 100 &&
      Number.isFinite(normalizedMetrics.completionTarget) &&
      normalizedMetrics.completionTarget >= 0 &&
      normalizedMetrics.completionTarget <= 100 &&
      Number.isFinite(normalizedMetrics.adherenceTarget) &&
      normalizedMetrics.adherenceTarget >= 0 &&
      normalizedMetrics.adherenceTarget <= 100 &&
      Number.isFinite(normalizedMetrics.satisfactionTarget) &&
      normalizedMetrics.satisfactionTarget >= 1 &&
      normalizedMetrics.satisfactionTarget <= 5;

    if (!metricsAreValid) {
      setError(t.validationMetrics);
      return;
    }

    const normalizedSessions = parseContinuousProgramSessions(sessions, { minCount: 1 }).map(
      (session, index) => ({
        ...session,
        title:
          session.title.trim().length > 0
            ? session.title.trim()
            : `${t.sessionTitle} ${index + 1}`,
        notes: session.notes?.trim() || null,
        preparationRequired: session.preparationRequired?.trim() || null,
        materials: session.materials.map((item) => ({
          ...item,
          title: item.title.trim().length > 0 ? item.title.trim() : item.fileName,
        })),
      }),
    );

    if (normalizedSessions.length === 0) {
      setError(t.validationSessions);
      return;
    }

    const normalizedMaterials = flattenContinuousProgramSessionMaterials(normalizedSessions);

    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/programs-database/continuous/${programId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          targetRiskTopic,
          triggerThreshold: clampToTwoDecimals(triggerThreshold),
          scheduleFrequency,
          evaluationQuestions: normalizedQuestions,
          sessions: normalizedSessions,
          materials: normalizedMaterials,
          metrics: normalizedMetrics,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? t.saveError);
      }
      const payload = (await response.json()) as { program: ContinuousProgram };
      if (payload.program) {
        setProgram(payload.program);
        setTitle(payload.program.title);
        setDescription(payload.program.description ?? "");
        setTargetRiskTopic(payload.program.targetRiskTopic);
        setTriggerThreshold(payload.program.triggerThreshold);
        setScheduleFrequency(payload.program.scheduleFrequency);
        setEvaluationQuestions(payload.program.evaluationQuestions);
        setSessions(
          parseContinuousProgramSessions(payload.program.sessions, {
            fallbackMaterials: payload.program.materials,
            minCount: 1,
          }),
        );
        setMetrics(payload.program.metrics);
      }
      setNotice(t.saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t.saveError);
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <p className="text-sm text-[#49697a]">{t.loading}</p>;
  }

  if (!program) {
    return <p className="text-sm text-red-600">{error || t.notFound}</p>;
  }

  const currentSessionIndex =
    sessions.length === 0 ? 0 : Math.min(activeSessionIndex, sessions.length - 1);
  const currentSession = sessions[currentSessionIndex] ?? null;
  const currentSessionTitle =
    currentSession?.title.trim() || `${t.sessionTitle} ${currentSessionIndex + 1}`;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <nav className="text-xs text-[#4f6977]">
          <Link href="/manager/programs" className="text-[#0f5b73]">
            {t.breadcrumbBase}
          </Link>{" "}
          / <span>{program.title}</span>
        </nav>
        <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold text-[#123447]">{t.title}</h2>
              <p className="mt-1 text-sm text-[#35515f]">{t.subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openAssignModal}
                className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white"
              >
                {t.assignButton}
              </button>
              <button
                type="button"
                onClick={() => void loadProgram()}
                className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
              >
                {t.reload}
              </button>
            </div>
          </div>
        </section>
      </div>

      <section className="space-y-4 rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <label className="space-y-1">
          <span className="text-sm font-medium text-[#214759]">{t.fieldTitle}</span>
          <input
            className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium text-[#214759]">{t.fieldDescription}</span>
          <textarea
            className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
          />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-[#214759]">{t.fieldTopic}</span>
            <input
              type="number"
              min={1}
              max={13}
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={targetRiskTopic}
              onChange={(event) => setTargetRiskTopic(Number(event.target.value || 1))}
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-[#214759]">{t.fieldThreshold}</span>
            <input
              type="number"
              step={0.01}
              min={1}
              max={3}
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={triggerThreshold}
              onChange={(event) => setTriggerThreshold(Number(event.target.value || 1))}
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-[#214759]">{t.fieldFrequency}</span>
            <select
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={scheduleFrequency}
              onChange={(event) =>
                setScheduleFrequency(event.target.value as ContinuousProgramScheduleFrequency)
              }
            >
              {CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {t.frequencies[frequency]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#123447]">{t.sessionsTitle}</p>
              <p className="text-xs text-[#35515f]">{t.sessionsHint}</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <button
                type="button"
                onClick={openSessionsLibraryModal}
                className="rounded-full border border-[#9ec8db] px-3 py-1.5 text-xs font-semibold text-[#0f5b73]"
              >
                {t.sessionsAddButton}
              </button>
              <button
                type="button"
                onClick={() =>
                  setSessionViewMode((previous) =>
                    previous === "details" ? "list" : "details",
                  )
                }
                className="rounded-full border border-[#c9dce8] px-3 py-1.5 text-xs font-semibold text-[#35515f]"
              >
                {sessionViewMode === "details" ? t.sessionsViewList : t.sessionsViewDetails}
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-[#4f6977]">
            {t.sessionsCount}: {sessions.length}
          </p>

          <div className="mt-3 space-y-3">
            {sessionViewMode === "details" && currentSession ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveSessionIndex((previous) => Math.max(0, previous - 1))}
                    disabled={currentSessionIndex === 0}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#c9dce8] text-sm text-[#214759] disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={t.sessionPrevious}
                  >
                    &larr;
                  </button>
                  <div className="min-w-0 flex-1 px-2 text-center">
                    <p className="truncate text-lg font-bold text-[#123447]" title={currentSessionTitle}>
                      {currentSessionTitle}
                    </p>
                    <p className="text-xs font-semibold text-[#214759]">
                      {currentSessionIndex + 1}/{sessions.length}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveSessionIndex((previous) => Math.min(sessions.length - 1, previous + 1))
                    }
                    disabled={currentSessionIndex === sessions.length - 1}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#c9dce8] text-sm text-[#214759] disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={t.sessionNext}
                  >
                    &rarr;
                  </button>
                </div>

                <article key={currentSession.id} className="rounded-xl border border-[#d8e4ee] bg-white p-3">
                  <div className="mb-3 flex justify-end gap-2">
                    <Link
                      href={getSessionDetailsHref(currentSession.id)}
                      className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73] hover:underline"
                    >
                      {t.sessionOpenDetails}
                    </Link>
                    <button
                      type="button"
                      onClick={() => removeSession(currentSession.id)}
                      className="rounded-full border border-[#e8c1c1] px-3 py-1 text-xs font-semibold text-[#8d1c1c]"
                    >
                      {t.sessionDelete}
                    </button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1 md:col-span-2">
                      <span className="text-xs font-medium text-[#214759]">
                        {t.sessionTitle} #{currentSessionIndex + 1}
                      </span>
                      <input
                        value={currentSession.title}
                        onChange={(event) =>
                          updateSessionField(currentSession.id, "title", event.target.value)
                        }
                        className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-[#214759]">{t.sessionNotes}</span>
                      <textarea
                        rows={3}
                        value={currentSession.notes ?? ""}
                        onChange={(event) =>
                          updateSessionField(currentSession.id, "notes", event.target.value)
                        }
                        className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-[#214759]">{t.sessionPreparation}</span>
                      <textarea
                        rows={3}
                        value={currentSession.preparationRequired ?? ""}
                        onChange={(event) =>
                          updateSessionField(currentSession.id, "preparationRequired", event.target.value)
                        }
                        className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
                      />
                    </label>
                  </div>

                  <div className="mt-3 rounded-lg border border-[#e1edf4] bg-[#f8fbfd] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-[#214759]">{t.sessionMaterials}</p>
                      <label className="cursor-pointer rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]">
                        {uploadingSessionId === currentSession.id ? t.materialsUploading : t.materialsUpload}
                        <input
                          type="file"
                          multiple
                          accept={CONTINUOUS_PROGRAM_MATERIAL_ACCEPT_ATTR}
                          className="hidden"
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            void uploadSessionMaterials(currentSession.id, event.target.files);
                            event.target.value = "";
                          }}
                          disabled={uploadingSessionId !== null}
                        />
                      </label>
                    </div>

                    {currentSession.materials.length === 0 ? (
                      <p className="mt-2 text-xs text-[#55707f]">{t.sessionMaterialNone}</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {currentSession.materials.map((item) => (
                          <li key={item.id} className="rounded-lg border border-[#d8e4ee] bg-white p-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0 flex-1 space-y-1">
                                <label className="space-y-1">
                                  <span className="text-[11px] font-medium text-[#214759]">
                                    {t.materialsTitleField}
                                  </span>
                                  <input
                                    value={item.title}
                                    onChange={(event) =>
                                      updateSessionMaterialTitle(
                                        currentSession.id,
                                        item.id,
                                        event.target.value,
                                      )
                                    }
                                    className="w-full rounded-lg border border-[#c9dce8] px-3 py-1.5 text-sm"
                                  />
                                </label>
                                <p className="text-xs text-[#55707f]">
                                  {item.fileName} | {formatFileSize(item.sizeBytes)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <a
                                  href={item.downloadUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-full border border-[#c8c8c8] px-3 py-1 text-xs font-semibold text-[#1b2832]"
                                >
                                  Download
                                </a>
                                <button
                                  type="button"
                                  onClick={() => void removeMaterial(item.id)}
                                  disabled={removingMaterialId === item.id}
                                  className="rounded-full border border-[#e8c1c1] px-3 py-1 text-xs font-semibold text-[#8d1c1c] disabled:opacity-60"
                                >
                                  {removingMaterialId === item.id ? t.materialsRemoving : t.materialsRemove}
                                </button>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>

                <div className="flex items-center justify-center gap-2">
                  {sessions.map((session, sessionIndex) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => setActiveSessionIndex(sessionIndex)}
                      aria-label={`${t.sessionJumpTo} ${sessionIndex + 1}`}
                      className={`h-2.5 w-2.5 rounded-full border transition ${
                        currentSessionIndex === sessionIndex
                          ? "border-[#0f5b73] bg-[#0f5b73]"
                          : "border-[#9ec8db] bg-white"
                      }`}
                    />
                  ))}
                </div>
              </>
            ) : null}
            {sessionViewMode === "list" ? (
              <div className="overflow-x-auto rounded-xl border border-[#d8e4ee] bg-white">
                <table className="nr-table min-w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-2 py-2 text-left">{t.sessionsTitle}</th>
                      <th className="px-2 py-2 text-left">{t.sessionMaterials}</th>
                      <th className="px-2 py-2 text-left">{t.sessionEdit}</th>
                      <th className="px-2 py-2 text-left">{t.sessionDelete}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((session, sessionIndex) => (
                      <tr key={session.id} className="border-b">
                        <td className="px-2 py-2">
                          <Link
                            href={getSessionDetailsHref(session.id)}
                            className="font-medium text-[#123447] hover:text-[#0f5b73] hover:underline"
                          >
                            {session.title || `${t.sessionTitle} #${sessionIndex + 1}`}
                          </Link>
                          <p className="text-xs text-[#55707f]">
                            {t.sessionTitle} #{sessionIndex + 1}
                          </p>
                        </td>
                        <td className="px-2 py-2">{session.materials.length}</td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveSessionIndex(sessionIndex);
                              setSessionViewMode("details");
                            }}
                            className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                          >
                            {t.sessionEdit}
                          </button>
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => removeSession(session.id)}
                            className="rounded-full border border-[#e8c1c1] px-3 py-1 text-xs font-semibold text-[#8d1c1c]"
                          >
                            {t.sessionDelete}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
          <p className="text-sm font-semibold text-[#123447]">{t.evaluationTitle}</p>
          <p className="text-xs text-[#35515f]">{t.evaluationHint}</p>
          <div className="mt-3 space-y-2">
            {evaluationQuestions.map((question, index) => (
              <div key={`${index}-${question.slice(0, 12)}`} className="flex gap-2">
                <input
                  value={question}
                  onChange={(event) => updateQuestion(index, event.target.value)}
                  className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => removeQuestion(index)}
                  disabled={evaluationQuestions.length <= 1}
                  className="rounded-full border border-[#e8c1c1] px-3 py-1 text-xs font-semibold text-[#8d1c1c] disabled:opacity-50"
                >
                  {t.evaluationRemove}
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addQuestion}
            className="mt-3 rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
          >
            {t.evaluationAdd}
          </button>
        </div>

        <div className="rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
          <p className="text-sm font-semibold text-[#123447]">{t.metricsTitle}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-[#214759]">{t.metricParticipation}</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
                value={metrics.participationTarget}
                onChange={(event) =>
                  setMetrics((prev) => ({ ...prev, participationTarget: Number(event.target.value || 0) }))
                }
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-[#214759]">{t.metricCompletion}</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
                value={metrics.completionTarget}
                onChange={(event) =>
                  setMetrics((prev) => ({ ...prev, completionTarget: Number(event.target.value || 0) }))
                }
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-[#214759]">{t.metricAdherence}</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
                value={metrics.adherenceTarget}
                onChange={(event) =>
                  setMetrics((prev) => ({ ...prev, adherenceTarget: Number(event.target.value || 0) }))
                }
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-[#214759]">{t.metricSatisfaction}</span>
              <input
                type="number"
                min={1}
                max={5}
                step={0.1}
                className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
                value={metrics.satisfactionTarget}
                onChange={(event) =>
                  setMetrics((prev) => ({ ...prev, satisfactionTarget: Number(event.target.value || 0) }))
                }
              />
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
          <p className="text-sm font-semibold text-[#123447]">{t.assignments}</p>
          <div className="mt-2 grid gap-2 text-xs text-[#35515f] md:grid-cols-4">
            <p>
              {t.assignedTotal}: <strong>{program.assignments.total}</strong>
            </p>
            <p>
              {t.assignedRecommended}: <strong>{program.assignments.recommended}</strong>
            </p>
            <p>
              {t.assignedActive}: <strong>{program.assignments.active}</strong>
            </p>
            <p>
              {t.assignedCompleted}: <strong>{program.assignments.completed}</strong>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isSaving || uploadingSessionId !== null || removingMaterialId !== null}
            onClick={() => void saveProgram()}
            className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {isSaving ? t.saving : t.save}
          </button>
        </div>

        {notice ? <p className="text-sm text-[#1f6b3d]">{notice}</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </section>

      {isSessionsLibraryOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-5xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-lg font-semibold text-[#123447]">{t.sessionsLibraryTitle}</h4>
                <p className="text-sm text-[#4f6977]">{t.sessionsLibrarySubtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsSessionsLibraryOpen(false)}
                className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
              >
                {t.close}
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
              <h5 className="text-sm font-semibold text-[#123447]">{t.sessionsLibraryCreateTitle}</h5>
              <p className="mt-1 text-xs text-[#4f6977]">{t.sessionsLibraryCreateSubtitle}</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs text-[#4f6977] md:col-span-2">
                  {t.sessionsLibraryCreateFieldTitle}
                  <input
                    value={createSessionTitle}
                    onChange={(event) => setCreateSessionTitle(event.target.value)}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs text-[#4f6977] md:col-span-2">
                  {t.sessionsLibraryCreateFieldModule}
                  <select
                    value={createSessionModule}
                    onChange={(event) => setCreateSessionModule(event.target.value)}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                  >
                    {sessionModuleOptions.map((moduleTitle) => (
                      <option key={`editor-create-session-module-${moduleTitle}`} value={moduleTitle}>
                        {moduleTitle}
                      </option>
                    ))}
                    <option value={CREATE_SESSION_NEW_MODULE_OPTION}>
                      {t.sessionsLibraryCreateModuleNewOption}
                    </option>
                  </select>
                </label>
                {createSessionModule === CREATE_SESSION_NEW_MODULE_OPTION ? (
                  <label className="text-xs text-[#4f6977] md:col-span-2">
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
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => void createSessionInLibrary()}
                  disabled={isCreatingSession}
                  className="rounded-full border border-[#0f5b73] px-3 py-1 text-xs font-semibold text-[#0f5b73] disabled:opacity-50"
                >
                  {isCreatingSession ? t.sessionsLibraryCreating : t.sessionsLibraryNewSession}
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-xs text-[#4f6977]">
                {t.sessionsLibrarySearch}
                <input
                  value={sessionsCatalogSearchTerm}
                  onChange={(event) => setSessionsCatalogSearchTerm(event.target.value)}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                  placeholder={t.sessionsLibrarySearch}
                />
              </label>
              <label className="text-xs text-[#4f6977]">
                {t.sessionsLibraryFilterProgram}
                <select
                  value={sessionsCatalogSourceProgramFilterId}
                  onChange={(event) => setSessionsCatalogSourceProgramFilterId(event.target.value)}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                >
                  <option value="all">{t.sessionsLibraryFilterAllPrograms}</option>
                  {sessionsCatalogSourceOptions.map(([filterKey, label]) => (
                    <option key={`sessions-library-source-${filterKey}`} value={filterKey}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setSelectedSessionCatalogIds(filteredSessionsCatalog.map((item) => item.catalogId))
                }
                className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
              >
                {t.sessionsLibrarySelectAll}
              </button>
              <button
                type="button"
                onClick={() => setSelectedSessionCatalogIds([])}
                className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#35515f]"
              >
                {t.sessionsLibraryClear}
              </button>
            </div>

            {isLoadingSessionsLibrary ? (
              <p className="mt-4 text-sm text-[#4f6977]">{t.sessionsLibraryLoading}</p>
            ) : (
              <div className="mt-4 max-h-[55vh] space-y-3 overflow-auto">
                {groupedFilteredSessionsCatalog.length === 0 ? (
                  <p className="text-xs text-[#5a7383]">{t.sessionsLibraryNone}</p>
                ) : null}
                {groupedFilteredSessionsCatalog.map((group) => (
                  <div key={`editor-session-module-${group.moduleOrder}-${group.moduleLabel}`} className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#49697a]">
                      {group.moduleLabel}
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-[#d8e4ee]">
                      <table className="nr-table min-w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="px-2 py-2 text-left">#</th>
                            <th className="px-2 py-2 text-left">{t.sessionsLibraryProgramCol}</th>
                            <th className="px-2 py-2 text-left">{t.sessionsLibrarySessionCol}</th>
                            <th className="px-2 py-2 text-left">{t.sessionsLibraryNotesCol}</th>
                            <th className="px-2 py-2 text-left">{t.sessionsLibraryFilesCol}</th>
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
                                <p className="font-semibold text-[#123447]">{group.moduleLabel}</p>
                              </td>
                              <td className="px-2 py-2">
                                <p className="font-medium text-[#123447]">
                                  {item.topicTitle ?? item.sessionTitle}
                                </p>
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
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {sessionsLibraryError ? <p className="mt-3 text-sm text-red-600">{sessionsLibraryError}</p> : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={applySelectedSessionsFromLibrary}
                disabled={isLoadingSessionsLibrary || selectedSessionCatalogIds.length === 0}
                className="rounded-full bg-[#0f5b73] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {t.sessionsLibraryApply} ({selectedSessionCatalogIds.length})
              </button>
              <button
                type="button"
                onClick={() => setIsSessionsLibraryOpen(false)}
                className="rounded-full border border-[#9ec8db] px-4 py-2 text-sm font-semibold text-[#0f5b73]"
              >
                {t.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAssignModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-lg font-semibold text-[#123447]">{t.assignTitle}</h4>
                <p className="text-sm text-[#4f6977]">{t.assignSubtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsAssignModalOpen(false)}
                className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
              >
                {t.close}
              </button>
            </div>

            {isLoadingAssignClients ? (
              <p className="mt-4 text-sm text-[#4f6977]">{t.assignLoadingClients}</p>
            ) : null}
            {!isLoadingAssignClients && assignClients.length === 0 ? (
              <p className="mt-4 text-sm text-[#5a7383]">{t.assignNoClients}</p>
            ) : null}

            {!isLoadingAssignClients && assignClients.length > 0 ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-xs text-[#4f6977] md:col-span-2">
                  {t.assignCompany}
                  <select
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={assignClientId}
                    onChange={(event) => setAssignClientId(event.target.value)}
                  >
                    {assignClients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.companyName} | {client.cnpj}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs text-[#4f6977]">
                  {t.assignStatus}
                  <select
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={assignStatus}
                    onChange={(event) => setAssignStatus(event.target.value as AssignmentStatus)}
                  >
                    <option value="Recommended">Recommended</option>
                    <option value="Active">Active</option>
                    <option value="Completed">Completed</option>
                  </select>
                </label>

                <label className="text-xs text-[#4f6977]">
                  {t.assignDeployAt}
                  <input
                    type="datetime-local"
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={assignDeployedAt}
                    onChange={(event) => setAssignDeployedAt(event.target.value)}
                  />
                </label>

                <label className="text-xs text-[#4f6977]">
                  {t.assignFrequency}
                  <select
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={assignFrequency}
                    onChange={(event) =>
                      setAssignFrequency(event.target.value as ContinuousProgramScheduleFrequency)
                    }
                  >
                    {CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCIES.map((frequency) => (
                      <option key={`assign-frequency-${frequency}`} value={frequency}>
                        {t.frequencies[frequency]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs text-[#4f6977]">
                  {t.assignDuration}
                  <input
                    type="number"
                    min={1}
                    max={24}
                    step={1}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={assignDurationMonths}
                    onChange={(event) =>
                      setAssignDurationMonths(Number.parseInt(event.target.value || "0", 10))
                    }
                  />
                </label>

              </div>
            ) : null}

            {assignError ? <p className="mt-3 text-sm text-red-600">{assignError}</p> : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void assignProgramToCompany()}
                disabled={isAssigningProgram || isLoadingAssignClients || assignClients.length === 0}
                className="rounded-full bg-[#0f5b73] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isAssigningProgram ? t.assigning : t.assignConfirm}
              </button>
              <button
                type="button"
                onClick={() => setIsAssignModalOpen(false)}
                className="rounded-full border border-[#9ec8db] px-4 py-2 text-sm font-semibold text-[#0f5b73]"
              >
                {t.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
