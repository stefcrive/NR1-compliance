"use client";

import Script from "next/script";
import { useEffect, useMemo, useState } from "react";

type SessionPayload = {
  surveyId: string;
  slug: string;
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

declare global {
  interface Window {
    onTurnstileSuccess?: (token: string) => void;
  }
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

  useEffect(() => {
    let ignore = false;
    async function loadSession() {
      setIsLoading(true);
      setLoadError("");
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
          setPageIndex(0);
          if (payload.lockedSector) {
            setGroups((previous) => ({
              ...previous,
              sector: payload.lockedSector?.name ?? "",
            }));
          }
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

  const QUESTIONS_PER_PAGE = 5;

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
