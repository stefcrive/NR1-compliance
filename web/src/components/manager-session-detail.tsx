"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useManagerLocale } from "@/components/manager-locale";
import type { ContinuousProgramMaterial } from "@/lib/continuous-programs";

type ManagerSessionDetailProps =
  | { source: "library"; sessionId: string; returnTo?: string }
  | { source: "program"; programId: string; sessionId: string; returnTo?: string };

type SessionDetailModel = {
  id: string;
  title: string;
  topicTitle: string;
  moduleTitle: string | null;
  moduleOrder: number | null;
  topicOrder: number | null;
  notes: string | null;
  preparationRequired: string | null;
  materials: ContinuousProgramMaterial[];
  assignedPrograms: Array<{ programId: string; programTitle: string }>;
  source: "library" | "program";
  programId: string | null;
  programTitle: string | null;
};

const COPY = {
  en: {
    loading: "Loading session...",
    notFound: "Session not found.",
    title: "Title",
    source: "Source",
    sourceLibrary: "Session library",
    sourceProgram: "Program session",
    module: "Module",
    topic: "Topic",
    notes: "Notes",
    preparation: "Preparation",
    files: "Files",
    noFiles: "No files linked to this session.",
    assignedPrograms: "Assigned programs",
    noAssignedPrograms: "No assigned programs.",
    breadcrumbSession: "Session",
    breadcrumbPrograms: "Programs database",
    breadcrumbProgram: "Program details",
    breadcrumbClientArea: "Client area",
    breadcrumbAssignedPrograms: "Assigned continuous programs",
    breadcrumbHistory: "History",
    breadcrumbHome: "Home",
    breadcrumbBack: "Back",
    backPrograms: "Back to programs",
    backProgram: "Back to program",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    saving: "Saving...",
    saved: "Session saved.",
    saveError: "Could not save session.",
    validationTitle: "Title must have at least 3 characters.",
  },
  pt: {
    loading: "Carregando sessao...",
    notFound: "Sessao nao encontrada.",
    title: "Titulo",
    source: "Origem",
    sourceLibrary: "Biblioteca de sessoes",
    sourceProgram: "Sessao do programa",
    module: "Modulo",
    topic: "Topico",
    notes: "Notas",
    preparation: "Preparacao",
    files: "Arquivos",
    noFiles: "Nenhum arquivo vinculado a esta sessao.",
    assignedPrograms: "Programas atribuidos",
    noAssignedPrograms: "Sem programas atribuidos.",
    breadcrumbSession: "Sessao",
    breadcrumbPrograms: "Base de programas",
    breadcrumbProgram: "Detalhes do programa",
    breadcrumbClientArea: "Client area",
    breadcrumbAssignedPrograms: "Assigned processo continuos",
    breadcrumbHistory: "Historico",
    breadcrumbHome: "Home",
    breadcrumbBack: "Voltar",
    backPrograms: "Voltar para programas",
    backProgram: "Voltar para programa",
    edit: "Editar",
    save: "Salvar",
    cancel: "Cancelar",
    saving: "Salvando...",
    saved: "Sessao salva.",
    saveError: "Nao foi possivel salvar a sessao.",
    validationTitle: "Titulo deve ter pelo menos 3 caracteres.",
  },
} as const;

function formatFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "-";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeOptionalText(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

type BreadcrumbItem = { label: string; href: string | null };

function normalizeReturnTo(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized.startsWith("/manager")) return null;
  if (normalized.startsWith("//")) return null;
  return normalized;
}

function parseReturnTo(value: string): { pathname: string; searchParams: URLSearchParams } {
  const [pathnamePart, queryPart] = value.split("?", 2);
  const pathname = pathnamePart || value;
  return {
    pathname,
    searchParams: new URLSearchParams(queryPart ?? ""),
  };
}

export function ManagerSessionDetail(props: ManagerSessionDetailProps) {
  const { locale } = useManagerLocale();
  const t = COPY[locale];
  const programIdFromProps = props.source === "program" ? props.programId : null;

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [session, setSession] = useState<SessionDetailModel | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftPreparation, setDraftPreparation] = useState("");
  const safeReturnTo = useMemo(() => normalizeReturnTo(props.returnTo), [props.returnTo]);
  const defaultReturnTo =
    props.source === "program" && props.programId
      ? `/manager/programs/continuous/${encodeURIComponent(props.programId)}`
      : "/manager/programs";
  const backHref = safeReturnTo ?? defaultReturnTo;
  const returnToContext = useMemo(() => parseReturnTo(backHref), [backHref]);
  const backPathname = returnToContext.pathname;
  const backSearchParams = returnToContext.searchParams;
  const breadcrumbSessionLabel =
    session?.topicTitle?.trim() || session?.title?.trim() || t.breadcrumbSession;
  const breadcrumbs = useMemo<BreadcrumbItem[]>(() => {
    if (backPathname.startsWith("/manager/history/events/")) {
      const from = backSearchParams.get("from");
      const context = backSearchParams.get("ctx");
      if (context === "client-area" || from === "client-area") {
        const clientId = backSearchParams.get("clientId")?.trim() ?? "";
        const clientName = backSearchParams.get("clientName")?.trim() ?? "";
        const assignmentId = backSearchParams.get("assignmentId")?.trim() ?? "";
        const assignmentTitle = backSearchParams.get("assignmentTitle")?.trim() ?? "";
        const eventTitle = backSearchParams.get("eventTitle")?.trim() ?? "";
        if (clientId.length > 0 && assignmentId.length > 0) {
          return [
            { label: t.breadcrumbClientArea, href: "/manager/clients" },
            {
              label: clientName.length > 0 ? clientName : clientId,
              href: `/manager/clients/${clientId}`,
            },
            {
              label: t.breadcrumbAssignedPrograms,
              href: `/manager/clients/${clientId}?tab=assigned-continuous`,
            },
            {
              label: assignmentTitle.length > 0 ? assignmentTitle : t.breadcrumbProgram,
              href: `/manager/clients/${clientId}/assigned-continuous/${assignmentId}`,
            },
            { label: eventTitle.length > 0 ? eventTitle : t.breadcrumbBack, href: backHref },
            { label: breadcrumbSessionLabel, href: null },
          ];
        }
      }
    }
    if (backPathname.startsWith("/manager/programs/continuous/")) {
      return [
        { label: t.breadcrumbPrograms, href: "/manager/programs" },
        { label: t.breadcrumbProgram, href: backHref },
        { label: breadcrumbSessionLabel, href: null },
      ];
    }
    if (backPathname === "/manager/programs") {
      return [
        { label: t.breadcrumbPrograms, href: "/manager/programs" },
        { label: breadcrumbSessionLabel, href: null },
      ];
    }
    if (backPathname.startsWith("/manager/clients/") && backPathname.includes("/assigned-continuous/")) {
      const match = backPathname.match(
        /^\/manager\/clients\/([^/]+)\/assigned-continuous\/([^/]+)$/,
      );
      if (match) {
        const clientId = decodeURIComponent(match[1] ?? "").trim();
        const assignmentId = decodeURIComponent(match[2] ?? "").trim();
        const from = backSearchParams.get("from");
        const clientName = backSearchParams.get("clientName")?.trim() ?? "";
        const assignmentTitle = backSearchParams.get("assignmentTitle")?.trim() ?? "";
        if (clientId.length > 0 && assignmentId.length > 0) {
          const assignedProgramsHref = `/manager/clients/${encodeURIComponent(clientId)}?tab=assigned-continuous${
            from === "history" ? "&from=history" : ""
          }`;
          return [
            { label: t.breadcrumbClientArea, href: "/manager/clients" },
            {
              label: clientName.length > 0 ? clientName : clientId,
              href: `/manager/clients/${encodeURIComponent(clientId)}`,
            },
            { label: t.breadcrumbAssignedPrograms, href: assignedProgramsHref },
            {
              label: assignmentTitle.length > 0 ? assignmentTitle : t.breadcrumbProgram,
              href: backHref,
            },
            { label: breadcrumbSessionLabel, href: null },
          ];
        }
      }
      return [
        { label: t.breadcrumbClientArea, href: "/manager/clients" },
        { label: t.breadcrumbAssignedPrograms, href: backHref },
        { label: breadcrumbSessionLabel, href: null },
      ];
    }
    if (backPathname.startsWith("/manager/history")) {
      return [
        { label: t.breadcrumbHistory, href: backHref },
        { label: breadcrumbSessionLabel, href: null },
      ];
    }
    if (backPathname === "/manager") {
      return [
        { label: t.breadcrumbHome, href: "/manager" },
        { label: breadcrumbSessionLabel, href: null },
      ];
    }
    if (backPathname.startsWith("/manager/clients/")) {
      return [
        { label: t.breadcrumbClientArea, href: "/manager/clients" },
        { label: t.breadcrumbBack, href: backHref },
        { label: breadcrumbSessionLabel, href: null },
      ];
    }
    return [
      { label: t.breadcrumbBack, href: backHref },
      { label: breadcrumbSessionLabel, href: null },
    ];
  }, [
    backSearchParams,
    backHref,
    backPathname,
    breadcrumbSessionLabel,
    t.breadcrumbAssignedPrograms,
    t.breadcrumbBack,
    t.breadcrumbClientArea,
    t.breadcrumbHistory,
    t.breadcrumbHome,
    t.breadcrumbProgram,
    t.breadcrumbPrograms,
  ]);

  const loadSession = useCallback(async () => {
    setIsLoading(true);
    setIsEditing(false);
    setError("");
    setNotice("");
    try {
      if (props.source === "library") {
        const response = await fetch(
          `/api/admin/programs-database/continuous/sessions/library/${encodeURIComponent(
            props.sessionId,
          )}`,
          {
            cache: "no-store",
          },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          session?: {
            id: string;
            title: string;
            topicTitle: string;
            moduleTitle: string | null;
            moduleOrder: number | null;
            topicOrder: number | null;
            notes: string | null;
            preparationRequired: string | null;
            materials: ContinuousProgramMaterial[];
            assignedPrograms: Array<{ programId: string; programTitle: string }>;
          };
        };
        if (!response.ok || !payload.session) {
          throw new Error(payload.error ?? t.notFound);
        }
        setSession({
          ...payload.session,
          source: "library",
          programId: null,
          programTitle: null,
        });
        return;
      }

      const programResponse = await fetch(
        `/api/admin/programs-database/continuous/${encodeURIComponent(programIdFromProps ?? "")}`,
        { cache: "no-store" },
      );
      const programPayload = (await programResponse.json().catch(() => ({}))) as {
        error?: string;
        program?: {
          id: string;
          title: string;
          sessions: Array<{
            id: string;
            title: string;
            notes: string | null;
            preparationRequired: string | null;
            materials: ContinuousProgramMaterial[];
          }>;
        };
      };

      if (!programResponse.ok || !programPayload.program) {
        throw new Error(programPayload.error ?? t.notFound);
      }

      const requestedSessionId = decodeURIComponent(props.sessionId);
      const matchedSession = (programPayload.program.sessions ?? []).find(
        (item) => item.id === requestedSessionId,
      );
      if (!matchedSession) {
        throw new Error(t.notFound);
      }

      const baseSession: SessionDetailModel = {
        id: matchedSession.id,
        title: matchedSession.title,
        topicTitle: matchedSession.title,
        moduleTitle: null,
        moduleOrder: null,
        topicOrder: null,
        notes: matchedSession.notes,
        preparationRequired: matchedSession.preparationRequired,
        materials: matchedSession.materials ?? [],
        assignedPrograms: [],
        source: "program",
        programId: programPayload.program.id,
        programTitle: programPayload.program.title,
      };

      if (matchedSession.id.startsWith("library-")) {
        const librarySessionId = matchedSession.id.slice("library-".length).trim();
        if (librarySessionId) {
          const libraryResponse = await fetch(
            `/api/admin/programs-database/continuous/sessions/library/${encodeURIComponent(
              librarySessionId,
            )}`,
            {
              cache: "no-store",
            },
          );
          const libraryPayload = (await libraryResponse.json().catch(() => ({}))) as {
            session?: {
              topicTitle: string;
              moduleTitle: string | null;
              moduleOrder: number | null;
              topicOrder: number | null;
              assignedPrograms: Array<{ programId: string; programTitle: string }>;
            };
          };
          if (libraryResponse.ok && libraryPayload.session) {
            baseSession.topicTitle = libraryPayload.session.topicTitle;
            baseSession.moduleTitle = libraryPayload.session.moduleTitle;
            baseSession.moduleOrder = libraryPayload.session.moduleOrder;
            baseSession.topicOrder = libraryPayload.session.topicOrder;
            baseSession.assignedPrograms = libraryPayload.session.assignedPrograms ?? [];
          }
        }
      }

      setSession(baseSession);
    } catch (loadError) {
      setSession(null);
      setError(loadError instanceof Error ? loadError.message : t.notFound);
    } finally {
      setIsLoading(false);
    }
  }, [programIdFromProps, props, t.notFound]);

  const startEditing = useCallback(() => {
    if (!session) return;
    setDraftTitle(session.topicTitle || session.title);
    setDraftNotes(session.notes ?? "");
    setDraftPreparation(session.preparationRequired ?? "");
    setError("");
    setNotice("");
    setIsEditing(true);
  }, [session]);

  const cancelEditing = useCallback(() => {
    if (!session) {
      setIsEditing(false);
      return;
    }
    setDraftTitle(session.topicTitle || session.title);
    setDraftNotes(session.notes ?? "");
    setDraftPreparation(session.preparationRequired ?? "");
    setError("");
    setIsEditing(false);
  }, [session]);

  const saveSession = useCallback(async () => {
    if (!session) return;

    const normalizedTitle = draftTitle.trim();
    if (normalizedTitle.length < 3) {
      setError(t.validationTitle);
      return;
    }

    const normalizedNotes = normalizeOptionalText(draftNotes);
    const normalizedPreparation = normalizeOptionalText(draftPreparation);

    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      if (session.source === "library") {
        const response = await fetch(
          `/api/admin/programs-database/continuous/sessions/library/${encodeURIComponent(
            session.id,
          )}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: normalizedTitle,
              notes: normalizedNotes,
              preparationRequired: normalizedPreparation,
            }),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          session?: {
            id: string;
            title: string;
            topicTitle: string;
            moduleTitle: string | null;
            moduleOrder: number | null;
            topicOrder: number | null;
            notes: string | null;
            preparationRequired: string | null;
            materials: ContinuousProgramMaterial[];
            assignedPrograms: Array<{ programId: string; programTitle: string }>;
          };
        };
        if (!response.ok || !payload.session) {
          throw new Error(payload.error ?? t.saveError);
        }

        setSession({
          ...payload.session,
          source: "library",
          programId: null,
          programTitle: null,
        });
      } else {
        const programId =
          session.programId ?? programIdFromProps;
        if (!programId) {
          throw new Error(t.saveError);
        }

        const programResponse = await fetch(
          `/api/admin/programs-database/continuous/${encodeURIComponent(programId)}`,
          { cache: "no-store" },
        );
        const programPayload = (await programResponse.json().catch(() => ({}))) as {
          error?: string;
          program?: {
            id: string;
            title: string;
            sessions: Array<{
              id: string;
              title: string;
              notes: string | null;
              preparationRequired: string | null;
              materials: ContinuousProgramMaterial[];
            }>;
          };
        };
        if (!programResponse.ok || !programPayload.program) {
          throw new Error(programPayload.error ?? t.saveError);
        }

        let matched = false;
        const nextSessions = (programPayload.program.sessions ?? []).map((item) => {
          if (item.id !== session.id) {
            return { ...item, materials: item.materials ?? [] };
          }
          matched = true;
          return {
            ...item,
            title: normalizedTitle,
            notes: normalizedNotes,
            preparationRequired: normalizedPreparation,
            materials: item.materials ?? [],
          };
        });

        if (!matched) {
          throw new Error(t.notFound);
        }

        const updateResponse = await fetch(
          `/api/admin/programs-database/continuous/${encodeURIComponent(programId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessions: nextSessions }),
          },
        );
        const updatePayload = (await updateResponse.json().catch(() => ({}))) as {
          error?: string;
          program?: {
            title: string;
            sessions: Array<{
              id: string;
              title: string;
              notes: string | null;
              preparationRequired: string | null;
              materials: ContinuousProgramMaterial[];
            }>;
          };
        };
        if (!updateResponse.ok || !updatePayload.program) {
          throw new Error(updatePayload.error ?? t.saveError);
        }

        const updatedSession = (updatePayload.program.sessions ?? []).find(
          (item) => item.id === session.id,
        );
        if (!updatedSession) {
          throw new Error(t.saveError);
        }

        setSession((previous) =>
          previous
            ? {
                ...previous,
                title: updatedSession.title,
                topicTitle: updatedSession.title,
                notes: updatedSession.notes,
                preparationRequired: updatedSession.preparationRequired,
                materials: updatedSession.materials ?? [],
                programTitle: updatePayload.program?.title ?? previous.programTitle,
              }
            : previous,
        );
      }

      setIsEditing(false);
      setNotice(t.saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t.saveError);
    } finally {
      setIsSaving(false);
    }
  }, [
    draftNotes,
    draftPreparation,
    draftTitle,
    programIdFromProps,
    session,
    t.notFound,
    t.saveError,
    t.saved,
    t.validationTitle,
  ]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!session) {
      setDraftTitle("");
      setDraftNotes("");
      setDraftPreparation("");
      return;
    }
    setDraftTitle(session.topicTitle || session.title);
    setDraftNotes(session.notes ?? "");
    setDraftPreparation(session.preparationRequired ?? "");
  }, [session]);

  return (
    <div className="space-y-3">
      <nav className="text-xs text-[#4f6977]">
        {breadcrumbs.map((item, index) => (
          <span key={`${item.label}-${index}`}>
            {index > 0 ? " / " : ""}
            {item.href ? (
              <Link href={item.href} className="text-[#0f5b73] hover:underline">
                {item.label}
              </Link>
            ) : (
              <span>{item.label}</span>
            )}
          </span>
        ))}
      </nav>
      <section className="space-y-4 rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!isLoading && !error && session ? (
            <div className="flex items-center gap-2">
              {isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={() => void saveSession()}
                    disabled={isSaving}
                    className="rounded-full bg-[#0f5b73] px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {isSaving ? t.saving : t.save}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditing}
                    disabled={isSaving}
                    className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#35515f] disabled:opacity-50"
                  >
                    {t.cancel}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={startEditing}
                  className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                >
                  {t.edit}
                </button>
              )}
            </div>
          ) : null}
        </div>

      {isLoading ? <p className="text-sm text-[#49697a]">{t.loading}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {notice ? <p className="text-sm text-[#1f6b3d]">{notice}</p> : null}

        {!isLoading && !error && session ? (
          <div className="space-y-4">
          <div className="rounded-xl border border-[#d8e4ee] bg-gradient-to-r from-[#edf6fb] to-[#f8fbfd] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#2d5569]">{t.topic}</p>
            {isEditing ? (
              <label className="mt-2 block text-xs text-[#35515f]">
                {t.title}
                <input
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  className="mt-1 w-full rounded border border-[#c9dce8] bg-white px-3 py-2 text-base font-semibold text-[#123447]"
                />
              </label>
            ) : (
              <h2 className="mt-1 text-xl font-bold text-[#123447]">{session.topicTitle || session.title}</h2>
            )}
            <p className="mt-2 text-sm text-[#35515f]">
              {t.source}: {session.source === "library" ? t.sourceLibrary : t.sourceProgram}
            </p>
            {session.moduleTitle ? (
              <p className="mt-1 text-sm text-[#35515f]">
                {t.module}: {session.moduleTitle}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <article className="rounded-xl border border-[#d8e4ee] p-4">
              <h3 className="text-sm font-semibold text-[#123447]">{t.notes}</h3>
              {isEditing ? (
                <textarea
                  value={draftNotes}
                  onChange={(event) => setDraftNotes(event.target.value)}
                  className="mt-2 min-h-28 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm text-[#35515f]"
                  rows={5}
                />
              ) : (
                <p className="mt-2 text-sm text-[#35515f]">{session.notes?.trim() || "-"}</p>
              )}
            </article>
            <article className="rounded-xl border border-[#d8e4ee] p-4">
              <h3 className="text-sm font-semibold text-[#123447]">{t.preparation}</h3>
              {isEditing ? (
                <textarea
                  value={draftPreparation}
                  onChange={(event) => setDraftPreparation(event.target.value)}
                  className="mt-2 min-h-28 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm text-[#35515f]"
                  rows={5}
                />
              ) : (
                <p className="mt-2 text-sm text-[#35515f]">{session.preparationRequired?.trim() || "-"}</p>
              )}
            </article>
          </div>

          <article className="rounded-xl border border-[#d8e4ee] p-4">
            <h3 className="text-sm font-semibold text-[#123447]">{t.files}</h3>
            {session.materials.length === 0 ? (
              <p className="mt-2 text-sm text-[#5a7383]">{t.noFiles}</p>
            ) : (
              <ul className="mt-2 divide-y divide-[#d8e4ee] rounded-lg border border-[#d8e4ee]">
                {session.materials.map((material) => (
                  <li key={material.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-[#123447]">{material.title}</p>
                      <p className="text-xs text-[#55707f]">
                        {material.fileName} | {formatFileSize(material.sizeBytes)}
                      </p>
                    </div>
                    <a
                      href={material.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                    >
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="rounded-xl border border-[#d8e4ee] p-4">
            <h3 className="text-sm font-semibold text-[#123447]">{t.assignedPrograms}</h3>
            {session.assignedPrograms.length === 0 ? (
              <p className="mt-2 text-sm text-[#5a7383]">{t.noAssignedPrograms}</p>
            ) : (
              <ul className="mt-2 divide-y divide-[#d8e4ee] rounded-lg border border-[#d8e4ee]">
                {session.assignedPrograms.map((program) => (
                  <li key={`${session.id}-${program.programId}`} className="px-3 py-2">
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
          </article>
          </div>
        ) : null}
      </section>
    </div>
  );
}
