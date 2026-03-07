"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";

import { useManagerLocale } from "@/components/manager-locale";
import {
  CONTINUOUS_PROGRAM_MATERIAL_ACCEPT_ATTR,
  CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCIES,
  DEFAULT_CONTINUOUS_PROGRAM_METRICS,
  DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS,
  DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY,
  type ContinuousProgramMaterial,
  type ContinuousProgramMetrics,
  type ContinuousProgramScheduleFrequency,
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
  const [materials, setMaterials] = useState<ContinuousProgramMaterial[]>([]);
  const [metrics, setMetrics] = useState<ContinuousProgramMetrics>(DEFAULT_CONTINUOUS_PROGRAM_METRICS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [removingMaterialId, setRemovingMaterialId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
      setMaterials(payload.program.materials ?? []);
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
    setAssignDurationMonths(6);
    setAssignError("");
    setIsAssignModalOpen(true);
    if (assignClients.length === 0 && !isLoadingAssignClients) {
      void loadAssignClients();
    }
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

  async function uploadMaterials(files: FileList | null) {
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setError("");
    setNotice("");

    try {
      const uploads = Array.from(files);
      const addedMaterials: ContinuousProgramMaterial[] = [];

      for (const file of uploads) {
        const formData = new FormData();
        formData.append("file", file);

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

        const payload = (await response.json()) as { material?: ContinuousProgramMaterial };
        if (payload.material) {
          addedMaterials.push(payload.material);
        }
      }

      if (addedMaterials.length > 0) {
        setMaterials((prev) => [...prev, ...addedMaterials]);
        setNotice(t.materialsUploaded);
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t.uploadError);
    } finally {
      setIsUploading(false);
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

      setMaterials((prev) => prev.filter((item) => item.id !== materialId));
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

  function updateMaterialTitle(materialId: string, nextTitle: string) {
    setMaterials((prev) =>
      prev.map((item) => (item.id === materialId ? { ...item, title: nextTitle } : item)),
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

    const normalizedMaterials = materials.map((item) => ({
      ...item,
      title: item.title.trim().length > 0 ? item.title.trim() : item.fileName,
    }));

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
        setMaterials(payload.program.materials);
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

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <nav className="mb-3 text-xs text-[#4f6977]">
          <Link href="/manager/programs" className="text-[#0f5b73]">
            {t.breadcrumbBase}
          </Link>{" "}
          / <span>{program.title}</span>
        </nav>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[#123447]">{t.materialsTitle}</p>
              <p className="text-xs text-[#35515f]">{t.materialsHint}</p>
            </div>
            <label className="cursor-pointer rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]">
              {isUploading ? t.materialsUploading : t.materialsUpload}
              <input
                type="file"
                multiple
                accept={CONTINUOUS_PROGRAM_MATERIAL_ACCEPT_ATTR}
                className="hidden"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  void uploadMaterials(event.target.files);
                  event.target.value = "";
                }}
                disabled={isUploading}
              />
            </label>
          </div>

          {materials.length === 0 ? (
            <p className="mt-3 text-xs text-[#55707f]">{t.materialsNone}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {materials.map((item) => (
                <li key={item.id} className="rounded-xl border border-[#d8e4ee] bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-[#214759]">{t.materialsTitleField}</span>
                        <input
                          value={item.title}
                          onChange={(event) => updateMaterialTitle(item.id, event.target.value)}
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
            disabled={isSaving || isUploading || removingMaterialId !== null}
            onClick={() => void saveProgram()}
            className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {isSaving ? t.saving : t.save}
          </button>
        </div>

        {notice ? <p className="text-sm text-[#1f6b3d]">{notice}</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </section>

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
