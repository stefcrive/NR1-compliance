"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { type EventRecordAttachment, EVENT_RECORD_FILE_ACCEPT_ATTR } from "@/lib/event-record-journal";

import { type ManagerLocale, useManagerLocale } from "@/components/manager-locale";

type EventEditStatusOption = "provisorio" | "marcado" | "cancelado" | "esecutado";

type EventRecordPayload = {
  record: {
    id: string;
    recordType: "calendar" | "drps";
    eventType: "drps_start" | "drps_close" | "continuous_meeting" | "blocked";
    title: string;
    status: "scheduled" | "completed" | "cancelled";
    startsAt: string;
    endsAt: string;
    clientId: string | null;
    clientName: string | null;
    clientPortalSlug: string | null;
    sourceClientProgramId: string | null;
    sourceCampaignId: string | null;
    details: {
      content: string | null;
      preparationRequired: string | null;
      eventLifecycle: "provisory" | "committed";
      proposalKind: "assignment" | "reschedule" | null;
      availabilityRequestId: string | null;
      sessionId?: string | null;
      sessionIndex?: number | null;
      sessionTitle?: string | null;
      sessionMaterials?: Array<{
        id: string;
        title: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        uploadedAt: string;
        storagePath: string;
        downloadUrl: string;
      }>;
    };
    journal: {
      notes: string | null;
      attachments: EventRecordAttachment[];
      available: boolean;
    };
    related: {
      campaign: {
        id: string;
        name: string;
        publicSlug: string | null;
        status: string;
        startsAt: string | null;
        closesAt: string | null;
      } | null;
      programAssignment: {
        id: string;
        clientId: string;
        programId: string;
        programTitle: string;
        status: "Recommended" | "Active" | "Completed";
        deployedAt: string | null;
      } | null;
    };
    diagnostics: {
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
      drpsUnavailable: boolean;
    } | null;
  };
};

const COPY = {
  en: {
    breadcrumbHistory: "History",
    breadcrumbHome: "Home",
    breadcrumbClientArea: "Client area",
    breadcrumbAssignedPrograms: "Assigned processo continuos",
    pageTitle: "Event Record",
    journalTitle: "Journal",
    loading: "Loading event record...",
    loadError: "Could not load event record.",
    eventType: "Type",
    eventStatus: "Status",
    eventWhen: "When",
    eventDuration: "Duration",
    eventCompany: "Company",
    eventLifecycle: "Lifecycle",
    eventProposal: "Proposal",
    eventSession: "Session",
    eventContent: "Content",
    eventPreparation: "Preparation",
    eventSessionMaterials: "Session materials",
    eventTitle: "Title",
    eventEdit: "Edit event",
    eventEditCancel: "Cancel edit",
    eventSave: "Save event fields",
    eventSaving: "Saving event...",
    eventSaved: "Event updated.",
    eventSaveError: "Could not update event fields.",
    eventInvalidTime: "Invalid date/time or duration.",
    eventNoText: "No details registered.",
    eventNoSessionMaterials: "No session materials linked.",
    diagnosticsTitle: "Diagnostic Snapshot",
    diagnosticsResponses: "Responses",
    diagnosticsLatestResponse: "Latest response",
    diagnosticsResult: "Latest DRPS result",
    diagnosticsUnavailable: "DRPS result snapshots are unavailable.",
    relatedTitle: "Related records",
    relatedCampaign: "Diagnostic",
    relatedProgram: "Assigned program",
    openCampaign: "Open DRPS",
    openProgram: "Open program",
    noCompany: "No company",
    noRelated: "No related records.",
    eventTypeDrpsStart: "DRPS start",
    eventTypeDrpsClose: "DRPS close",
    eventTypeMeeting: "Continuous meeting",
    eventTypeBlocked: "Blocked time",
    statusScheduled: "Scheduled",
    statusCompleted: "Completed",
    statusCancelled: "Cancelled",
    lifecycleCommitted: "Committed",
    lifecycleProvisory: "Provisory",
    proposalAssignment: "Cadence assignment",
    proposalReschedule: "Reschedule request",
    proposalNone: "No proposal",
    probabilityLow: "Low",
    probabilityMedium: "Medium",
    probabilityHigh: "High",
    eventInheritedFromSession: "Inherited from session record.",
    openSessionRecord: "Open session record",
    eventNoSessionRecord: "No linked session record.",
    journalSectionTitle: "Event notes and files",
    journalNotesLabel: "Notes",
    journalNotesPlaceholder: "Add notes about this event.",
    journalSave: "Save notes",
    journalSaving: "Saving...",
    journalSaved: "Journal saved.",
    journalSaveError: "Could not save notes.",
    journalUpload: "Upload file",
    journalUploading: "Uploading...",
    journalUploadDone: "File uploaded.",
    journalUploadError: "Could not upload file.",
    journalDelete: "Delete",
    journalDeleting: "Deleting...",
    journalDeleteError: "Could not delete file.",
    journalNoFiles: "No files uploaded yet.",
    journalUnavailable:
      "Journal storage is unavailable. Apply migration 20260304210000_history_event_records.sql.",
    openAttachment: "Open file",
  },
  pt: {
    breadcrumbHistory: "Historico",
    breadcrumbHome: "Home",
    breadcrumbClientArea: "Client area",
    breadcrumbAssignedPrograms: "Assigned processo continuos",
    pageTitle: "Ficha do Evento",
    journalTitle: "Journal",
    loading: "Carregando ficha do evento...",
    loadError: "Nao foi possivel carregar a ficha do evento.",
    eventType: "Tipo",
    eventStatus: "Status",
    eventWhen: "Quando",
    eventDuration: "Duracao",
    eventCompany: "Empresa",
    eventLifecycle: "Ciclo",
    eventProposal: "Proposta",
    eventSession: "Sessao",
    eventContent: "Conteudo",
    eventPreparation: "Preparacao",
    eventSessionMaterials: "Materiais da sessao",
    eventTitle: "Titulo",
    eventEdit: "Editar evento",
    eventEditCancel: "Cancelar edicao",
    eventSave: "Salvar campos do evento",
    eventSaving: "Salvando evento...",
    eventSaved: "Evento atualizado.",
    eventSaveError: "Nao foi possivel atualizar os campos do evento.",
    eventInvalidTime: "Data/hora ou duracao invalida.",
    eventNoText: "Sem detalhes cadastrados.",
    eventNoSessionMaterials: "Sem materiais associados a sessao.",
    diagnosticsTitle: "Snapshot Diagnostico",
    diagnosticsResponses: "Respostas",
    diagnosticsLatestResponse: "Ultima resposta",
    diagnosticsResult: "Ultimo resultado DRPS",
    diagnosticsUnavailable: "Snapshots DRPS indisponiveis.",
    relatedTitle: "Registros relacionados",
    relatedCampaign: "Diagnostico",
    relatedProgram: "Programa atribuido",
    openCampaign: "Abrir DRPS",
    openProgram: "Abrir programa",
    noCompany: "Sem empresa",
    noRelated: "Sem registros relacionados.",
    eventTypeDrpsStart: "Inicio DRPS",
    eventTypeDrpsClose: "Fechamento DRPS",
    eventTypeMeeting: "Reuniao continua",
    eventTypeBlocked: "Bloqueio",
    statusScheduled: "Agendado",
    statusCompleted: "Concluido",
    statusCancelled: "Cancelado",
    lifecycleCommitted: "Commitado",
    lifecycleProvisory: "Provisorio",
    proposalAssignment: "Atribuicao de cadencia",
    proposalReschedule: "Pedido de reagendamento",
    proposalNone: "Sem proposta",
    probabilityLow: "Baixa",
    probabilityMedium: "Media",
    probabilityHigh: "Alta",
    eventInheritedFromSession: "Herdado do registro da sessao.",
    openSessionRecord: "Abrir registro da sessao",
    eventNoSessionRecord: "Sem registro de sessao vinculado.",
    journalSectionTitle: "Notas e arquivos do evento",
    journalNotesLabel: "Notas",
    journalNotesPlaceholder: "Adicione anotacoes sobre este evento.",
    journalSave: "Salvar notas",
    journalSaving: "Salvando...",
    journalSaved: "Diario salvo.",
    journalSaveError: "Nao foi possivel salvar as notas.",
    journalUpload: "Enviar arquivo",
    journalUploading: "Enviando...",
    journalUploadDone: "Arquivo enviado.",
    journalUploadError: "Nao foi possivel enviar arquivo.",
    journalDelete: "Remover",
    journalDeleting: "Removendo...",
    journalDeleteError: "Nao foi possivel remover arquivo.",
    journalNoFiles: "Nenhum arquivo enviado ainda.",
    journalUnavailable:
      "Armazenamento do diario indisponivel. Aplique a migration 20260304210000_history_event_records.sql.",
    openAttachment: "Abrir arquivo",
  },
} as const;

function uiLocale(locale: ManagerLocale) {
  return locale === "pt" ? "pt-BR" : "en-US";
}

function fmtDateTime(value: string | null | undefined, locale: ManagerLocale) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(uiLocale(locale), { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

function eventTypeLabel(
  value: "drps_start" | "drps_close" | "continuous_meeting" | "blocked",
  locale: ManagerLocale,
) {
  const t = COPY[locale];
  if (value === "drps_start") return t.eventTypeDrpsStart;
  if (value === "drps_close") return t.eventTypeDrpsClose;
  if (value === "continuous_meeting") return t.eventTypeMeeting;
  return t.eventTypeBlocked;
}

function eventStatusLabel(
  value: "scheduled" | "completed" | "cancelled",
  locale: ManagerLocale,
) {
  const t = COPY[locale];
  if (value === "scheduled") return t.statusScheduled;
  if (value === "completed") return t.statusCompleted;
  return t.statusCancelled;
}

function lifecycleLabel(value: "provisory" | "committed", locale: ManagerLocale) {
  return value === "committed" ? COPY[locale].lifecycleCommitted : COPY[locale].lifecycleProvisory;
}

function eventEditStatusFromRecord(record: EventRecordPayload["record"]): EventEditStatusOption {
  if (record.status === "cancelled") return "cancelado";
  if (record.status === "completed") return "esecutado";
  if (record.details.eventLifecycle === "provisory") return "provisorio";
  return "marcado";
}

function proposalLabel(value: "assignment" | "reschedule" | null, locale: ManagerLocale) {
  const t = COPY[locale];
  if (value === "assignment") return t.proposalAssignment;
  if (value === "reschedule") return t.proposalReschedule;
  return t.proposalNone;
}

function sessionLabel(
  details: EventRecordPayload["record"]["details"],
  locale: ManagerLocale,
) {
  const index = details.sessionIndex;
  const title = details.sessionTitle?.trim() ?? "";
  if (typeof index === "number" && index > 0 && title.length > 0) {
    return `${COPY[locale].eventSession} ${index}: ${title}`;
  }
  if (typeof index === "number" && index > 0) {
    return `${COPY[locale].eventSession} ${index}`;
  }
  if (title.length > 0) return title;
  return "-";
}

function buildSessionRecordHref(params: {
  sessionId: string | null | undefined;
  programId: string | null | undefined;
  returnTo: string;
}): string | null {
  const sessionId = params.sessionId?.trim() ?? "";
  if (!sessionId) return null;
  const returnToParam = `returnTo=${encodeURIComponent(params.returnTo)}`;
  if (sessionId.startsWith("library-")) {
    const libraryId = sessionId.slice("library-".length).trim();
    if (!libraryId) return null;
    return `/manager/programs/sessions/library/${encodeURIComponent(libraryId)}?${returnToParam}`;
  }
  const programId = params.programId?.trim() ?? "";
  if (!programId) return null;
  return `/manager/programs/sessions/program/${encodeURIComponent(programId)}/${encodeURIComponent(
    sessionId,
  )}?${returnToParam}`;
}

function probabilityLabel(value: "low" | "medium" | "high", locale: ManagerLocale) {
  const t = COPY[locale];
  if (value === "low") return t.probabilityLow;
  if (value === "medium") return t.probabilityMedium;
  return t.probabilityHigh;
}

function durationMinutes(startsAt: string, endsAt: string) {
  const starts = new Date(startsAt).getTime();
  const ends = new Date(endsAt).getTime();
  if (!Number.isFinite(starts) || !Number.isFinite(ends)) return "-";
  const duration = Math.max(0, Math.round((ends - starts) / (60 * 1000)));
  return `${duration} min`;
}

function formatFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 B";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function toDatetimeLocalFromIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function toIsoFromDatetimeLocal(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function durationMinutesFromRange(startsAt: string, endsAt: string, fallbackMinutes = 60) {
  const starts = new Date(startsAt).getTime();
  const ends = new Date(endsAt).getTime();
  if (!Number.isFinite(starts) || !Number.isFinite(ends)) return fallbackMinutes;
  const duration = Math.round((ends - starts) / (60 * 1000));
  if (!Number.isFinite(duration) || duration <= 0) return fallbackMinutes;
  return duration;
}

export function ManagerHistoryEventRecord({
  eventId,
  from,
}: {
  eventId: string;
  from?: string;
}) {
  const { locale } = useManagerLocale();
  const t = COPY[locale];

  const [payload, setPayload] = useState<EventRecordPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [journalNotice, setJournalNotice] = useState("");
  const [journalError, setJournalError] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [removingAttachmentId, setRemovingAttachmentId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [eventNotice, setEventNotice] = useState("");
  const [eventError, setEventError] = useState("");
  const [isSavingEvent, setIsSavingEvent] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editStartsAt, setEditStartsAt] = useState("");
  const [editDurationMinutes, setEditDurationMinutes] = useState("60");
  const [editEventStatus, setEditEventStatus] = useState<EventEditStatusOption>("marcado");
  const [editProposal, setEditProposal] = useState<"assignment" | "reschedule" | "none">("none");

  const loadRecord = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/history/events/${encodeURIComponent(eventId)}`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as EventRecordPayload & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? t.loadError);
      }
      setPayload(body);
      setNotesDraft(body.record.journal.notes ?? "");
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : t.loadError);
    } finally {
      setLoading(false);
    }
  }, [eventId, t.loadError]);

  useEffect(() => {
    void loadRecord();
  }, [loadRecord]);

  const record = payload?.record ?? null;
  const hasRelated = useMemo(
    () => Boolean(record?.related.campaign || record?.related.programAssignment),
    [record?.related.campaign, record?.related.programAssignment],
  );
  const isContinuousProgramJournal = Boolean(
    record &&
      record.recordType === "calendar" &&
      record.eventType === "continuous_meeting" &&
      record.related.programAssignment,
  );
  const programAssignment = record?.related.programAssignment ?? null;
  const programAssignmentId = programAssignment?.id ?? null;
  const programAssignmentTitle = programAssignment?.programTitle ?? null;
  const breadcrumbClientId = programAssignment?.clientId ?? record?.clientId ?? null;
  const breadcrumbClientName = record?.clientName ?? t.noCompany;
  const fromHistory = from === "history";
  const fromHome = from === "home";
  const breadcrumbSource = fromHistory ? "history" : fromHome ? "home" : null;
  const isClientAreaSource = !fromHistory && !fromHome;
  const pageTitle =
    isContinuousProgramJournal && record
      ? `${record.title || t.journalTitle} (${fmtDateTime(record.startsAt, locale)})`
      : t.pageTitle;
  const isCalendarRecord = record?.recordType === "calendar";
  const eventRecordHref = useMemo(() => {
    const base = `/manager/history/events/${encodeURIComponent(eventId)}`;
    const query = new URLSearchParams();
    if (from) {
      query.set("from", from);
    }
    if (isClientAreaSource && breadcrumbClientId && programAssignmentId) {
      query.set("ctx", "client-area");
      query.set("clientId", breadcrumbClientId);
      query.set("clientName", breadcrumbClientName);
      query.set("assignmentId", programAssignmentId);
      if (programAssignmentTitle) {
        query.set("assignmentTitle", programAssignmentTitle);
      }
      query.set("eventTitle", pageTitle);
    }
    const encoded = query.toString();
    return encoded.length > 0 ? `${base}?${encoded}` : base;
  }, [
    breadcrumbClientId,
    breadcrumbClientName,
    eventId,
    from,
    isClientAreaSource,
    pageTitle,
    programAssignmentId,
    programAssignmentTitle,
  ]);
  const sessionRecordHref = useMemo(
    () =>
      buildSessionRecordHref({
        sessionId: record?.details.sessionId ?? null,
        programId: record?.related.programAssignment?.programId ?? null,
        returnTo: eventRecordHref,
      }),
    [
      eventRecordHref,
      record?.details.sessionId,
      record?.related.programAssignment?.programId,
    ],
  );

  useEffect(() => {
    if (!record) return;
    setEditTitle(record.title);
    setEditStartsAt(toDatetimeLocalFromIso(record.startsAt));
    setEditDurationMinutes(String(durationMinutesFromRange(record.startsAt, record.endsAt, 60)));
    setEditEventStatus(eventEditStatusFromRecord(record));
    setEditProposal(record.details.proposalKind ?? "none");
    setIsEditMode(false);
    setEventNotice("");
    setEventError("");
  }, [
    record,
    record?.id,
    record?.title,
    record?.status,
    record?.startsAt,
    record?.endsAt,
    record?.details.eventLifecycle,
    record?.details.proposalKind,
  ]);

  const applyJournalState = useCallback(
    (journal: EventRecordPayload["record"]["journal"]) => {
      setPayload((previous) =>
        previous
          ? {
              ...previous,
              record: {
                ...previous.record,
                journal,
              },
            }
          : previous,
      );
      setNotesDraft(journal.notes ?? "");
    },
    [],
  );

  const saveJournalNotes = useCallback(async () => {
    if (!record || !record.journal.available) return;
    setIsSavingNotes(true);
    setJournalNotice("");
    setJournalError("");
    try {
      const response = await fetch(`/api/admin/history/events/${encodeURIComponent(record.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesDraft.trim() || null }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        journal?: EventRecordPayload["record"]["journal"];
      };
      if (!response.ok || !body.journal) {
        throw new Error(body.error ?? t.journalSaveError);
      }
      applyJournalState(body.journal);
      setJournalNotice(t.journalSaved);
    } catch (saveError) {
      setJournalError(saveError instanceof Error ? saveError.message : t.journalSaveError);
    } finally {
      setIsSavingNotes(false);
    }
  }, [applyJournalState, notesDraft, record, t.journalSaveError, t.journalSaved]);

  const uploadAttachment = useCallback(
    async (files: FileList | null) => {
      if (!record || !record.journal.available || !files || files.length === 0) return;
      const file = files[0];
      setIsUploadingAttachment(true);
      setJournalNotice("");
      setJournalError("");
      try {
        const formData = new FormData();
        formData.set("file", file);
        const response = await fetch(`/api/admin/history/events/${encodeURIComponent(record.id)}`, {
          method: "POST",
          body: formData,
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          journal?: EventRecordPayload["record"]["journal"];
        };
        if (!response.ok || !body.journal) {
          throw new Error(body.error ?? t.journalUploadError);
        }
        applyJournalState(body.journal);
        setJournalNotice(t.journalUploadDone);
      } catch (uploadError) {
        setJournalError(uploadError instanceof Error ? uploadError.message : t.journalUploadError);
      } finally {
        setIsUploadingAttachment(false);
      }
    },
    [applyJournalState, record, t.journalUploadDone, t.journalUploadError],
  );

  const deleteAttachment = useCallback(
    async (attachmentId: string) => {
      if (!record || !record.journal.available) return;
      setRemovingAttachmentId(attachmentId);
      setJournalNotice("");
      setJournalError("");
      try {
        const response = await fetch(`/api/admin/history/events/${encodeURIComponent(record.id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attachmentId }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          journal?: EventRecordPayload["record"]["journal"];
        };
        if (!response.ok || !body.journal) {
          throw new Error(body.error ?? t.journalDeleteError);
        }
        applyJournalState(body.journal);
      } catch (deleteError) {
        setJournalError(deleteError instanceof Error ? deleteError.message : t.journalDeleteError);
      } finally {
        setRemovingAttachmentId((current) => (current === attachmentId ? null : current));
      }
    },
    [applyJournalState, record, t.journalDeleteError],
  );

  const cancelEditMode = useCallback(() => {
    if (!record) return;
    setIsEditMode(false);
    setEditTitle(record.title);
    setEditStartsAt(toDatetimeLocalFromIso(record.startsAt));
    setEditDurationMinutes(String(durationMinutesFromRange(record.startsAt, record.endsAt, 60)));
    setEditEventStatus(eventEditStatusFromRecord(record));
    setEditProposal(record.details.proposalKind ?? "none");
    setEventNotice("");
    setEventError("");
  }, [record]);

  const saveEventFields = useCallback(async () => {
    if (!record || !isCalendarRecord) return;

    const normalizedTitle = editTitle.trim();
    if (normalizedTitle.length < 3) {
      setEventError(t.eventSaveError);
      setEventNotice("");
      return;
    }

    const startsAtIso = toIsoFromDatetimeLocal(editStartsAt);
    const duration = Number(editDurationMinutes);
    if (!startsAtIso || !Number.isFinite(duration) || duration <= 0) {
      setEventError(t.eventInvalidTime);
      setEventNotice("");
      return;
    }
    const endsAtIso = new Date(new Date(startsAtIso).getTime() + Math.round(duration) * 60 * 1000).toISOString();
    if (new Date(endsAtIso).getTime() <= new Date(startsAtIso).getTime()) {
      setEventError(t.eventInvalidTime);
      setEventNotice("");
      return;
    }

    setIsSavingEvent(true);
    setEventNotice("");
    setEventError("");
    try {
      const nextStatus: "scheduled" | "completed" | "cancelled" =
        editEventStatus === "cancelado"
          ? "cancelled"
          : editEventStatus === "esecutado"
            ? "completed"
            : "scheduled";
      const nextLifecycle: "provisory" | "committed" =
        editEventStatus === "provisorio" ? "provisory" : "committed";
      const response = await fetch(`/api/admin/history/events/${encodeURIComponent(record.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: {
            title: normalizedTitle,
            status: nextStatus,
            startsAt: startsAtIso,
            endsAt: endsAtIso,
            eventLifecycle: nextLifecycle,
            proposalKind: editProposal === "none" ? null : editProposal,
          },
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? t.eventSaveError);
      }
      setEventNotice(t.eventSaved);
      setIsEditMode(false);
      await loadRecord();
    } catch (saveError) {
      setEventError(saveError instanceof Error ? saveError.message : t.eventSaveError);
    } finally {
      setIsSavingEvent(false);
    }
  }, [
    editDurationMinutes,
    editEventStatus,
    editProposal,
    editStartsAt,
    editTitle,
    isCalendarRecord,
    loadRecord,
    record,
    t.eventInvalidTime,
    t.eventSaveError,
    t.eventSaved,
  ]);

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <nav className="text-xs text-[#4f6977]">
          {fromHistory ? (
            <>
              <Link href="/manager/history" className="text-[#0f5b73] hover:underline">
                {t.breadcrumbHistory}
              </Link>{" "}
              / <span>{pageTitle}</span>
            </>
          ) : fromHome ? (
            <>
              <Link href="/manager" className="text-[#0f5b73] hover:underline">
                {t.breadcrumbHome}
              </Link>{" "}
              / <span>{pageTitle}</span>
            </>
          ) : isClientAreaSource && isContinuousProgramJournal && breadcrumbClientId && programAssignment ? (
            <>
              <Link href="/manager/clients" className="text-[#0f5b73] hover:underline">
                {t.breadcrumbClientArea}
              </Link>{" "}
              /{" "}
              <Link
                href={`/manager/clients/${breadcrumbClientId}`}
                className="text-[#0f5b73] hover:underline"
              >
                {breadcrumbClientName}
              </Link>{" "}
              /{" "}
              <Link
                href={`/manager/clients/${breadcrumbClientId}?tab=assigned-continuous`}
                className="text-[#0f5b73] hover:underline"
              >
                {t.breadcrumbAssignedPrograms}
              </Link>{" "}
              /{" "}
              <Link
                href={`/manager/clients/${breadcrumbClientId}/assigned-continuous/${programAssignment.id}`}
                className="text-[#0f5b73] hover:underline"
              >
                {programAssignment.programTitle}
              </Link>{" "}
              / <span>{pageTitle}</span>
            </>
          ) : (
            <>
              <Link href="/manager/history" className="text-[#0f5b73] hover:underline">
                {t.breadcrumbHistory}
              </Link>{" "}
              / <span>{pageTitle}</span>
            </>
          )}
        </nav>
        <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <h2 className="text-2xl font-semibold text-[#121b22]">{pageTitle}</h2>
          {record ? <p className="mt-1 text-sm text-[#4f5f6a]">{record.title}</p> : null}
          {record && isCalendarRecord ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isEditMode) {
                    cancelEditMode();
                    return;
                  }
                  setEventNotice("");
                  setEventError("");
                  setIsEditMode(true);
                }}
                className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
              >
                {isEditMode ? t.eventEditCancel : t.eventEdit}
              </button>
              {isEditMode ? (
                <button
                  type="button"
                  onClick={() => void saveEventFields()}
                  disabled={
                    isSavingEvent || isSavingNotes || isUploadingAttachment || removingAttachmentId !== null
                  }
                  className="rounded-full bg-[#123447] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {isSavingEvent ? t.eventSaving : t.eventSave}
                </button>
              ) : null}
            </div>
          ) : null}
          {eventNotice ? <p className="mt-2 text-xs text-[#365160]">{eventNotice}</p> : null}
          {eventError ? <p className="mt-2 text-xs text-red-600">{eventError}</p> : null}
          {loading ? <p className="mt-3 text-sm text-[#4f5f6a]">{t.loading}</p> : null}
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </section>
      </div>

      {record ? (
        <>
          <section className="grid gap-3 rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm md:grid-cols-2 xl:grid-cols-3">
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3 xl:col-span-3">
              <p className="text-xs text-[#4f6977]">{t.eventTitle}</p>
              {isEditMode && isCalendarRecord ? (
                <input
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-2 py-1.5 text-sm text-[#123447]"
                />
              ) : (
                <p className="mt-1 text-sm font-semibold text-[#123447]">{record.title}</p>
              )}
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">{t.eventType}</p>
              <p className="text-sm font-semibold text-[#123447]">{eventTypeLabel(record.eventType, locale)}</p>
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">{t.eventStatus}</p>
              <p className="text-sm font-semibold text-[#123447]">{eventStatusLabel(record.status, locale)}</p>
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">{t.eventWhen}</p>
              {isEditMode && isCalendarRecord ? (
                <input
                  type="datetime-local"
                  value={editStartsAt}
                  onChange={(event) => setEditStartsAt(event.target.value)}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-2 py-1.5 text-sm text-[#123447]"
                />
              ) : (
                <p className="text-sm font-semibold text-[#123447]">{fmtDateTime(record.startsAt, locale)}</p>
              )}
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">{t.eventDuration}</p>
              {isEditMode && isCalendarRecord ? (
                <input
                  type="number"
                  min={1}
                  step={5}
                  value={editDurationMinutes}
                  onChange={(event) => setEditDurationMinutes(event.target.value)}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-2 py-1.5 text-sm text-[#123447]"
                />
              ) : (
                <p className="text-sm font-semibold text-[#123447]">
                  {durationMinutes(record.startsAt, record.endsAt)}
                </p>
              )}
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">{t.eventCompany}</p>
              <p className="text-sm font-semibold text-[#123447]">{record.clientName ?? t.noCompany}</p>
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">{t.eventStatus}</p>
              {isEditMode && isCalendarRecord ? (
                <select
                  value={editEventStatus}
                  onChange={(event) => setEditEventStatus(event.target.value as EventEditStatusOption)}
                  className="mt-1 w-full rounded border border-[#c9dce8] px-2 py-1.5 text-sm text-[#123447]"
                >
                  <option value="provisorio">provisorio</option>
                  <option value="marcado">marcado</option>
                  <option value="cancelado">cancelado</option>
                  <option value="esecutado">esecutado</option>
                </select>
              ) : (
                <p className="text-sm font-semibold text-[#123447]">
                  {lifecycleLabel(record.details.eventLifecycle, locale)}
                </p>
              )}
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3 xl:col-span-3">
              <p className="text-xs text-[#4f6977]">{t.eventProposal}</p>
              {isEditMode && isCalendarRecord ? (
                <select
                  value={editProposal}
                  onChange={(event) =>
                    setEditProposal(event.target.value as "assignment" | "reschedule" | "none")
                  }
                  className="mt-1 w-full rounded border border-[#c9dce8] px-2 py-1.5 text-sm text-[#123447]"
                >
                  <option value="none">{t.proposalNone}</option>
                  <option value="assignment">{t.proposalAssignment}</option>
                  <option value="reschedule">{t.proposalReschedule}</option>
                </select>
              ) : (
                <p className="text-sm font-semibold text-[#123447]">
                  {proposalLabel(record.details.proposalKind, locale)}
                </p>
              )}
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3 xl:col-span-3">
              <p className="text-xs text-[#4f6977]">{t.eventSession}</p>
              <p className="text-sm font-semibold text-[#123447]">
                {sessionLabel(record.details, locale)}
              </p>
              {sessionRecordHref ? (
                <Link
                  href={sessionRecordHref}
                  className="mt-2 inline-flex text-xs font-semibold text-[#0f5b73] hover:underline"
                >
                  {t.openSessionRecord}
                </Link>
              ) : (
                <p className="mt-2 text-xs text-[#4f6977]">{t.eventNoSessionRecord}</p>
              )}
            </article>
          </section>

          <section className="grid gap-3 rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm md:grid-cols-2">
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">{t.eventContent}</p>
              <p className="mt-1 text-sm text-[#123447]">{record.details.content ?? t.eventNoText}</p>
              <p className="mt-2 text-xs text-[#4f6977]">{t.eventInheritedFromSession}</p>
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
              <p className="text-xs text-[#4f6977]">{t.eventPreparation}</p>
              <p className="mt-1 text-sm text-[#123447]">
                {record.details.preparationRequired ?? t.eventNoText}
              </p>
              <p className="mt-2 text-xs text-[#4f6977]">{t.eventInheritedFromSession}</p>
            </article>
            <article className="rounded-xl border border-[#d8e4ee] bg-white p-3 md:col-span-2">
              <p className="text-xs text-[#4f6977]">{t.eventSessionMaterials}</p>
              {(record.details.sessionMaterials ?? []).length === 0 ? (
                <p className="mt-1 text-sm text-[#123447]">{t.eventNoSessionMaterials}</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {(record.details.sessionMaterials ?? []).map((material) => (
                    <div
                      key={material.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e3edf3] p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[#123447]">{material.title}</p>
                        <p className="truncate text-xs text-[#4f6977]">
                          {material.fileName} | {formatFileSize(material.sizeBytes)}
                        </p>
                      </div>
                      <a
                        href={material.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                      >
                        {t.openAttachment}
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </section>

          <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
            <h3 className="text-base font-semibold text-[#123447]">{t.journalSectionTitle}</h3>
            {!record.journal.available ? (
              <p className="mt-3 text-sm text-[#4f6977]">{t.journalUnavailable}</p>
            ) : (
              <div className="mt-3 space-y-3">
                <label className="block">
                  <span className="text-xs text-[#4f6977]">{t.journalNotesLabel}</span>
                  <textarea
                    rows={4}
                    value={notesDraft}
                    onChange={(event) => setNotesDraft(event.target.value)}
                    placeholder={t.journalNotesPlaceholder}
                    disabled={isSavingEvent}
                    className="mt-1 w-full rounded-xl border border-[#c9dce8] px-3 py-2 text-sm"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void saveJournalNotes()}
                    disabled={
                      isSavingNotes ||
                      isUploadingAttachment ||
                      removingAttachmentId !== null ||
                      isSavingEvent
                    }
                    className="rounded-full bg-[#123447] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {isSavingNotes ? t.journalSaving : t.journalSave}
                  </button>
                  <label className="cursor-pointer rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]">
                    {isUploadingAttachment ? t.journalUploading : t.journalUpload}
                    <input
                      type="file"
                      accept={EVENT_RECORD_FILE_ACCEPT_ATTR}
                      className="hidden"
                      onChange={(event) => {
                        void uploadAttachment(event.target.files);
                        event.target.value = "";
                      }}
                      disabled={
                        isUploadingAttachment ||
                        isSavingNotes ||
                        removingAttachmentId !== null ||
                        isSavingEvent
                      }
                    />
                  </label>
                </div>

                {journalNotice ? <p className="text-xs text-[#365160]">{journalNotice}</p> : null}
                {journalError ? <p className="text-xs text-red-600">{journalError}</p> : null}

                {record.journal.attachments.length === 0 ? (
                  <p className="text-xs text-[#4f6977]">{t.journalNoFiles}</p>
                ) : (
                  <div className="space-y-2">
                    {record.journal.attachments.map((attachment) => (
                      <article
                        key={attachment.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d8e4ee] bg-white p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-[#123447]">{attachment.title}</p>
                          <p className="truncate text-xs text-[#4f6977]">
                            {attachment.fileName} | {formatFileSize(attachment.sizeBytes)} |{" "}
                            {fmtDateTime(attachment.uploadedAt, locale)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <a
                            href={attachment.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                          >
                            {t.openAttachment}
                          </a>
                          <button
                            type="button"
                            onClick={() => void deleteAttachment(attachment.id)}
                            disabled={
                              isSavingNotes ||
                              isUploadingAttachment ||
                              removingAttachmentId === attachment.id ||
                              isSavingEvent
                            }
                            className="rounded-full border border-[#9d304e] px-3 py-1 text-xs font-semibold text-[#9d304e] disabled:opacity-50"
                          >
                            {removingAttachmentId === attachment.id ? t.journalDeleting : t.journalDelete}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
            <h3 className="text-base font-semibold text-[#123447]">{t.relatedTitle}</h3>
            {!hasRelated ? (
              <p className="mt-3 text-sm text-[#4f6977]">{t.noRelated}</p>
            ) : (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {record.related.campaign ? (
                  <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
                    <p className="text-xs text-[#4f6977]">{t.relatedCampaign}</p>
                    <p className="mt-1 text-sm font-semibold text-[#123447]">{record.related.campaign.name}</p>
                    <p className="mt-1 text-xs text-[#4f6977]">{record.related.campaign.status}</p>
                    <Link
                      href={
                        record.clientId
                          ? `/manager/clients/${record.clientId}/diagnostic/${record.related.campaign.id}${
                              breadcrumbSource ? `?from=${breadcrumbSource}` : ""
                            }`
                          : `/manager/programs/drps/${record.related.campaign.id}`
                      }
                      className="mt-2 inline-flex text-xs font-semibold text-[#0f5b73] hover:underline"
                    >
                      {t.openCampaign}
                    </Link>
                  </article>
                ) : null}
                {record.related.programAssignment ? (
                  <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
                    <p className="text-xs text-[#4f6977]">{t.relatedProgram}</p>
                    <p className="mt-1 text-sm font-semibold text-[#123447]">
                      {record.related.programAssignment.programTitle}
                    </p>
                    <p className="mt-1 text-xs text-[#4f6977]">
                      {record.related.programAssignment.status} |{" "}
                      {fmtDateTime(record.related.programAssignment.deployedAt, locale)}
                    </p>
                    <Link
                      href={`/manager/clients/${record.related.programAssignment.clientId}/assigned-continuous/${record.related.programAssignment.id}${
                        breadcrumbSource ? `?from=${breadcrumbSource}` : ""
                      }`}
                      className="mt-2 inline-flex text-xs font-semibold text-[#0f5b73] hover:underline"
                    >
                      {t.openProgram}
                    </Link>
                  </article>
                ) : null}
              </div>
            )}
          </section>

          {record.diagnostics ? (
            <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
              <h3 className="text-base font-semibold text-[#123447]">{t.diagnosticsTitle}</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
                  <p className="text-xs text-[#4f6977]">{t.diagnosticsResponses}</p>
                  <p className="text-sm font-semibold text-[#123447]">{record.diagnostics.responseCount}</p>
                </article>
                <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
                  <p className="text-xs text-[#4f6977]">{t.diagnosticsLatestResponse}</p>
                  <p className="text-sm font-semibold text-[#123447]">
                    {fmtDateTime(record.diagnostics.latestResponseAt, locale)}
                  </p>
                </article>
                <article className="rounded-xl border border-[#d8e4ee] bg-white p-3">
                  <p className="text-xs text-[#4f6977]">{t.diagnosticsResult}</p>
                  {record.diagnostics.latestDrpsResult ? (
                    <p className="text-sm font-semibold text-[#123447]">
                      {record.diagnostics.latestDrpsResult.probabilityScore.toFixed(2)} (
                      {probabilityLabel(record.diagnostics.latestDrpsResult.probabilityClass, locale)})
                    </p>
                  ) : (
                    <p className="text-sm text-[#4f6977]">
                      {record.diagnostics.drpsUnavailable ? t.diagnosticsUnavailable : "-"}
                    </p>
                  )}
                </article>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
