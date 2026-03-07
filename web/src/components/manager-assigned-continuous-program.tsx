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

type AssignmentCalendarEvent = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "completed" | "cancelled";
  lifecycle: "provisory" | "committed";
  proposalKind: "assignment" | "reschedule" | null;
  sessionId?: string | null;
  sessionIndex?: number | null;
  sessionTitle?: string | null;
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
  calendarTimelineEvents?: AssignmentCalendarEvent[];
  annualPlanMonths?: string[];
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
    calendarTimelineEvents?: AssignmentCalendarEvent[];
    annualPlanMonths?: string[];
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

type ChronogramView = "list" | "calendar";
type ChronogramCalendarScope = "current" | "all";
type ChronogramCalendarEvent = AssignmentCalendarEvent & {
  programTitle: string;
  assignmentId: string;
  isCurrentProgram: boolean;
};
type ChronogramStatusOption = "Provisorio" | "Marcado" | "Cancelado" | "Executado";

const STATUS_OPTIONS: AssignmentStatus[] = ["Recommended", "Active", "Completed"];
const annualPlanMonthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
const CHRONOGRAM_WEEK_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"] as const;
const CHRONOGRAM_MAX_EVENTS_PER_DAY = 5;

function toMonthKey(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function normalizeAnnualPlanMonths(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const raw of value) {
    const normalized = typeof raw === "string" ? raw.trim() : "";
    if (!annualPlanMonthRegex.test(normalized)) continue;
    unique.add(normalized);
  }
  return Array.from(unique.values()).sort();
}

function toFrequency(value: string | null | undefined): ContinuousProgramScheduleFrequency {
  if (!value) return DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY;
  const found = CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCIES.find((item) => item === value);
  return found ?? DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY;
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

function dayKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function formatFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "-";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getAssignedSessionHref(programId: string, sessionId: string, returnTo: string): string {
  const normalized = sessionId.trim();
  const returnToParam = `returnTo=${encodeURIComponent(returnTo)}`;
  if (normalized.startsWith("library-")) {
    return `/manager/programs/sessions/library/${encodeURIComponent(
      normalized.slice("library-".length),
    )}?${returnToParam}`;
  }
  return `/manager/programs/sessions/program/${encodeURIComponent(programId)}/${encodeURIComponent(
    normalized,
  )}?${returnToParam}`;
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

function normalizeTimelineEvents(events: AssignmentCalendarEvent[]) {
  const byId = new Map<string, AssignmentCalendarEvent>();
  for (const event of events) {
    if (!event?.id) continue;
    const start = new Date(event.startsAt);
    const end = new Date(event.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;
    byId.set(event.id, {
      ...event,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    });
  }
  return Array.from(byId.values()).sort(
    (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
  );
}

function splitTimelineSlots(events: AssignmentCalendarEvent[]) {
  const committed: AvailabilitySlot[] = [];
  const provisory: AvailabilitySlot[] = [];
  for (const event of events) {
    if (event.status === "cancelled") continue;
    const slot = { startsAt: event.startsAt, endsAt: event.endsAt };
    if (event.lifecycle === "committed") {
      committed.push(slot);
    } else {
      provisory.push(slot);
    }
  }
  return { committed: normalizeSlots(committed), provisory: normalizeSlots(provisory) };
}

function chronogramStatusOptionFromEvent(event: AssignmentCalendarEvent): ChronogramStatusOption {
  if (event.status === "cancelled") return "Cancelado";
  if (event.status === "completed") return "Executado";
  if (event.lifecycle === "committed") return "Marcado";
  return "Provisorio";
}

function chronogramRowClassName(event: AssignmentCalendarEvent): string {
  if (event.status === "cancelled") return "bg-[#fff3f3]";
  if (event.status === "completed") return "bg-[#ecf9f0]";
  if (event.lifecycle === "committed") return "bg-[#ebf6fd]";
  return "bg-white";
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
  fromHistory = false,
  fromHome = false,
}: {
  clientId: string;
  assignmentId: string;
  fromHistory?: boolean;
  fromHome?: boolean;
}) {
  const [clientName, setClientName] = useState("");
  const [assignment, setAssignment] = useState<AssignedContinuousProgram | null>(null);
  const [allAssignedPrograms, setAllAssignedPrograms] = useState<AssignedContinuousProgram[]>([]);
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
  const [updatingLifecycleEventId, setUpdatingLifecycleEventId] = useState<string | null>(null);
  const [updatingTimingEventId, setUpdatingTimingEventId] = useState<string | null>(null);
  const [updatingStatusEventId, setUpdatingStatusEventId] = useState<string | null>(null);
  const [editingTimingEventId, setEditingTimingEventId] = useState<string | null>(null);
  const [eventTimingDraftById, setEventTimingDraftById] = useState<
    Record<string, { startsAt: string; durationMinutes: string }>
  >({});
  const [removingMaterialId, setRemovingMaterialId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [chronogramView, setChronogramView] = useState<ChronogramView>("list");
  const [chronogramCalendarScope, setChronogramCalendarScope] =
    useState<ChronogramCalendarScope>("current");
  const [hidePastChronogramEvents, setHidePastChronogramEvents] = useState(false);
  const [openChronogramActionsFor, setOpenChronogramActionsFor] = useState<string | null>(null);
  const [chronogramMonth, setChronogramMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const timelineEvents = useMemo(
    () => normalizeTimelineEvents(assignment?.calendarTimelineEvents ?? []),
    [assignment?.calendarTimelineEvents],
  );
  const annualPlanMonths = useMemo(
    () => normalizeAnnualPlanMonths(assignment?.annualPlanMonths),
    [assignment?.annualPlanMonths],
  );
  const chronogramEvents = useMemo(() => {
    if (annualPlanMonths.length === 0) return timelineEvents;
    const allowedMonths = new Set(annualPlanMonths);
    return timelineEvents.filter((event) => {
      const start = new Date(event.startsAt);
      if (Number.isNaN(start.getTime())) return false;
      return allowedMonths.has(toMonthKey(start));
    });
  }, [annualPlanMonths, timelineEvents]);
  const currentProgramCalendarEvents = useMemo<ChronogramCalendarEvent[]>(
    () =>
      chronogramEvents.map((event) => ({
        ...event,
        programTitle: assignment?.programTitle ?? "Programa atual",
        assignmentId: assignment?.id ?? assignmentId,
        isCurrentProgram: true,
      })),
    [assignment?.id, assignment?.programTitle, assignmentId, chronogramEvents],
  );
  const allProgramsCalendarEvents = useMemo<ChronogramCalendarEvent[]>(() => {
    const collected: ChronogramCalendarEvent[] = [];
    for (const item of allAssignedPrograms) {
      const normalized = normalizeTimelineEvents(item.calendarTimelineEvents ?? []);
      for (const event of normalized) {
        collected.push({
          ...event,
          programTitle: item.programTitle,
          assignmentId: item.id,
          isCurrentProgram: item.id === assignmentId,
        });
      }
    }
    return collected.sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
  }, [allAssignedPrograms, assignmentId]);
  const visibleCalendarEvents = useMemo(
    () => (chronogramCalendarScope === "all" ? allProgramsCalendarEvents : currentProgramCalendarEvents),
    [allProgramsCalendarEvents, chronogramCalendarScope, currentProgramCalendarEvents],
  );
  const chronogramListEvents = useMemo(() => {
    if (!hidePastChronogramEvents) return chronogramEvents;
    const now = Date.now();
    return chronogramEvents.filter((event) => {
      const endsAt = new Date(event.endsAt).getTime();
      if (Number.isNaN(endsAt)) return true;
      return endsAt >= now;
    });
  }, [chronogramEvents, hidePastChronogramEvents]);
  const chronogramDisplayedCount =
    chronogramView === "calendar" ? visibleCalendarEvents.length : chronogramListEvents.length;
  const calendarEventsByDay = useMemo(() => {
    const map = new Map<string, ChronogramCalendarEvent[]>();
    for (const event of visibleCalendarEvents) {
      const startsAt = new Date(event.startsAt);
      if (Number.isNaN(startsAt.getTime())) continue;
      const key = dayKey(startsAt);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [visibleCalendarEvents]);
  const calendarDays = useMemo(() => {
    const start = new Date(chronogramMonth.getFullYear(), chronogramMonth.getMonth(), 1);
    const gridStart = new Date(start);
    gridStart.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const value = new Date(gridStart);
      value.setDate(gridStart.getDate() + index);
      const key = dayKey(value);
      return {
        key,
        value,
        inMonth: value.getMonth() === chronogramMonth.getMonth(),
        events: calendarEventsByDay.get(key) ?? [],
      };
    });
  }, [calendarEventsByDay, chronogramMonth]);

  useEffect(() => {
    if (chronogramView !== "calendar") return;
    const firstEvent = visibleCalendarEvents[0];
    if (!firstEvent) return;
    const start = new Date(firstEvent.startsAt);
    if (Number.isNaN(start.getTime())) return;
    setChronogramMonth((previous) => {
      if (previous.getFullYear() === start.getFullYear() && previous.getMonth() === start.getMonth()) {
        return previous;
      }
      return new Date(start.getFullYear(), start.getMonth(), 1);
    });
  }, [chronogramView, visibleCalendarEvents]);

  useEffect(() => {
    if (!openChronogramActionsFor) return;
    if (chronogramListEvents.some((event) => event.id === openChronogramActionsFor)) return;
    setOpenChronogramActionsFor(null);
  }, [chronogramListEvents, openChronogramActionsFor]);

  useEffect(() => {
    if (!editingTimingEventId) return;
    if (chronogramListEvents.some((event) => event.id === editingTimingEventId)) return;
    setEditingTimingEventId(null);
  }, [chronogramListEvents, editingTimingEventId]);

  useEffect(() => {
    setEventTimingDraftById(() => {
      const next: Record<string, { startsAt: string; durationMinutes: string }> = {};
      for (const event of timelineEvents) {
        next[event.id] = {
          startsAt: toDatetimeLocal(event.startsAt),
          durationMinutes: String(durationMinutesFromRange(event.startsAt, event.endsAt, 60)),
        };
      }
      return next;
    });
  }, [timelineEvents]);

  useEffect(() => {
    if (!assignment) return;
    setAllAssignedPrograms((previous) =>
      previous.map((item) =>
        item.id === assignment.id
          ? {
              ...item,
              annualPlanMonths: assignment.annualPlanMonths,
              calendarTimelineEvents: assignment.calendarTimelineEvents,
              calendarProvisorySlots: assignment.calendarProvisorySlots,
              calendarCommittedSlots: assignment.calendarCommittedSlots,
              scheduleFrequency: assignment.scheduleFrequency,
            }
          : item,
      ),
    );
  }, [assignment]);

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
    const nextTimelineEvents = normalizeTimelineEvents(loadedAssignment.calendarTimelineEvents ?? []);
    const timelineSlots = splitTimelineSlots(nextTimelineEvents);
    const nextQuestions =
      loadedTemplate.evaluationQuestions.length > 0
        ? normalizeQuestions(loadedTemplate.evaluationQuestions)
        : DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS;
    const nextMaterials = normalizeMaterials(loadedTemplate.materials ?? []);
    const nextStatus = loadedAssignment.status;
    const nextDeployedAt = toDatetimeLocal(loadedAssignment.deployedAt);
    const nextFrequency = toFrequency(loadedAssignment.scheduleFrequency);
    const nextSlots = normalizeSlots(
      timelineSlots.provisory.length > 0
        ? timelineSlots.provisory
        : loadedAssignment.calendarProvisorySlots ?? loadedAssignment.cadenceSuggestedSlots ?? [],
    );

    setAssignment({
      ...loadedAssignment,
      calendarTimelineEvents: nextTimelineEvents,
      calendarCommittedSlots: timelineSlots.committed,
      calendarProvisorySlots: timelineSlots.provisory,
    });
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
      setAllAssignedPrograms(programsPayload.assignedPrograms);
      applyLoadedData(foundAssignment, templatePayload.program);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar detalhes.");
      setClientName("");
      setAssignment(null);
      setAllAssignedPrograms([]);
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
            calendarTimelineEvents: payload.assignment.calendarTimelineEvents,
            annualPlanMonths: payload.assignment.annualPlanMonths,
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

  async function toggleEventLifecycle(event: AssignmentCalendarEvent) {
    if (!assignment) return;
    const nextLifecycle = event.lifecycle === "committed" ? "provisory" : "committed";
    setUpdatingLifecycleEventId(event.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/calendar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: event.id,
          eventLifecycle: nextLifecycle,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        event?: {
          id: string;
          startsAt: string;
          endsAt: string;
          status: "scheduled" | "completed" | "cancelled";
          details: {
            eventLifecycle: "provisory" | "committed";
            proposalKind: "assignment" | "reschedule" | null;
            sessionId?: string | null;
            sessionIndex?: number | null;
            sessionTitle?: string | null;
          };
        };
      };
      if (!response.ok || !payload.event) {
        throw new Error(payload.error ?? "Nao foi possivel atualizar ciclo do evento.");
      }
      const updatedEvent = payload.event;

      const updatedTimeline = normalizeTimelineEvents(
        (assignment.calendarTimelineEvents ?? []).map((item) =>
          item.id === updatedEvent.id
            ? {
                ...item,
                startsAt: updatedEvent.startsAt,
                endsAt: updatedEvent.endsAt,
                status: updatedEvent.status,
                lifecycle: updatedEvent.details.eventLifecycle,
                proposalKind: updatedEvent.details.proposalKind,
                sessionId: updatedEvent.details.sessionId ?? item.sessionId ?? null,
                sessionIndex: updatedEvent.details.sessionIndex ?? item.sessionIndex ?? null,
                sessionTitle: updatedEvent.details.sessionTitle ?? item.sessionTitle ?? null,
              }
            : item,
        ),
      );
      const slots = splitTimelineSlots(updatedTimeline);
      setAssignment((previous) =>
        previous
          ? {
              ...previous,
              calendarTimelineEvents: updatedTimeline,
              calendarCommittedSlots: slots.committed,
              calendarProvisorySlots: slots.provisory,
            }
          : previous,
      );
      setProvisorySlots(slots.provisory);
      setEventTimingDraftById((previous) => ({
        ...previous,
        [updatedEvent.id]: {
          startsAt: toDatetimeLocal(updatedEvent.startsAt),
          durationMinutes: String(
            durationMinutesFromRange(updatedEvent.startsAt, updatedEvent.endsAt, 60),
          ),
        },
      }));
      setNotice("Ciclo do evento atualizado.");
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Nao foi possivel atualizar ciclo do evento.",
      );
    } finally {
      setUpdatingLifecycleEventId(null);
    }
  }

  async function updateEventStatusOption(
    event: AssignmentCalendarEvent,
    nextStatusOption: ChronogramStatusOption,
  ) {
    if (!assignment) return;
    const payload: {
      eventId: string;
      status?: "scheduled" | "completed" | "cancelled";
      eventLifecycle?: "provisory" | "committed";
    } = {
      eventId: event.id,
    };

    if (nextStatusOption === "Provisorio") {
      payload.status = "scheduled";
      payload.eventLifecycle = "provisory";
    } else if (nextStatusOption === "Marcado") {
      payload.status = "scheduled";
      payload.eventLifecycle = "committed";
    } else if (nextStatusOption === "Cancelado") {
      payload.status = "cancelled";
    } else {
      payload.status = "completed";
      payload.eventLifecycle = "committed";
    }

    setUpdatingStatusEventId(event.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/calendar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        event?: {
          id: string;
          startsAt: string;
          endsAt: string;
          status: "scheduled" | "completed" | "cancelled";
          details: {
            eventLifecycle: "provisory" | "committed";
            proposalKind: "assignment" | "reschedule" | null;
            sessionId?: string | null;
            sessionIndex?: number | null;
            sessionTitle?: string | null;
          };
        };
      };
      if (!response.ok || !result.event) {
        throw new Error(result.error ?? "Nao foi possivel atualizar status do evento.");
      }
      const updatedEvent = result.event;
      const updatedTimeline = normalizeTimelineEvents(
        (assignment.calendarTimelineEvents ?? []).map((item) =>
          item.id === updatedEvent.id
            ? {
                ...item,
                startsAt: updatedEvent.startsAt,
                endsAt: updatedEvent.endsAt,
                status: updatedEvent.status,
                lifecycle: updatedEvent.details.eventLifecycle,
                proposalKind: updatedEvent.details.proposalKind,
                sessionId: updatedEvent.details.sessionId ?? item.sessionId ?? null,
                sessionIndex: updatedEvent.details.sessionIndex ?? item.sessionIndex ?? null,
                sessionTitle: updatedEvent.details.sessionTitle ?? item.sessionTitle ?? null,
              }
            : item,
        ),
      );
      const slots = splitTimelineSlots(updatedTimeline);
      setAssignment((previous) =>
        previous
          ? {
              ...previous,
              calendarTimelineEvents: updatedTimeline,
              calendarCommittedSlots: slots.committed,
              calendarProvisorySlots: slots.provisory,
            }
          : previous,
      );
      setProvisorySlots(slots.provisory);
      setEventTimingDraftById((previous) => ({
        ...previous,
        [updatedEvent.id]: {
          startsAt: toDatetimeLocal(updatedEvent.startsAt),
          durationMinutes: String(
            durationMinutesFromRange(updatedEvent.startsAt, updatedEvent.endsAt, 60),
          ),
        },
      }));
      setNotice("Status do evento atualizado.");
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Nao foi possivel atualizar status do evento.",
      );
    } finally {
      setUpdatingStatusEventId(null);
    }
  }

  async function updateEventTiming(event: AssignmentCalendarEvent): Promise<boolean> {
    if (!assignment) return false;
    const draft = eventTimingDraftById[event.id];
    if (!draft) return false;

    const markedAt = new Date(draft.startsAt);
    const durationMinutes = Number.parseInt(draft.durationMinutes, 10);
    if (Number.isNaN(markedAt.getTime()) || !Number.isFinite(durationMinutes) || durationMinutes < 15) {
      setError("Data/hora ou duracao invalida para o evento.");
      return false;
    }

    setUpdatingTimingEventId(event.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/calendar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: event.id,
          markedAt: markedAt.toISOString(),
          workshopDurationMinutes: durationMinutes,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        event?: {
          id: string;
          startsAt: string;
          endsAt: string;
          status: "scheduled" | "completed" | "cancelled";
          details: {
            eventLifecycle: "provisory" | "committed";
            proposalKind: "assignment" | "reschedule" | null;
            sessionId?: string | null;
            sessionIndex?: number | null;
            sessionTitle?: string | null;
          };
        };
      };
      if (!response.ok || !payload.event) {
        throw new Error(payload.error ?? "Nao foi possivel atualizar horario do evento.");
      }
      const updatedEvent = payload.event;

      const updatedTimeline = normalizeTimelineEvents(
        (assignment.calendarTimelineEvents ?? []).map((item) =>
          item.id === updatedEvent.id
            ? {
                ...item,
                startsAt: updatedEvent.startsAt,
                endsAt: updatedEvent.endsAt,
                status: updatedEvent.status,
                lifecycle: updatedEvent.details.eventLifecycle,
                proposalKind: updatedEvent.details.proposalKind,
                sessionId: updatedEvent.details.sessionId ?? item.sessionId ?? null,
                sessionIndex: updatedEvent.details.sessionIndex ?? item.sessionIndex ?? null,
                sessionTitle: updatedEvent.details.sessionTitle ?? item.sessionTitle ?? null,
              }
            : item,
        ),
      );
      const slots = splitTimelineSlots(updatedTimeline);
      setAssignment((previous) =>
        previous
          ? {
              ...previous,
              calendarTimelineEvents: updatedTimeline,
              calendarCommittedSlots: slots.committed,
              calendarProvisorySlots: slots.provisory,
            }
          : previous,
      );
      setProvisorySlots(slots.provisory);
      setEventTimingDraftById((previous) => ({
        ...previous,
        [updatedEvent.id]: {
          startsAt: toDatetimeLocal(updatedEvent.startsAt),
          durationMinutes: String(
            durationMinutesFromRange(updatedEvent.startsAt, updatedEvent.endsAt, 60),
          ),
        },
      }));
      setNotice("Horario do evento atualizado.");
      return true;
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Nao foi possivel atualizar horario do evento.",
      );
      return false;
    } finally {
      setUpdatingTimingEventId(null);
    }
  }

  if (isLoading) {
    return <p className="text-sm text-[#49697a]">Carregando detalhes do processo continuo...</p>;
  }

  if (!assignment || !template) {
    return <p className="text-sm text-red-600">{error || "Processo continuo nao encontrado."}</p>;
  }
  const assignmentReturnTo = (() => {
    const base = `/manager/clients/${encodeURIComponent(clientId)}/assigned-continuous/${encodeURIComponent(assignmentId)}`;
    const query = new URLSearchParams();
    if (fromHistory) {
      query.set("from", "history");
    } else if (fromHome) {
      query.set("from", "home");
    }
    if (clientName) {
      query.set("clientName", clientName);
    }
    if (assignment.programTitle) {
      query.set("assignmentTitle", assignment.programTitle);
    }
    const encoded = query.toString();
    return encoded.length > 0 ? `${base}?${encoded}` : base;
  })();
  const eventRecordFrom = fromHistory ? "history" : fromHome ? "home" : "client-area";

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <nav className="text-xs text-[#4f6977]">
          {fromHome ? (
            <>
              <Link href="/manager" className="text-[#0f5b73]">
                Home
              </Link>{" "}
              /{" "}
              <Link href={`/manager/clients/${clientId}`} className="text-[#0f5b73]">
                {clientName || "Cliente"}
              </Link>{" "}
              /{" "}
              <Link href={`/manager/clients/${clientId}?tab=assigned-continuous`} className="text-[#0f5b73]">
                Assigned processo continuos
              </Link>{" "}
              / <span>{assignment.programTitle}</span>
            </>
          ) : fromHistory ? (
            <>
              <Link href="/manager/history" className="text-[#0f5b73]">
                Historico
              </Link>{" "}
              /{" "}
              <Link href={`/manager/clients/${clientId}`} className="text-[#0f5b73]">
                {clientName || "Cliente"}
              </Link>{" "}
              /{" "}
              <Link
                href={`/manager/clients/${clientId}?tab=assigned-continuous&from=history`}
                className="text-[#0f5b73]"
              >
                Assigned processos continuos
              </Link>{" "}
              / <span>Processos continuos</span>
            </>
          ) : (
            <>
              <Link href="/manager/clients" className="text-[#0f5b73]">
                Client area
              </Link>{" "}
              /{" "}
              <Link href={`/manager/clients/${clientId}`} className="text-[#0f5b73]">
                {clientName || "Cliente"}
              </Link>{" "}
              /{" "}
              <Link href={`/manager/clients/${clientId}?tab=assigned-continuous`} className="text-[#0f5b73]">
                Assigned processo continuos
              </Link>{" "}
              / <span>{assignment.programTitle}</span>
            </>
          )}
        </nav>
        <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold text-[#123447]">{template.title}</h2>
            <Link
              href={`/manager/programs/continuous/${assignment.programId}`}
              className="text-sm font-semibold text-[#0f5b73] hover:underline"
            >
              Abrir no banco de programas
            </Link>
          </div>
          <p className="mt-1 text-sm text-[#4f6977]">
            {template.description ?? assignment.programDescription ?? assignment.programId}
          </p>
        </section>
      </div>

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-[#123447]">
            Chronograma ({chronogramDisplayedCount} eventos)
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-[#c9dce8] bg-white p-1">
              <button
                type="button"
                onClick={() => setChronogramView("list")}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  chronogramView === "list"
                    ? "bg-[#0f5b73] text-white"
                    : "text-[#123447] hover:bg-[#f3f8fb]"
                }`}
              >
                Lista
              </button>
              <button
                type="button"
                onClick={() => setChronogramView("calendar")}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  chronogramView === "calendar"
                    ? "bg-[#0f5b73] text-white"
                    : "text-[#123447] hover:bg-[#f3f8fb]"
                }`}
              >
                Calendario
              </button>
            </div>
            {chronogramView === "calendar" ? (
              <div className="rounded-full border border-[#c9dce8] bg-white p-1">
                <button
                  type="button"
                  onClick={() => setChronogramCalendarScope("current")}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    chronogramCalendarScope === "current"
                      ? "bg-[#0f5b73] text-white"
                      : "text-[#123447] hover:bg-[#f3f8fb]"
                  }`}
                >
                  Programa atual
                </button>
                <button
                  type="button"
                  onClick={() => setChronogramCalendarScope("all")}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    chronogramCalendarScope === "all"
                      ? "bg-[#0f5b73] text-white"
                      : "text-[#123447] hover:bg-[#f3f8fb]"
                  }`}
                >
                  Todos os programas
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {chronogramView === "list" ? (
          <>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setHidePastChronogramEvents((previous) => !previous)}
                className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
              >
                {hidePastChronogramEvents ? "Mostrar eventos passados" : "Esconder eventos passados"}
              </button>
            </div>
            {chronogramListEvents.length === 0 ? (
              <p className="text-xs text-[#5a7383]">Sem eventos no cronograma para este programa.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#d8e4ee]">
                <table className="nr-table min-w-full text-xs">
                  <thead className="bg-[#f3f8fb]">
                    <tr className="border-b border-[#d8e4ee]">
                      <th className="px-3 py-2 text-left font-semibold text-[#244354]">Data/hora</th>
                      <th className="px-3 py-2 text-left font-semibold text-[#244354]">Duracao</th>
                      <th className="px-3 py-2 text-left font-semibold text-[#244354]">Status</th>
                      <th className="px-3 py-2 text-left font-semibold text-[#244354]">Sessao atribuida</th>
                      <th className="px-3 py-2 text-left font-semibold text-[#244354]">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chronogramListEvents.map((event) => {
                      const timingDraft = eventTimingDraftById[event.id] ?? {
                        startsAt: toDatetimeLocal(event.startsAt),
                        durationMinutes: String(durationMinutesFromRange(event.startsAt, event.endsAt, 60)),
                      };
                      const eventRecordHref = `/manager/history/events/${event.id}?from=${eventRecordFrom}`;
                      const statusOption = chronogramStatusOptionFromEvent(event);
                      const isUpdatingStatus = updatingStatusEventId === event.id;
                      const isUpdatingTiming = updatingTimingEventId === event.id;
                      const isUpdatingLifecycle = updatingLifecycleEventId === event.id;
                      const isEditingTiming = editingTimingEventId === event.id;
                      const anyUpdatePending = isUpdatingStatus || isUpdatingTiming || isUpdatingLifecycle;
                      const normalizedSessionId =
                        typeof event.sessionId === "string" ? event.sessionId.trim() : "";
                      const sessionHref =
                        normalizedSessionId.length > 0
                          ? getAssignedSessionHref(
                              assignment.programId,
                              normalizedSessionId,
                              assignmentReturnTo,
                            )
                          : null;
                      const sessionLabel =
                        typeof event.sessionIndex === "number" && Number.isFinite(event.sessionIndex)
                          ? `Sessao ${event.sessionIndex}`
                          : "Sessao";
                      return (
                        <tr key={event.id} className={`border-b border-[#e2edf3] ${chronogramRowClassName(event)}`}>
                          <td className="px-3 py-2 text-[#123447]">
                            {isEditingTiming ? (
                              <input
                                type="datetime-local"
                                value={timingDraft.startsAt}
                                onChange={(inputEvent) =>
                                  setEventTimingDraftById((previous) => ({
                                    ...previous,
                                    [event.id]: {
                                      ...timingDraft,
                                      startsAt: inputEvent.target.value,
                                    },
                                  }))
                                }
                                disabled={event.status === "cancelled" || isUpdatingStatus || isUpdatingTiming}
                                className="w-full rounded border border-[#c9dce8] bg-white px-2 py-1 text-xs disabled:opacity-50"
                              />
                            ) : (
                              <Link
                                href={eventRecordHref}
                                className="text-xs font-semibold text-[#0f5b73] hover:underline"
                              >
                                {new Intl.DateTimeFormat("pt-BR", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                }).format(new Date(event.startsAt))}
                              </Link>
                            )}
                          </td>
                          <td className="px-3 py-2 text-[#123447]">
                            {isEditingTiming ? (
                              <input
                                type="number"
                                min={15}
                                max={24 * 60}
                                step={5}
                                value={timingDraft.durationMinutes}
                                onChange={(inputEvent) =>
                                  setEventTimingDraftById((previous) => ({
                                    ...previous,
                                    [event.id]: {
                                      ...timingDraft,
                                      durationMinutes: inputEvent.target.value,
                                    },
                                  }))
                                }
                                disabled={event.status === "cancelled" || isUpdatingStatus || isUpdatingTiming}
                                className="w-24 rounded border border-[#c9dce8] bg-white px-2 py-1 text-xs disabled:opacity-50"
                              />
                            ) : (
                              <Link
                                href={eventRecordHref}
                                className="text-xs font-semibold text-[#0f5b73] hover:underline"
                              >
                                {durationMinutesFromRange(event.startsAt, event.endsAt, 60)} min
                              </Link>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={statusOption}
                              onChange={(changeEvent) =>
                                void updateEventStatusOption(
                                  event,
                                  changeEvent.target.value as ChronogramStatusOption,
                                )
                              }
                              disabled={anyUpdatePending}
                              className="rounded border border-[#c9dce8] bg-white px-2 py-1 text-xs disabled:opacity-50"
                            >
                              <option value="Provisorio">Provisorio</option>
                              <option value="Marcado">Marcado</option>
                              <option value="Cancelado">Cancelado</option>
                              <option value="Executado">Executado</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            {sessionHref ? (
                              <Link
                                href={sessionHref}
                                className="text-xs font-semibold text-[#0f5b73] hover:underline"
                                title={event.sessionTitle ?? undefined}
                              >
                                {event.sessionTitle
                                  ? `${sessionLabel}: ${event.sessionTitle}`
                                  : sessionLabel}
                              </Link>
                            ) : (
                              <span className="text-xs text-[#6a818f]">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              {isEditingTiming ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const updated = await updateEventTiming(event);
                                      if (updated) {
                                        setEditingTimingEventId((current) =>
                                          current === event.id ? null : current,
                                        );
                                      }
                                    }}
                                    disabled={event.status === "cancelled" || anyUpdatePending}
                                    className="rounded-full border border-[#9ec8db] px-2 py-1 text-xs font-semibold text-[#0f5b73] disabled:opacity-50"
                                    title="Salvar horario"
                                    aria-label="Salvar horario"
                                  >
                                    <svg
                                      viewBox="0 0 20 20"
                                      width="14"
                                      height="14"
                                      fill="none"
                                      xmlns="http://www.w3.org/2000/svg"
                                    >
                                      <path
                                        d="M4 10.5L8 14.5L16 6.5"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingTimingEventId((current) =>
                                        current === event.id ? null : current,
                                      );
                                      setEventTimingDraftById((previous) => ({
                                        ...previous,
                                        [event.id]: {
                                          startsAt: toDatetimeLocal(event.startsAt),
                                          durationMinutes: String(
                                            durationMinutesFromRange(event.startsAt, event.endsAt, 60),
                                          ),
                                        },
                                      }));
                                    }}
                                    disabled={anyUpdatePending}
                                    className="rounded-full border border-[#d9c6c6] px-2 py-1 text-xs font-semibold text-[#6a3f3f] disabled:opacity-50"
                                    title="Cancelar edicao de horario"
                                    aria-label="Cancelar edicao de horario"
                                  >
                                    <svg
                                      viewBox="0 0 20 20"
                                      width="14"
                                      height="14"
                                      fill="none"
                                      xmlns="http://www.w3.org/2000/svg"
                                    >
                                      <path
                                        d="M5 5L15 15M15 5L5 15"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTimingEventId(event.id);
                                    setEventTimingDraftById((previous) => ({
                                      ...previous,
                                      [event.id]: {
                                        startsAt: toDatetimeLocal(event.startsAt),
                                        durationMinutes: String(
                                          durationMinutesFromRange(event.startsAt, event.endsAt, 60),
                                        ),
                                      },
                                    }));
                                  }}
                                  disabled={event.status === "cancelled" || anyUpdatePending}
                                  className="rounded-full border border-[#9ec8db] px-2 py-1 text-xs font-semibold text-[#0f5b73] disabled:opacity-50"
                                  title="Editar horario"
                                  aria-label="Editar horario"
                                >
                                  <svg
                                    viewBox="0 0 20 20"
                                    width="14"
                                    height="14"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                  >
                                    <path
                                      d="M12.8 4.2L15.8 7.2M6 14L4 16L6 16L13.9 8.1C14.3 7.7 14.3 7.1 13.9 6.7L13.3 6.1C12.9 5.7 12.3 5.7 11.9 6.1L4 14Z"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                              )}
                              <div className="relative inline-flex">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpenChronogramActionsFor((previous) =>
                                      previous === event.id ? null : event.id,
                                    )
                                  }
                                  className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447]"
                                >
                                  ...
                                </button>
                                {openChronogramActionsFor === event.id ? (
                                  <div className="absolute right-0 bottom-full z-20 mb-2 w-52 overflow-hidden rounded-xl border border-[#d8e4ee] bg-white shadow-lg">
                                    <Link
                                      href={eventRecordHref}
                                      onClick={() => setOpenChronogramActionsFor(null)}
                                      className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#0f5b73] hover:bg-[#f4f9fc]"
                                    >
                                      Event record
                                    </Link>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenChronogramActionsFor(null);
                                        void toggleEventLifecycle(event);
                                      }}
                                      disabled={event.status === "cancelled" || anyUpdatePending}
                                      className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#123447] hover:bg-[#f4f9fc] disabled:opacity-50"
                                    >
                                      {isUpdatingLifecycle
                                        ? "Atualizando..."
                                        : event.lifecycle === "committed"
                                          ? "Set provisory"
                                          : "Commit"}
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : visibleCalendarEvents.length === 0 ? (
          <p className="text-xs text-[#5a7383]">
            Sem eventos no calendario para o filtro selecionado.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-[#3d5a69]">
                {new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
                  chronogramMonth,
                )}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setChronogramMonth((previous) => new Date(previous.getFullYear(), previous.getMonth() - 1, 1))
                  }
                  className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                >
                  Mes anterior
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setChronogramMonth((previous) => new Date(previous.getFullYear(), previous.getMonth() + 1, 1))
                  }
                  className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                >
                  Proximo mes
                </button>
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#4f6977]">
              <span className="font-semibold">Legenda:</span>
              <span className="rounded-full bg-[#edf7fb] px-2 py-0.5 text-[#1f5f79]">Provisorio</span>
              <span className="rounded-full bg-[#2f6f8d] px-2 py-0.5 text-white">Commitado</span>
              <span className="rounded-full bg-[#f5f7f9] px-2 py-0.5 text-[#3f5462]">Outro programa</span>
            </div>
            <div className="mt-3 grid grid-cols-7 gap-2">
              {CHRONOGRAM_WEEK_DAYS.map((label) => (
                <p key={label} className="text-center text-xs font-semibold text-[#5e7d8d]">
                  {label}
                </p>
              ))}
              {calendarDays.map((day) => (
                <div
                  key={day.key}
                  className={`min-h-[145px] rounded-xl border p-2 ${
                    day.inMonth ? "border-[#d7e6ee] bg-white" : "border-[#edf3f7] bg-[#f8fbfd]"
                  }`}
                >
                  <p className={`text-xs font-semibold ${day.inMonth ? "text-[#163748]" : "text-[#86a0ac]"}`}>
                    {day.value.getDate()}
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {day.events.slice(0, CHRONOGRAM_MAX_EVENTS_PER_DAY).map((event) => {
                      const isCommitted = event.lifecycle === "committed";
                      const baseClass = event.isCurrentProgram
                        ? isCommitted
                          ? "border-[#2f6f8d] bg-[#2f6f8d] text-white"
                          : "border-[#b8d8e6] bg-[#edf7fb] text-[#1f5f79]"
                        : "border-[#d2dbe1] bg-[#f5f7f9] text-[#3f5462]";
                      return (
                        <Link
                          key={event.id}
                          href={`/manager/history/events/${event.id}?from=${eventRecordFrom}`}
                          className={`block rounded-md border px-1.5 py-1 ${baseClass}`}
                          title={`${event.programTitle} (${new Intl.DateTimeFormat("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          }).format(new Date(event.startsAt))})`}
                        >
                          <p className="truncate text-[10px] font-semibold">
                            {new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(
                              new Date(event.startsAt),
                            )}
                          </p>
                          <p className="truncate text-[10px] opacity-90">{event.programTitle}</p>
                          <p className="truncate text-[10px] opacity-90">
                            {event.isCurrentProgram ? "Programa atual" : "Outro programa"}
                          </p>
                        </Link>
                      );
                    })}
                    {day.events.length > CHRONOGRAM_MAX_EVENTS_PER_DAY ? (
                      <p className="text-[10px] text-[#527083]">
                        +{day.events.length - CHRONOGRAM_MAX_EVENTS_PER_DAY} evento(s)
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
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
