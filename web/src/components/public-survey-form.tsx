"use client";

import Script from "next/script";
import { useEffect, useMemo, useState } from "react";

const QUESTIONS_PER_PAGE = 5;
const AUTO_SAVE_DEBOUNCE_MS = 450;
const DRAFT_STORAGE_PREFIX = "nr1:drps:draft";

type SessionPayload = {
  surveyId: string;
  slug: string;
  sessionSid: string;
  linkType: "general" | "sector";
  alreadySubmitted: boolean;
  title: string;
  likert: { min: number; max: number };
  turnstileSiteKey: string;
  lockedSector: {
    id: string;
    key: string;
    name: string;
    riskParameter: number;
  } | null;
  groups: Array<{
    key: string;
    label: string;
    isRequired: boolean;
    options: Array<{ value: string; label: string }>;
  }>;
  questions: Array<{
    id: string;
    topicId: number;
    code: string;
    position: number;
    prompt: string;
    dimension: "severity" | "probability";
    required: boolean;
  }>;
};

type DraftPayload = {
  version: 1;
  savedAt: string;
  pageIndex: number;
  answers: Record<string, number>;
  groups: Record<string, string>;
};

declare global {
  interface Window {
    onTurnstileSuccess?: (token: string) => void;
  }
}

function pickPreselectedSector(session: SessionPayload): string | null {
  const sectorGroup = session.groups.find((group) => group.key === "sector");
  if (!sectorGroup || sectorGroup.options.length === 0) {
    return null;
  }

  if (session.lockedSector) {
    const matchedOption = sectorGroup.options.find(
      (option) =>
        option.value === session.lockedSector?.name || option.label === session.lockedSector?.name,
    );
    return matchedOption?.value ?? session.lockedSector.name;
  }

  if (session.linkType === "general") {
    const preferredOption = sectorGroup.options.find((option) => {
      const candidate = `${option.value} ${option.label}`.toLowerCase();
      return candidate.includes("empresa geral") || candidate.includes("geral") || candidate.includes("general");
    });
    if (preferredOption) {
      return preferredOption.value;
    }
  }

  return sectorGroup.options[0]?.value ?? null;
}

function buildDraftStorageKey(params: {
  surveyId: string;
  sessionSid: string;
  linkType: "general" | "sector";
  sectorToken?: string;
  lockedSectorId?: string;
}): string {
  const linkIdentity =
    params.linkType === "sector"
      ? `sector:${params.lockedSectorId ?? "unknown"}`
      : `general:${params.sectorToken?.trim() || "open"}`;
  return `${DRAFT_STORAGE_PREFIX}:${params.surveyId}:${linkIdentity}:${params.sessionSid}`;
}

export function PublicSurveyForm({
  slug,
  sectorToken,
}: {
  slug: string;
  sectorToken?: string;
}) {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [groups, setGroups] = useState<Record<string, string>>({});
  const [turnstileToken, setTurnstileToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [hydratedSessionSid, setHydratedSessionSid] = useState("");
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function loadSession() {
      setIsLoading(true);
      setLoadError("");
      setSubmitted(false);
      setSubmitError("");
      setAnswers({});
      setGroups({});
      setTurnstileToken("");
      setPageIndex(0);
      setHydratedSessionSid("");
      setRestoredFromDraft(false);
      setLastAutoSavedAt(null);
      try {
        const response = await fetch(`/api/public/surveys/${slug}/session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sectorToken: sectorToken || undefined,
          }),
          cache: "no-store",
        });
        if (!response.ok) {
          const errorPayload = (await response.json()) as { error?: string };
          throw new Error(errorPayload.error ?? "Nao foi possivel carregar o questionario.");
        }
        const payload = (await response.json()) as SessionPayload;
        if (!ignore) {
          setSession(payload);
        }
      } catch (error) {
        if (!ignore) {
          setLoadError(error instanceof Error ? error.message : "Erro ao carregar questionario.");
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    void loadSession();
    return () => {
      ignore = true;
    };
  }, [sectorToken, slug]);

  useEffect(() => {
    window.onTurnstileSuccess = (token: string) => {
      setTurnstileToken(token);
    };
    return () => {
      delete window.onTurnstileSuccess;
    };
  }, []);

  const draftStorageKey = useMemo(() => {
    if (!session) {
      return null;
    }
    return buildDraftStorageKey({
      surveyId: session.surveyId,
      sessionSid: session.sessionSid,
      linkType: session.linkType,
      sectorToken,
      lockedSectorId: session.lockedSector?.id,
    });
  }, [sectorToken, session]);

  const requiredQuestionCount = useMemo(() => {
    return session?.questions.filter((question) => question.required).length ?? 0;
  }, [session]);

  const answeredRequiredCount = useMemo(() => {
    if (!session) {
      return 0;
    }
    return session.questions.filter((question) => question.required && answers[question.id] !== undefined)
      .length;
  }, [answers, session]);

  const questionPages = useMemo(() => {
    if (!session) {
      return [] as SessionPayload["questions"][];
    }
    const pages: SessionPayload["questions"][] = [];
    for (let i = 0; i < session.questions.length; i += QUESTIONS_PER_PAGE) {
      pages.push(session.questions.slice(i, i + QUESTIONS_PER_PAGE));
    }
    return pages;
  }, [session]);

  useEffect(() => {
    if (!session || !draftStorageKey) {
      return;
    }
    if (hydratedSessionSid === session.sessionSid) {
      return;
    }

    const validQuestionIds = new Set(session.questions.map((question) => question.id));
    const groupsByKey = new Map(session.groups.map((group) => [group.key, group]));
    const restoredAnswers: Record<string, number> = {};
    const baseGroups: Record<string, string> = {};
    const defaultSector = pickPreselectedSector(session);
    if (defaultSector) {
      baseGroups.sector = defaultSector;
    }

    let restoredGroups = { ...baseGroups };
    let restoredPageIndex = 0;
    let restored = false;
    let restoredSavedAt: string | null = null;

    try {
      const rawDraft = window.localStorage.getItem(draftStorageKey);
      if (rawDraft) {
        const parsedDraft = JSON.parse(rawDraft) as Partial<DraftPayload>;
        if (parsedDraft.answers && typeof parsedDraft.answers === "object") {
          for (const [questionId, value] of Object.entries(parsedDraft.answers)) {
            if (!validQuestionIds.has(questionId)) {
              continue;
            }
            const numeric = Number(value);
            if (
              Number.isFinite(numeric) &&
              numeric >= session.likert.min &&
              numeric <= session.likert.max
            ) {
              restoredAnswers[questionId] = numeric;
            }
          }
        }

        if (parsedDraft.groups && typeof parsedDraft.groups === "object") {
          for (const [groupKey, value] of Object.entries(parsedDraft.groups)) {
            const groupDefinition = groupsByKey.get(groupKey);
            if (!groupDefinition || typeof value !== "string") {
              continue;
            }
            const knownValue = groupDefinition.options.some((option) => option.value === value);
            if (knownValue) {
              restoredGroups[groupKey] = value;
            }
          }
        }

        if (typeof parsedDraft.pageIndex === "number" && Number.isFinite(parsedDraft.pageIndex)) {
          const maxPageIndex = Math.max(Math.ceil(session.questions.length / QUESTIONS_PER_PAGE) - 1, 0);
          restoredPageIndex = Math.min(Math.max(Math.trunc(parsedDraft.pageIndex), 0), maxPageIndex);
        }

        if (typeof parsedDraft.savedAt === "string" && parsedDraft.savedAt.length > 0) {
          restoredSavedAt = parsedDraft.savedAt;
        }

        restored = true;
      }
    } catch {
      restored = false;
      restoredSavedAt = null;
    }

    if (session.lockedSector) {
      restoredGroups = {
        ...restoredGroups,
        sector: session.lockedSector.name,
      };
    } else if (!restoredGroups.sector) {
      const fallbackSector = pickPreselectedSector(session);
      if (fallbackSector) {
        restoredGroups.sector = fallbackSector;
      }
    }

    setAnswers(restoredAnswers);
    setGroups(restoredGroups);
    setPageIndex(restoredPageIndex);
    setRestoredFromDraft(restored);
    setLastAutoSavedAt(restoredSavedAt);
    setHydratedSessionSid(session.sessionSid);
  }, [draftStorageKey, hydratedSessionSid, session]);

  useEffect(() => {
    if (!session || !draftStorageKey || submitted) {
      return;
    }
    if (hydratedSessionSid !== session.sessionSid) {
      return;
    }

    const hasGroupValues = Object.values(groups).some((value) => value.trim().length > 0);
    const shouldPersist = Object.keys(answers).length > 0 || hasGroupValues || pageIndex > 0;

    const timeoutId = window.setTimeout(() => {
      try {
        if (!shouldPersist) {
          window.localStorage.removeItem(draftStorageKey);
          setLastAutoSavedAt(null);
          return;
        }

        const nextDraft: DraftPayload = {
          version: 1,
          savedAt: new Date().toISOString(),
          pageIndex,
          answers,
          groups: session.lockedSector ? { ...groups, sector: session.lockedSector.name } : groups,
        };
        window.localStorage.setItem(draftStorageKey, JSON.stringify(nextDraft));
        setLastAutoSavedAt(nextDraft.savedAt);
      } catch {
        // Ignore local storage failures.
      }
    }, AUTO_SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [answers, draftStorageKey, groups, hydratedSessionSid, pageIndex, session, submitted]);

  const currentQuestions = questionPages[pageIndex] ?? [];
  const isLastPage = pageIndex >= questionPages.length - 1;
  const pageRequiredCount = currentQuestions.filter((question) => question.required).length;
  const pageAnsweredRequired = currentQuestions.filter(
    (question) => question.required && answers[question.id] !== undefined,
  ).length;
  const canGoNext = pageAnsweredRequired >= pageRequiredCount;

  function setAnswer(questionId: string, value: number) {
    setAnswers((previous) => ({
      ...previous,
      [questionId]: value,
    }));
  }

  function setGroupValue(key: string, value: string) {
    setGroups((previous) => ({
      ...previous,
      [key]: value,
    }));
  }

  async function handleSubmit() {
    if (!session) {
      return;
    }
    setSubmitError("");
    setIsSubmitting(true);
    try {
      const payload = {
        campaignId: session.surveyId,
        turnstileToken,
        answers: session.questions
          .filter((question) => answers[question.id] !== undefined)
          .map((question) => ({
            questionId: question.id,
            value: Number(answers[question.id]),
          })),
        groups: session.lockedSector
          ? {
              ...groups,
              sector: session.lockedSector.name,
            }
          : groups,
      };

      const response = await fetch(`/api/public/surveys/${slug}/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorPayload = (await response.json()) as { error?: string };
        throw new Error(errorPayload.error ?? "Nao foi possivel enviar respostas.");
      }

      if (draftStorageKey) {
        try {
          window.localStorage.removeItem(draftStorageKey);
        } catch {
          // Ignore local storage failures.
        }
      }
      setLastAutoSavedAt(null);
      setRestoredFromDraft(false);
      setSubmitted(true);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Falha ao enviar respostas.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return <p className="text-sm text-[#5a6871]">Carregando questionario...</p>;
  }

  if (loadError || !session) {
    return <p className="text-sm text-red-600">{loadError || "Questionario indisponivel."}</p>;
  }

  if (submitted) {
    return (
      <div className="rounded-2xl border border-[#bdd8c5] bg-[#ecf6ef] p-4 text-[#1f5b38]">
        Respostas enviadas com sucesso. Obrigado pela participacao.
      </div>
    );
  }

  if (session.alreadySubmitted) {
    return (
      <div className="rounded-2xl border border-[#d4dbe3] bg-[#f2f5f8] p-4 text-[#314554]">
        Este formulario ja foi enviado neste dispositivo.
      </div>
    );
  }

  const likertValues = Array.from(
    { length: session.likert.max - session.likert.min + 1 },
    (_, index) => session.likert.min + index,
  );

  const isSubmitDisabled =
    isSubmitting ||
    answeredRequiredCount < requiredQuestionCount ||
    session.groups.some((group) => {
      if (group.key === "sector" && session.lockedSector) {
        return false;
      }
      return group.isRequired && !groups[group.key];
    });

  const visibleGroups = session.groups.filter(
    (group) => !(session.lockedSector && group.key === "sector"),
  );
  let autoSaveLabel = "Salvamento automatico ativo neste dispositivo.";
  if (lastAutoSavedAt) {
    const savedAtDate = new Date(lastAutoSavedAt);
    if (!Number.isNaN(savedAtDate.getTime())) {
      autoSaveLabel = `Ultimo autosave: ${savedAtDate.toLocaleTimeString()}.`;
    }
  }

  return (
    <div className="space-y-6">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
      />

      <header className="space-y-2 rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h1 className="text-2xl font-semibold text-[#141d24]">{session.title}</h1>
        <p className="text-sm text-[#4a5862]">
          Pesquisa anonima. Nao coletamos nome, email, matricula ou autenticacao do colaborador.
        </p>
        {session.lockedSector ? (
          <p className="inline-flex w-fit rounded-full border border-[#dfcfb0] bg-[#fbf5e9] px-3 py-1 text-xs font-semibold text-[#744d14]">
            Setor vinculado ao link: {session.lockedSector.name} (parametro{" "}
            {session.lockedSector.riskParameter.toFixed(2)})
          </p>
        ) : null}
        {restoredFromDraft ? (
          <p className="text-xs text-[#2f5e79]">Rascunho restaurado automaticamente.</p>
        ) : null}
        <p className="text-xs text-[#5a6871]">{autoSaveLabel}</p>
        <p className="text-xs text-[#5a6871]">
          Respostas obrigatorias: {answeredRequiredCount}/{requiredQuestionCount}
        </p>
        <p className="text-xs text-[#5a6871]">
          Pagina {Math.min(pageIndex + 1, questionPages.length)} de {questionPages.length}
        </p>
      </header>

      {visibleGroups.length > 0 && (
        <section className="space-y-4 rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[#141d24]">Dados de agrupamento</h2>
          {visibleGroups.map((group) => (
            <label key={group.key} className="block space-y-1">
              <span className="text-sm text-[#4a5862]">
                {group.label}
                {group.isRequired ? " *" : ""}
              </span>
              <select
                className="w-full rounded-xl border border-[#c8c8c8] bg-white p-2 text-sm"
                value={groups[group.key] ?? ""}
                onChange={(event) => setGroupValue(group.key, event.target.value)}
              >
                <option value="">Selecione...</option>
                {group.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </section>
      )}

      <section className="space-y-4">
        {currentQuestions.map((question) => (
          <article key={question.id} className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
            <p className="text-sm font-semibold text-[#141d24]">
              {question.position}. {question.prompt}
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {likertValues.map((value) => (
                <label
                  key={`${question.id}-${value}`}
                  className="flex items-center gap-2 rounded-xl border border-[#c8c8c8] bg-white px-3 py-2 text-sm text-[#1f2b34]"
                >
                  <input
                    type="radio"
                    name={question.id}
                    value={value}
                    checked={answers[question.id] === value}
                    onChange={() => setAnswer(question.id, value)}
                  />
                  {value}
                </label>
              ))}
            </div>
          </article>
        ))}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={pageIndex === 0}
          onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
          className="rounded-full border border-[#c8c8c8] bg-white px-4 py-2 text-sm font-semibold text-[#1b2832] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Pagina anterior
        </button>

        {!isLastPage ? (
          <button
            type="button"
            disabled={!canGoNext}
            onClick={() => setPageIndex((prev) => Math.min(prev + 1, questionPages.length - 1))}
            className="rounded-full bg-[#131313] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Proxima pagina
          </button>
        ) : null}
      </div>

      {isLastPage ? (
        <>
          <section className="space-y-3 rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
            <h2 className="text-base font-semibold text-[#141d24]">Validacao anti-bot</h2>
            <div
              className="cf-turnstile"
              data-sitekey={session.turnstileSiteKey}
              data-callback="onTurnstileSuccess"
            />
            <p className="text-xs text-[#5a6871]">
              Se o captcha nao carregar em ambiente local, habilite `TURNSTILE_BYPASS=true` apenas em
              desenvolvimento.
            </p>
          </section>

          {submitError && <p className="text-sm text-red-600">{submitError}</p>}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
            className="rounded-full bg-[#131313] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Enviando..." : "Enviar respostas"}
          </button>
        </>
      ) : null}
    </div>
  );
}
