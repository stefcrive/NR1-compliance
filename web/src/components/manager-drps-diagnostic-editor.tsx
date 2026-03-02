"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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
  position: number;
  prompt: string;
  isActive: boolean;
};

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
    questionnaireTitle: "Questionnaire editor",
    questionnaireSubtitle:
      "Edit prompts and save to persist question updates in the database.",
    legacyQuestionnaireInfo:
      "Legacy DRPS campaigns do not have editable questionnaire records in the current schema.",
    questionsLoadError: "Could not load questionnaire.",
    noQuestions: "No active questions found for this diagnostic.",
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
    questionnaireTitle: "Editor de questionario",
    questionnaireSubtitle:
      "Edite os prompts e salve para persistir as perguntas no banco de dados.",
    legacyQuestionnaireInfo:
      "Campanhas DRPS legadas nao possuem registros de questionario editaveis no schema atual.",
    questionsLoadError: "Nao foi possivel carregar o questionario.",
    noQuestions: "Nenhuma pergunta ativa encontrada para este diagnostico.",
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
  const [prompts, setPrompts] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [questionError, setQuestionError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");

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
        setPrompts([]);
        setQuestionError(t.legacyQuestionnaireInfo);
        return;
      }

      const questionsResponse = await fetch(`/api/admin/campaigns/${campaignId}/questions`, {
        cache: "no-store",
      });

      if (!questionsResponse.ok) {
        const questionPayload = (await questionsResponse.json().catch(() => ({}))) as { error?: string };
        setQuestionError(questionPayload.error ?? t.questionsLoadError);
        setPrompts([""]);
        return;
      }

      const questionsPayload = (await questionsResponse.json()) as { questions: CampaignQuestion[] };
      const loadedPrompts = (questionsPayload.questions ?? [])
        .filter((item) => item.isActive)
        .sort((a, b) => a.position - b.position)
        .map((item) => item.prompt);

      if (loadedPrompts.length === 0) {
        setQuestionError(t.noQuestions);
        setPrompts([""]);
        return;
      }

      setPrompts(loadedPrompts);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.notFound);
      setDiagnostic(null);
      setPrompts([]);
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

  function updatePrompt(index: number, value: string) {
    setPrompts((previous) => previous.map((item, idx) => (idx === index ? value : item)));
  }

  function addPrompt() {
    setPrompts((previous) => [...previous, ""]);
  }

  function removePrompt(index: number) {
    setPrompts((previous) => previous.filter((_, idx) => idx !== index));
  }

  async function saveQuestionnaire() {
    const normalizedPrompts = prompts.map((item) => item.trim()).filter((item) => item.length > 0);
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
      setPrompts(normalizedPrompts);
      setSaveNotice(t.saved);
    } catch (saveError) {
      setQuestionError(saveError instanceof Error ? saveError.message : t.questionsLoadError);
    } finally {
      setIsSaving(false);
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
          <button
            type="button"
            onClick={() => void loadData()}
            className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
          >
            {t.reload}
          </button>
        </div>
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
              {prompts.map((prompt, index) => (
                <div key={`${index}-${diagnostic.id}`} className="rounded-xl border border-[#d8e4ee] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#4d6a79]">
                      {t.questionLabel} {index + 1}
                    </p>
                    <button
                      type="button"
                      onClick={() => removePrompt(index)}
                      disabled={prompts.length <= 1}
                      className="rounded-full border border-[#e7c9c9] px-3 py-1 text-xs font-semibold text-[#8a2d2d] disabled:opacity-50"
                    >
                      {t.removeQuestion}
                    </button>
                  </div>
                  <textarea
                    value={prompt}
                    onChange={(event) => updatePrompt(index, event.target.value)}
                    className="mt-2 w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
                    rows={3}
                  />
                </div>
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
