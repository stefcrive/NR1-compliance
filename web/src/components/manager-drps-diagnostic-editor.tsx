"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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

type CampaignQuestion = {
  id: string;
  topicId: number;
  position: number;
  prompt: string;
  isActive: boolean;
};

type TopicGroup = {
  topicId: number;
  label: string;
  questions: CampaignQuestion[];
};

type CampaignMutationPayload = {
  campaign?: {
    id: string;
    name: string;
    public_slug: string;
    status: string;
  };
  error?: string;
};

const TOPIC_LABELS = {
  en: {
    1: "T01 Harassment",
    2: "T02 Lack of support",
    3: "T03 Poor change management",
    4: "T04 Low role clarity",
    5: "T05 Low rewards and recognition",
    6: "T06 Low control and autonomy",
    7: "T07 Low organizational fairness",
    8: "T08 Violent or traumatic events",
    9: "T09 Low demand",
    10: "T10 Work overload",
    11: "T11 Poor relationships",
    12: "T12 Difficult communication",
    13: "T13 Remote and isolated work",
  } as Record<number, string>,
  pt: {
    1: "T01 Assedio de qualquer natureza",
    2: "T02 Falta de suporte e apoio",
    3: "T03 Ma gestao de mudancas",
    4: "T04 Baixa clareza de papel",
    5: "T05 Baixas recompensas e reconhecimento",
    6: "T06 Baixo controle e falta de autonomia",
    7: "T07 Baixa justica organizacional",
    8: "T08 Eventos violentos e traumaticos",
    9: "T09 Baixa demanda",
    10: "T10 Excesso de demandas",
    11: "T11 Maus relacionamentos",
    12: "T12 Dificil comunicacao",
    13: "T13 Trabalho remoto e isolado",
  } as Record<number, string>,
} as const;

const COPY = {
  en: {
    breadcrumbBase: "Programs database",
    loading: "Loading DRPS diagnostic...",
    notFound: "Diagnostic not found in programs database.",
    sourceLabel: "Source",
    sourceSurvey: "Survey base",
    sourceLegacy: "Legacy DRPS",
    statusLabel: "Status",
    windowLabel: "Window",
    linkedLabel: "Assignment",
    linkedAssigned: "Assigned to client",
    linkedTemplate: "Template",
    reload: "Reload",
    editTitle: "Edit title",
    cloneQuestionnaire: "Clone questionnaire",
    titleField: "DRPS title",
    cloneField: "Clone title",
    saveTitle: "Save title",
    createClone: "Create clone",
    cancelAction: "Cancel",
    updating: "Updating...",
    cloning: "Cloning...",
    titleValidationError: "Title must have at least 3 characters.",
    titleUpdated: "DRPS title updated.",
    cloneValidationError: "Clone title must have at least 3 characters.",
    cloneCreateError: "Could not clone questionnaire.",
    cloneCreated: "Questionnaire clone created.",
    openClone: "Open clone",
    cloneUnavailableLegacy: "Only survey-based diagnostics can be cloned.",
    questionnaireTitle: "Questionnaire editor",
    questionnaireSubtitle:
      "Edit prompts and save to persist question updates in the database.",
    legacyQuestionnaireInfo:
      "Legacy DRPS campaigns do not have editable questionnaire records in the current schema.",
    questionsLoadError: "Could not load questionnaire.",
    noQuestions: "No active questions found for this diagnostic.",
    uncategorized: "Uncategorized",
    questionLabel: "Question",
    addQuestion: "Add question",
    removeQuestion: "Remove",
    save: "Save questionnaire",
    saving: "Saving...",
    validationError: "Each question must have at least 3 characters.",
    saved: "Questionnaire saved.",
  },
  pt: {
    breadcrumbBase: "Base de programas",
    loading: "Carregando diagnostico DRPS...",
    notFound: "Diagnostico nao encontrado na base de programas.",
    sourceLabel: "Origem",
    sourceSurvey: "Base surveys",
    sourceLegacy: "DRPS legado",
    statusLabel: "Status",
    windowLabel: "Janela",
    linkedLabel: "Atribuicao",
    linkedAssigned: "Atribuido ao cliente",
    linkedTemplate: "Template",
    reload: "Recarregar",
    editTitle: "Editar titulo",
    cloneQuestionnaire: "Clonar questionario",
    titleField: "Titulo do DRPS",
    cloneField: "Titulo do clone",
    saveTitle: "Salvar titulo",
    createClone: "Criar clone",
    cancelAction: "Cancelar",
    updating: "Atualizando...",
    cloning: "Clonando...",
    titleValidationError: "Titulo deve ter pelo menos 3 caracteres.",
    titleUpdated: "Titulo do DRPS atualizado.",
    cloneValidationError: "Titulo do clone deve ter pelo menos 3 caracteres.",
    cloneCreateError: "Nao foi possivel clonar o questionario.",
    cloneCreated: "Clone do questionario criado.",
    openClone: "Abrir clone",
    cloneUnavailableLegacy: "Somente diagnosticos baseados em surveys podem ser clonados.",
    questionnaireTitle: "Editor de questionario",
    questionnaireSubtitle:
      "Edite os prompts e salve para persistir as perguntas no banco de dados.",
    legacyQuestionnaireInfo:
      "Campanhas DRPS legadas nao possuem registros de questionario editaveis no schema atual.",
    questionsLoadError: "Nao foi possivel carregar o questionario.",
    noQuestions: "Nenhuma pergunta ativa encontrada para este diagnostico.",
    uncategorized: "Sem categoria",
    questionLabel: "Pergunta",
    addQuestion: "Adicionar pergunta",
    removeQuestion: "Remover",
    save: "Salvar questionario",
    saving: "Salvando...",
    validationError: "Cada pergunta deve ter pelo menos 3 caracteres.",
    saved: "Questionario salvo.",
  },
} as const;

function fmtDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

function fmtWindow(startsAt: string | null, closesAt: string | null) {
  return `${fmtDate(startsAt)} - ${fmtDate(closesAt)}`;
}

export function ManagerDrpsDiagnosticEditor({ campaignId }: { campaignId: string }) {
  const { locale } = useManagerLocale();
  const t = COPY[locale];

  const [diagnostic, setDiagnostic] = useState<DrpsDiagnostic | null>(null);
  const [questions, setQuestions] = useState<CampaignQuestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [questionError, setQuestionError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isUpdatingTitle, setIsUpdatingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [isClonePanelOpen, setIsClonePanelOpen] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [createdCloneId, setCreatedCloneId] = useState<string | null>(null);

  const topicGroups = useMemo<TopicGroup[]>(() => {
    const byTopic = new Map<number, CampaignQuestion[]>();
    for (const question of questions) {
      const list = byTopic.get(question.topicId) ?? [];
      list.push(question);
      byTopic.set(question.topicId, list);
    }

    return Array.from(byTopic.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([topicId, groupQuestions]) => ({
        topicId,
        label:
          TOPIC_LABELS[locale][topicId] ??
          `${locale === "pt" ? "Topico" : "Topic"} ${topicId || t.uncategorized}`,
        questions: [...groupQuestions].sort((a, b) => a.position - b.position),
      }));
  }, [locale, questions, t.uncategorized]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    setQuestionError("");
    setSaveNotice("");
    try {
      const dbResponse = await fetch("/api/admin/programs-database", { cache: "no-store" });
      if (!dbResponse.ok) {
        const payload = (await dbResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? t.notFound);
      }

      const payload = (await dbResponse.json()) as { drpsDiagnostics: DrpsDiagnostic[] };
      const found = (payload.drpsDiagnostics ?? []).find((item) => item.id === campaignId) ?? null;
      if (!found) {
        throw new Error(t.notFound);
      }

      setDiagnostic(found);

      if (found.source !== "surveys") {
        setQuestions([]);
        setQuestionError(t.legacyQuestionnaireInfo);
        return;
      }

      const questionsResponse = await fetch(`/api/admin/campaigns/${campaignId}/questions`, {
        cache: "no-store",
      });

      if (!questionsResponse.ok) {
        const questionPayload = (await questionsResponse.json().catch(() => ({}))) as { error?: string };
        setQuestionError(questionPayload.error ?? t.questionsLoadError);
        setQuestions([]);
        return;
      }

      const questionsPayload = (await questionsResponse.json()) as { questions: CampaignQuestion[] };
      const loadedQuestions = (questionsPayload.questions ?? [])
        .filter((item) => item.isActive)
        .sort((a, b) => a.position - b.position);

      if (loadedQuestions.length === 0) {
        setQuestionError(t.noQuestions);
        setQuestions([]);
        return;
      }

      setQuestions(loadedQuestions);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.notFound);
      setDiagnostic(null);
      setQuestions([]);
    } finally {
      setIsLoading(false);
    }
  }, [
    campaignId,
    t.legacyQuestionnaireInfo,
    t.noQuestions,
    t.notFound,
    t.questionsLoadError,
  ]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function updatePrompt(questionId: string, value: string) {
    setQuestions((previous) =>
      previous.map((item) =>
        item.id === questionId
          ? {
              ...item,
              prompt: value,
            }
          : item,
      ),
    );
  }

  function addPrompt() {
    setQuestions((previous) => {
      const fallbackTopic = previous.at(-1)?.topicId ?? 1;
      return [
        ...previous,
        {
          id: `new-${Date.now()}-${previous.length + 1}`,
          topicId: fallbackTopic,
          position: previous.length + 1,
          prompt: "",
          isActive: true,
        },
      ];
    });
  }

  function removePrompt(questionId: string) {
    setQuestions((previous) =>
      previous
        .filter((item) => item.id !== questionId)
        .map((item, index) => ({
          ...item,
          position: index + 1,
        })),
    );
  }

  async function saveQuestionnaire() {
    const normalizedPrompts = [...questions]
      .sort((a, b) => a.position - b.position)
      .map((item) => item.prompt.trim())
      .filter((item) => item.length > 0);
    if (normalizedPrompts.some((item) => item.length < 3) || normalizedPrompts.length === 0) {
      setSaveNotice("");
      setQuestionError(t.validationError);
      return;
    }

    setIsSaving(true);
    setSaveNotice("");
    setQuestionError("");
    try {
      const response = await fetch(`/api/admin/campaigns/${campaignId}/questions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompts: normalizedPrompts }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? t.questionsLoadError);
      }
      await loadData();
      setSaveNotice(t.saved);
    } catch (saveError) {
      setQuestionError(saveError instanceof Error ? saveError.message : t.questionsLoadError);
    } finally {
      setIsSaving(false);
    }
  }

  function openEditTitle() {
    setActionError("");
    setActionNotice("");
    setCreatedCloneId(null);
    setIsClonePanelOpen(false);
    setEditTitleValue(diagnostic?.name ?? "");
    setIsEditingTitle(true);
  }

  async function saveTitle() {
    const normalizedTitle = editTitleValue.trim();
    if (normalizedTitle.length < 3) {
      setActionError(t.titleValidationError);
      setActionNotice("");
      return;
    }

    setIsUpdatingTitle(true);
    setActionError("");
    setActionNotice("");
    try {
      const response = await fetch(`/api/admin/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: normalizedTitle }),
      });
      const payload = (await response.json().catch(() => ({}))) as CampaignMutationPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? t.notFound);
      }
      setDiagnostic((previous) =>
        previous
          ? {
              ...previous,
              name: payload.campaign?.name ?? normalizedTitle,
            }
          : previous,
      );
      setIsEditingTitle(false);
      setActionNotice(t.titleUpdated);
    } catch (updateError) {
      setActionError(updateError instanceof Error ? updateError.message : t.notFound);
    } finally {
      setIsUpdatingTitle(false);
    }
  }

  function openClonePanel() {
    setActionError("");
    setActionNotice("");
    setCreatedCloneId(null);
    setIsEditingTitle(false);
    setCloneName(`${diagnostic?.name ?? ""} (${locale === "pt" ? "copia" : "copy"})`);
    setIsClonePanelOpen(true);
  }

  async function createClone() {
    if (diagnostic?.source !== "surveys") {
      setActionError(t.cloneUnavailableLegacy);
      setActionNotice("");
      return;
    }

    const normalizedTitle = cloneName.trim();
    if (normalizedTitle.length < 3) {
      setActionError(t.cloneValidationError);
      setActionNotice("");
      return;
    }

    setIsCloning(true);
    setActionError("");
    setActionNotice("");
    try {
      const response = await fetch("/api/admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: normalizedTitle,
          status: "draft",
          sourceSurveyId: campaignId,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as CampaignMutationPayload;
      if (response.status === 207 || !response.ok || !payload.campaign?.id) {
        throw new Error(payload.error ?? t.cloneCreateError);
      }
      setCreatedCloneId(payload.campaign.id);
      setIsClonePanelOpen(false);
      setActionNotice(t.cloneCreated);
    } catch (cloneError) {
      setActionError(cloneError instanceof Error ? cloneError.message : t.cloneCreateError);
    } finally {
      setIsCloning(false);
    }
  }

  if (isLoading) {
    return <p className="text-sm text-[#49697a]">{t.loading}</p>;
  }

  if (!diagnostic) {
    return <p className="text-sm text-red-600">{error || t.notFound}</p>;
  }

  return (
    <div className="space-y-6">
      <nav className="text-xs text-[#4f6977]">
        <Link href="/manager/programs" className="text-[#0f5b73]">
          {t.breadcrumbBase}
        </Link>{" "}
        / <span>{diagnostic.name}</span>
      </nav>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-[#123447]">{diagnostic.name}</h2>
            <p className="mt-1 text-sm text-[#35515f]">
              {t.sourceLabel}:{" "}
              {diagnostic.source === "surveys" ? t.sourceSurvey : t.sourceLegacy}
            </p>
            <p className="text-sm text-[#35515f]">
              {t.statusLabel}: {diagnostic.status} | {t.windowLabel}:{" "}
              {fmtWindow(diagnostic.startsAt, diagnostic.closesAt)}
            </p>
            <p className="text-sm text-[#35515f]">
              {t.linkedLabel}:{" "}
              {diagnostic.linkedClientId ? t.linkedAssigned : t.linkedTemplate}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openEditTitle}
              className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
            >
              {t.editTitle}
            </button>
            <button
              type="button"
              onClick={openClonePanel}
              disabled={diagnostic.source !== "surveys"}
              className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73] disabled:opacity-50"
            >
              {t.cloneQuestionnaire}
            </button>
            <button
              type="button"
              onClick={() => void loadData()}
              className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
            >
              {t.reload}
            </button>
          </div>
        </div>
        {isEditingTitle ? (
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="min-w-[220px] flex-1 text-xs text-[#4f6977]">
              {t.titleField}
              <input
                value={editTitleValue}
                onChange={(event) => setEditTitleValue(event.target.value)}
                className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => void saveTitle()}
              disabled={isUpdatingTitle}
              className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {isUpdatingTitle ? t.updating : t.saveTitle}
            </button>
            <button
              type="button"
              onClick={() => setIsEditingTitle(false)}
              className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
            >
              {t.cancelAction}
            </button>
          </div>
        ) : null}
        {isClonePanelOpen ? (
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="min-w-[220px] flex-1 text-xs text-[#4f6977]">
              {t.cloneField}
              <input
                value={cloneName}
                onChange={(event) => setCloneName(event.target.value)}
                className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => void createClone()}
              disabled={isCloning}
              className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {isCloning ? t.cloning : t.createClone}
            </button>
            <button
              type="button"
              onClick={() => setIsClonePanelOpen(false)}
              className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
            >
              {t.cancelAction}
            </button>
          </div>
        ) : null}
        {actionError ? <p className="mt-3 text-sm text-red-600">{actionError}</p> : null}
        {actionNotice ? <p className="mt-3 text-sm text-[#1f6b3d]">{actionNotice}</p> : null}
        {createdCloneId ? (
          <div className="mt-2">
            <Link
              href={`/manager/programs/drps/${createdCloneId}`}
              className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
            >
              {t.openClone}
            </Link>
          </div>
        ) : null}
      </section>

      <section className="space-y-4 rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div>
          <h3 className="text-lg font-semibold text-[#123447]">{t.questionnaireTitle}</h3>
          <p className="mt-1 text-sm text-[#35515f]">{t.questionnaireSubtitle}</p>
        </div>

        {questionError ? <p className="text-sm text-red-600">{questionError}</p> : null}
        {saveNotice ? <p className="text-sm text-[#1f6b3d]">{saveNotice}</p> : null}

        {diagnostic.source !== "surveys" ? null : (
          <>
            <div className="space-y-3">
              {topicGroups.map((group) => (
                <article
                  key={`${diagnostic.id}-${group.topicId}`}
                  className="rounded-xl border border-[#d8e4ee] bg-[#f8fcff] p-4"
                >
                  <header className="mb-3 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[#1d4257]">{group.label}</p>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-[#4d6a79]">
                      {group.questions.length}
                    </span>
                  </header>

                  <div className="space-y-3">
                    {group.questions.map((question) => (
                      <div key={question.id} className="rounded-xl border border-[#d8e4ee] bg-white p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#4d6a79]">
                            {t.questionLabel} {question.position}
                          </p>
                          <button
                            type="button"
                            onClick={() => removePrompt(question.id)}
                            disabled={questions.length <= 1}
                            className="rounded-full border border-[#e7c9c9] px-3 py-1 text-xs font-semibold text-[#8a2d2d] disabled:opacity-50"
                          >
                            {t.removeQuestion}
                          </button>
                        </div>
                        <textarea
                          value={question.prompt}
                          onChange={(event) => updatePrompt(question.id, event.target.value)}
                          className="mt-2 w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
                          rows={3}
                        />
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addPrompt}
                className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
              >
                {t.addQuestion}
              </button>
              <button
                type="button"
                onClick={() => void saveQuestionnaire()}
                disabled={isSaving}
                className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {isSaving ? t.saving : t.save}
              </button>
            </div>
          </>
        )}
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
