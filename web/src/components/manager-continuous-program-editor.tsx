"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useManagerLocale } from "@/components/manager-locale";

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
    assignments: "Assignments",
    assignedTotal: "Total",
    assignedRecommended: "Recommended",
    assignedActive: "Active",
    assignedCompleted: "Completed",
    reload: "Reload",
    save: "Save program",
    saving: "Saving...",
    saved: "Program saved.",
    loadError: "Could not load continuous program.",
    saveError: "Could not save program.",
    validationTitle: "Title must have at least 3 characters.",
    validationTopic: "Target topic must be between 1 and 13.",
    validationThreshold: "Trigger threshold must be between 1.00 and 3.00.",
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
    assignments: "Atribuicoes",
    assignedTotal: "Total",
    assignedRecommended: "Recomendados",
    assignedActive: "Ativos",
    assignedCompleted: "Concluidos",
    reload: "Recarregar",
    save: "Salvar programa",
    saving: "Salvando...",
    saved: "Programa salvo.",
    loadError: "Nao foi possivel carregar o programa continuo.",
    saveError: "Nao foi possivel salvar o programa.",
    validationTitle: "Titulo deve ter pelo menos 3 caracteres.",
    validationTopic: "Topico alvo deve estar entre 1 e 13.",
    validationThreshold: "Gatilho deve estar entre 1.00 e 3.00.",
  },
} as const;

export function ManagerContinuousProgramEditor({ programId }: { programId: string }) {
  const { locale } = useManagerLocale();
  const t = COPY[locale];

  const [program, setProgram] = useState<ContinuousProgram | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetRiskTopic, setTargetRiskTopic] = useState(1);
  const [triggerThreshold, setTriggerThreshold] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
          triggerThreshold: Number(triggerThreshold.toFixed(2)),
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
          <button
            type="button"
            onClick={() => void loadProgram()}
            className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
          >
            {t.reload}
          </button>
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
            disabled={isSaving}
            onClick={() => void saveProgram()}
            className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {isSaving ? t.saving : t.save}
          </button>
        </div>

        {notice ? <p className="text-sm text-[#1f6b3d]">{notice}</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </section>
    </div>
  );
}
