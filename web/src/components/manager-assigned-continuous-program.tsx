"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";

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

type AvailabilitySlot = {
  startsAt: string;
  endsAt: string;
};

type AssignmentStatus = "Recommended" | "Active" | "Completed";

type AssignedContinuousProgram = {
  id: string;
  programId: string;
  programTitle: string;
  programDescription: string | null;
  targetRiskTopic: number | null;
  triggerThreshold: number | null;
  scheduleFrequency?: string;
  scheduleAnchorDate?: string | null;
  cadenceSuggestedSlots?: AvailabilitySlot[];
  calendarProvisorySlots?: AvailabilitySlot[];
  calendarCommittedSlots?: AvailabilitySlot[];
  status: AssignmentStatus;
  deployedAt: string | null;
};

type ContinuousProgramTemplate = {
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
};

type ClientDetailPayload = {
  client: {
    id: string;
    companyName: string;
  };
};

type ClientProgramsPayload = {
  assignedPrograms: AssignedContinuousProgram[];
};

type ProgramTemplatePayload = {
  program: ContinuousProgramTemplate;
};

type AssignmentPatchPayload = {
  assignment?: {
    id: string;
    programId: string;
    status: AssignmentStatus;
    deployedAt: string | null;
    scheduleFrequency?: string;
    scheduleAnchorDate?: string | null;
    cadenceSuggestedSlots?: AvailabilitySlot[];
    calendarProvisorySlots?: AvailabilitySlot[];
  };
  error?: string;
  provisorySlots?: AvailabilitySlot[];
};

type TemplateClonePayload = {
  program?: {
    id: string;
    title: string;
  };
  error?: string;
};

type Snapshot = {
  status: AssignmentStatus;
  deployedAt: string;
  scheduleFrequency: ContinuousProgramScheduleFrequency;
  provisorySlots: AvailabilitySlot[];
  evaluationQuestions: string[];
  materials: ContinuousProgramMaterial[];
};

const STATUS_OPTIONS: AssignmentStatus[] = ["Recommended", "Active", "Completed"];

function toFrequency(value: string | null | undefined): ContinuousProgramScheduleFrequency {
  if (!value) return DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY;
  const found = CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCIES.find((item) => item === value);
  return found ?? DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY;
}

function fmtDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

function toDatetimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromDatetimeLocal(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function formatFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "-";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeSlots(slots: AvailabilitySlot[]) {
  const unique = new Map<string, AvailabilitySlot>();
  for (const slot of slots) {
    const start = new Date(slot.startsAt);
    const end = new Date(slot.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;
    const normalized = { startsAt: start.toISOString(), endsAt: end.toISOString() };
    unique.set(`${normalized.startsAt}|${normalized.endsAt}`, normalized);
  }
  return Array.from(unique.values()).sort(
    (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
  );
}

function durationMinutesFromRange(startsAt: string, endsAt: string, fallback = 60) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return fallback;
  const duration = Math.round((end.getTime() - start.getTime()) / (60 * 1000));
  if (!Number.isFinite(duration) || duration <= 0) return fallback;
  return duration;
}

function normalizeQuestions(questions: string[]) {
  return questions
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeMaterials(materials: ContinuousProgramMaterial[]) {
  return materials
    .map((item) => ({
      ...item,
      title: item.title.trim().length > 0 ? item.title.trim() : item.fileName,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function ManagerAssignedContinuousProgram({
  clientId,
  assignmentId,
}: {
  clientId: string;
  assignmentId: string;
}) {
  const [clientName, setClientName] = useState("");
  const [assignment, setAssignment] = useState<AssignedContinuousProgram | null>(null);
  const [template, setTemplate] = useState<ContinuousProgramTemplate | null>(null);
  const [status, setStatus] = useState<AssignmentStatus>("Active");
  const [deployedAt, setDeployedAt] = useState("");
  const [scheduleFrequency, setScheduleFrequency] = useState<ContinuousProgramScheduleFrequency>(
    DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY,
  );
  const [provisorySlots, setProvisorySlots] = useState<AvailabilitySlot[]>([]);
  const [materials, setMaterials] = useState<ContinuousProgramMaterial[]>([]);
  const [evaluationQuestions, setEvaluationQuestions] = useState<string[]>(
    DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS,
  );
  const [baseline, setBaseline] = useState<Snapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [removingMaterialId, setRemovingMaterialId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const sortedCommittedSlots = useMemo(
    () => normalizeSlots(assignment?.calendarCommittedSlots ?? []),
    [assignment?.calendarCommittedSlots],
  );

  const changeState = useMemo(() => {
    if (!baseline) return { assignmentChanged: false, templateChanged: false, hasChanges: false };

    const assignmentChanged =
      baseline.status !== status ||
      baseline.deployedAt !== deployedAt ||
      baseline.scheduleFrequency !== scheduleFrequency ||
      JSON.stringify(baseline.provisorySlots) !== JSON.stringify(normalizeSlots(provisorySlots));

    const templateChanged =
      JSON.stringify(baseline.evaluationQuestions) !== JSON.stringify(normalizeQuestions(evaluationQuestions)) ||
      JSON.stringify(baseline.materials) !== JSON.stringify(normalizeMaterials(materials));

    return {
      assignmentChanged,
      templateChanged,
      hasChanges: assignmentChanged || templateChanged,
    };
  }, [
    baseline,
    status,
    deployedAt,
    scheduleFrequency,
    provisorySlots,
    evaluationQuestions,
    materials,
  ]);

  function applyLoadedData(
    loadedAssignment: AssignedContinuousProgram,
    loadedTemplate: ContinuousProgramTemplate,
  ) {
    const nextQuestions =
      loadedTemplate.evaluationQuestions.length > 0
        ? normalizeQuestions(loadedTemplate.evaluationQuestions)
        : DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS;
    const nextMaterials = normalizeMaterials(loadedTemplate.materials ?? []);
    const nextStatus = loadedAssignment.status;
    const nextDeployedAt = toDatetimeLocal(loadedAssignment.deployedAt);
    const nextFrequency = toFrequency(loadedAssignment.scheduleFrequency);
    const nextSlots = normalizeSlots(
      loadedAssignment.calendarProvisorySlots ?? loadedAssignment.cadenceSuggestedSlots ?? [],
    );

    setAssignment(loadedAssignment);
    setTemplate(loadedTemplate);
    setStatus(nextStatus);
    setDeployedAt(nextDeployedAt);
    setScheduleFrequency(nextFrequency);
    setProvisorySlots(nextSlots);
    setMaterials(nextMaterials);
    setEvaluationQuestions(nextQuestions);
    setBaseline({
      status: nextStatus,
      deployedAt: nextDeployedAt,
      scheduleFrequency: nextFrequency,
      provisorySlots: nextSlots,
      materials: nextMaterials,
      evaluationQuestions: nextQuestions,
    });
  }

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    setNotice("");
    try {
      const [clientResponse, programsResponse] = await Promise.all([
        fetch(`/api/admin/clients/${clientId}`, { cache: "no-store" }),
        fetch(`/api/admin/clients/${clientId}/programs`, { cache: "no-store" }),
      ]);

      if (!clientResponse.ok) {
        const payload = (await clientResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Falha ao carregar cliente.");
      }
      if (!programsResponse.ok) {
        const payload = (await programsResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Falha ao carregar programas continuos.");
      }

      const clientPayload = (await clientResponse.json()) as ClientDetailPayload;
      const programsPayload = (await programsResponse.json()) as ClientProgramsPayload;
      const foundAssignment =
        programsPayload.assignedPrograms.find((item) => item.id === assignmentId) ?? null;

      if (!foundAssignment) {
        throw new Error("Processo continuo atribuido nao encontrado.");
      }

      const templateResponse = await fetch(
        `/api/admin/programs-database/continuous/${foundAssignment.programId}`,
        { cache: "no-store" },
      );
      if (!templateResponse.ok) {
        const payload = (await templateResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Falha ao carregar template do programa.");
      }

      const templatePayload = (await templateResponse.json()) as ProgramTemplatePayload;
      if (!templatePayload.program) {
        throw new Error("Template do programa nao encontrado.");
      }

      setClientName(clientPayload.client.companyName);
      applyLoadedData(foundAssignment, templatePayload.program);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar detalhes.");
      setClientName("");
      setAssignment(null);
      setTemplate(null);
      setBaseline(null);
    } finally {
      setIsLoading(false);
    }
  }, [assignmentId, clientId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function uploadMaterials(files: FileList | null) {
    if (!files || files.length === 0 || !assignment) return;
    setIsUploading(true);
    setError("");
    setNotice("");
    try {
      const addedMaterials: ContinuousProgramMaterial[] = [];
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch(
          `/api/admin/programs-database/continuous/${assignment.programId}/materials`,
          {
            method: "POST",
            body: formData,
          },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Nao foi possivel enviar material.");
        }
        const payload = (await response.json()) as { material?: ContinuousProgramMaterial };
        if (payload.material) addedMaterials.push(payload.material);
      }
      if (addedMaterials.length > 0) {
        setMaterials((previous) => normalizeMaterials([...previous, ...addedMaterials]));
        setNotice("Materiais enviados.");
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Nao foi possivel enviar material.");
    } finally {
      setIsUploading(false);
    }
  }

  async function removeMaterial(materialId: string) {
    if (!assignment) return;
    setRemovingMaterialId(materialId);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/admin/programs-database/continuous/${assignment.programId}/materials`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ materialId }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Nao foi possivel remover material.");
      }
      setMaterials((previous) => previous.filter((item) => item.id !== materialId));
      setNotice("Material removido.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Nao foi possivel remover material.");
    } finally {
      setRemovingMaterialId(null);
    }
  }

  async function cloneTemplate(
    sourceTemplate: ContinuousProgramTemplate,
    sourceAssignment: AssignedContinuousProgram,
    sourceQuestions: string[],
    sourceMaterials: ContinuousProgramMaterial[],
  ) {
    const cloneDate = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" })
      .format(new Date())
      .replaceAll("/", "-");
    const titleBase = sourceTemplate.title.trim() || sourceAssignment.programTitle;
    const cloneTitle = `${titleBase} (copia ${cloneDate})`.slice(0, 255);
    const response = await fetch("/api/admin/programs-database/continuous", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: cloneTitle,
        description: sourceTemplate.description ?? null,
        targetRiskTopic: sourceTemplate.targetRiskTopic,
        triggerThreshold: sourceTemplate.triggerThreshold,
        scheduleFrequency,
        evaluationQuestions: sourceQuestions,
        materials: sourceMaterials,
        metrics: sourceTemplate.metrics ?? DEFAULT_CONTINUOUS_PROGRAM_METRICS,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as TemplateClonePayload;
    if (!response.ok || !payload.program) {
      throw new Error(payload.error ?? "Alteracoes salvas, mas nao foi possivel criar novo template.");
    }
    setNotice(`Alteracoes salvas. Novo template criado: ${payload.program.title}.`);
  }

  async function saveChanges() {
    if (!assignment || !template) return;
    if (!changeState.hasChanges) {
      setNotice("Nenhuma alteracao para salvar.");
      return;
    }

    const deployedAtIso = fromDatetimeLocal(deployedAt);
    if (!deployedAtIso) {
      setError("Data de aplicacao invalida.");
      return;
    }

    const normalizedQuestions = normalizeQuestions(evaluationQuestions);
    if (normalizedQuestions.length === 0) {
      setError("Adicione pelo menos uma pergunta de questionario.");
      return;
    }
    if (normalizedQuestions.some((item) => item.length < 5)) {
      setError("Cada pergunta precisa ter pelo menos 5 caracteres.");
      return;
    }

    const normalizedMaterials = normalizeMaterials(materials);

    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      let nextAssignment = assignment;
      let nextTemplate = template;

      if (changeState.assignmentChanged) {
        const assignmentPayload: {
          status: AssignmentStatus;
          deployedAt: string;
          scheduleFrequency?: ContinuousProgramScheduleFrequency;
        } = {
          status,
          deployedAt: deployedAtIso,
        };

        if (!baseline || baseline.scheduleFrequency !== scheduleFrequency) {
          assignmentPayload.scheduleFrequency = scheduleFrequency;
        }

        const response = await fetch(`/api/admin/clients/${clientId}/programs/${assignment.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(assignmentPayload),
        });
        const payload = (await response.json().catch(() => ({}))) as AssignmentPatchPayload;
        if (!response.ok) {
          if (response.status === 409 && Array.isArray(payload.provisorySlots)) {
            setProvisorySlots(payload.provisorySlots);
          }
          throw new Error(payload.error ?? "Nao foi possivel atualizar atribuicao.");
        }
        if (payload.assignment) {
          nextAssignment = {
            ...assignment,
            status: payload.assignment.status,
            deployedAt: payload.assignment.deployedAt,
            scheduleFrequency: payload.assignment.scheduleFrequency,
            scheduleAnchorDate: payload.assignment.scheduleAnchorDate,
            cadenceSuggestedSlots: payload.assignment.cadenceSuggestedSlots,
            calendarProvisorySlots: payload.assignment.calendarProvisorySlots,
          };
        }
      }

      if (changeState.templateChanged) {
        const response = await fetch(
          `/api/admin/programs-database/continuous/${assignment.programId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              evaluationQuestions: normalizedQuestions,
              materials: normalizedMaterials,
            }),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          program?: ContinuousProgramTemplate;
          error?: string;
        };
        if (!response.ok || !payload.program) {
          throw new Error(payload.error ?? "Nao foi possivel atualizar template.");
        }
        nextTemplate = payload.program;
      }

      applyLoadedData(nextAssignment, nextTemplate);
      setNotice("Alteracoes salvas.");

      if (
        window.confirm(
          "Deseja salvar estas alteracoes como novo template na Base de programas?",
        )
      ) {
        await cloneTemplate(
          nextTemplate,
          nextAssignment,
          normalizeQuestions(nextTemplate.evaluationQuestions),
          normalizeMaterials(nextTemplate.materials),
        );
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Nao foi possivel salvar alteracoes.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <p className="text-sm text-[#49697a]">Carregando detalhes do processo continuo...</p>;
  }

  if (!assignment || !template) {
    return <p className="text-sm text-red-600">{error || "Processo continuo nao encontrado."}</p>;
  }

  return (
    <div className="space-y-6">
      <nav className="text-xs text-[#4f6977]">
        <Link href="/manager/clients" className="text-[#0f5b73]">
          Client area
        </Link>{" "}
        /{" "}
        <Link href={`/manager/clients/${clientId}`} className="text-[#0f5b73]">
          {clientName || "Cliente"}
        </Link>{" "}
        /{" "}
        <Link href={`/manager/clients/${clientId}?tab=assigned-continuous`} className="text-[#0f5b73]">
          Assigned processo continuous
        </Link>{" "}
        / <span>{assignment.programTitle}</span>
      </nav>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#123447]">{template.title}</h2>
        <p className="mt-1 text-sm text-[#4f6977]">
          {template.description ?? assignment.programDescription ?? assignment.programId}
        </p>
      </section>

      <section className="space-y-4 rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Detalhes da atribuicao</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-[#214759]">Status</span>
            <select
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={status}
              onChange={(event) => setStatus(event.target.value as AssignmentStatus)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-[#214759]">Aplicado em</span>
            <input
              type="datetime-local"
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={deployedAt}
              onChange={(event) => setDeployedAt(event.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-[#214759]">Recorrencia</span>
            <select
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={scheduleFrequency}
              onChange={(event) =>
                setScheduleFrequency(event.target.value as ContinuousProgramScheduleFrequency)
              }
            >
              {CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {frequency}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-sm text-[#365668]">
          Topico alvo {template.targetRiskTopic} | Gatilho {template.triggerThreshold.toFixed(2)}
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-[#123447]">Chronograma (4 proximos eventos)</h3>
        </div>
        {sortedCommittedSlots.length > 0 ? (
          <div className="rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#365668]">
              Eventos comprometidos
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {sortedCommittedSlots.map((slot) => (
                <div
                  key={`committed-${slot.startsAt}`}
                  className="flex items-center gap-2 rounded-full border border-[#c6dbe8] bg-[#eef7fb] px-2 py-1 text-[11px] text-[#244f63]"
                >
                  <span>
                    {fmtDateTime(slot.startsAt)} | {durationMinutesFromRange(slot.startsAt, slot.endsAt, 60)} min
                  </span>
                  <Link
                    href={{
                      pathname: "/manager/calendar",
                      query: { assignmentId, markedAt: slot.startsAt },
                    }}
                    className="rounded-full border border-[#9ec8db] bg-white px-2 py-0.5 text-[10px] font-semibold text-[#0f5b73]"
                  >
                    Ver no calendario
                  </Link>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="space-y-2">
          {provisorySlots.length === 0 ? (
            <p className="text-xs text-[#5a7383]">Sem marcos provisiorios.</p>
          ) : (
            provisorySlots.map((slot, index) => (
              <div
                key={`slot-${slot.startsAt}-${index}`}
                className="grid gap-2 rounded-lg border border-[#d7e6ee] bg-[#f8fbfd] p-2 md:grid-cols-[1fr_180px_auto]"
              >
                <p className="rounded border border-[#c9dce8] bg-white px-3 py-2 text-xs text-[#123447]">
                  {fmtDateTime(slot.startsAt)}
                </p>
                <p className="rounded border border-[#c9dce8] bg-white px-3 py-2 text-xs text-[#123447]">
                  {durationMinutesFromRange(slot.startsAt, slot.endsAt, 60)} min
                </p>
                <Link
                  href={{
                    pathname: "/manager/calendar",
                    query: { assignmentId, markedAt: slot.startsAt },
                  }}
                  className="inline-flex items-center justify-center rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                >
                  Ver no calendario
                </Link>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-[#123447]">Materiais para download</h3>
          <label className="cursor-pointer rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]">
            {isUploading ? "Enviando..." : "Enviar arquivos"}
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
          <p className="text-xs text-[#5a7383]">Nenhum material enviado.</p>
        ) : (
          <ul className="space-y-2">
            {materials.map((item) => (
              <li key={item.id} className="rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <input
                      value={item.title}
                      onChange={(event) =>
                        setMaterials((previous) =>
                          previous.map((material) =>
                            material.id === item.id ? { ...material, title: event.target.value } : material,
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#c9dce8] px-3 py-1.5 text-sm"
                    />
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
                      {removingMaterialId === item.id ? "Removendo..." : "Remover"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-[#123447]">Perguntas do questionario</h3>
          <button
            type="button"
            onClick={() => setEvaluationQuestions((previous) => [...previous, ""])}
            className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
          >
            Adicionar pergunta
          </button>
        </div>
        <div className="space-y-2">
          {evaluationQuestions.map((question, index) => (
            <div key={`${index}-${question.slice(0, 8)}`} className="flex gap-2">
              <input
                value={question}
                onChange={(event) =>
                  setEvaluationQuestions((previous) =>
                    previous.map((item, itemIndex) =>
                      itemIndex === index ? event.target.value : item,
                    ),
                  )
                }
                className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() =>
                  setEvaluationQuestions((previous) =>
                    previous.length <= 1
                      ? previous
                      : previous.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
                disabled={evaluationQuestions.length <= 1}
                className="rounded-full border border-[#e8c1c1] px-3 py-1 text-xs font-semibold text-[#8d1c1c] disabled:opacity-50"
              >
                Remover
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void saveChanges()}
            disabled={isSaving || isUploading || removingMaterialId !== null}
            className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {isSaving ? "Salvando..." : "Salvar alteracoes"}
          </button>
          <span className="text-xs text-[#5a7383]">
            {changeState.hasChanges ? "Ha alteracoes nao salvas." : "Sem alteracoes pendentes."}
          </span>
        </div>
        {notice ? <p className="mt-3 text-sm text-[#1f6b3d]">{notice}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </section>
    </div>
  );
}
