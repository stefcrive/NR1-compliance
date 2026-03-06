"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type CompanyRiskProbabilityClass,
  type CompanyRiskProfileAnswers,
  type CompanyRiskProfileFactorDefinition,
  type CompanyRiskProfileFactorScore,
  type CompanyRiskProfileQuestionDefinition,
  computeCompanyRiskProfile,
  countAnsweredCompanyRiskProfileAnswers,
  normalizeCompanyRiskProfileAnswers,
  totalCompanyRiskProfileQuestions,
} from "@/lib/company-risk-profile";

type ClientRiskProfileReport = {
  id: string;
  questionnaireVersion: string;
  notes: string | null;
  answers: CompanyRiskProfileAnswers;
  factorScores: CompanyRiskProfileFactorScore[];
  summaryCounts: {
    baixa: number;
    media: number;
    alta: number;
  };
  overallScore: number;
  overallClass: CompanyRiskProbabilityClass;
  createdByRole: "manager" | "client";
  createdByEmail: string | null;
  createdAt: string;
};

type ClientRiskProfilePayload = {
  client: {
    id: string;
    companyName: string;
    clientSlug: string;
  };
  questionnaire: {
    version: string;
    factors: CompanyRiskProfileFactorDefinition[];
    questions: CompanyRiskProfileQuestionDefinition[];
  };
  progress: {
    status: "not_started" | "in_progress" | "completed";
    answers: CompanyRiskProfileAnswers;
    completionRatio: number;
    startedAt: string | null;
    completedAt: string | null;
    lastSavedAt: string | null;
    lastSkippedAt: string | null;
    lastReminderAt: string | null;
    latestReportId: string | null;
    nextCycleAvailableAt: string | null;
    updatedAt: string | null;
  };
  latestReport: {
    id: string;
    questionnaireVersion: string;
    notes: string | null;
    overallScore: number;
    overallClass: CompanyRiskProbabilityClass;
    createdAt: string;
  } | null;
  reports: ClientRiskProfileReport[];
  progressUnavailable?: boolean;
  reportsUnavailable?: boolean;
};

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function probabilityClassLabel(value: CompanyRiskProbabilityClass) {
  if (value === "baixa") return "Baixa";
  if (value === "media") return "Media";
  return "Alta";
}

function probabilityClassTone(value: CompanyRiskProbabilityClass) {
  if (value === "baixa") {
    return "border-[#bfdcbc] bg-[#ecf8ec] text-[#215f21]";
  }
  if (value === "media") {
    return "border-[#e8d6ad] bg-[#fff7e8] text-[#8a5c10]";
  }
  return "border-[#e1b8b8] bg-[#fdf0f0] text-[#8a2d2d]";
}

export function ClientCompanyRiskProfile({ clientSlug }: { clientSlug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [payload, setPayload] = useState<ClientRiskProfilePayload | null>(null);
  const [answers, setAnswers] = useState<CompanyRiskProfileAnswers>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [factorPageIndex, setFactorPageIndex] = useState(0);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [showSelectedResponses, setShowSelectedResponses] = useState(false);

  const fromOnboarding = searchParams.get("from") === "onboarding";
  const fromHistory = searchParams.get("from") === "history";
  const historyReportId = searchParams.get("reportId");
  const historyReadOnlyMode = fromHistory || Boolean(historyReportId);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const query = new URLSearchParams();
      query.set("touchReminder", "0");
      if (historyReadOnlyMode) {
        query.set("includeReports", "1");
      }
      const response = await fetch(
        `/api/client/portal/${encodeURIComponent(clientSlug)}/company-risk-profile?${query.toString()}`,
        { cache: "no-store" },
      );
      const body = (await response.json().catch(() => ({}))) as ClientRiskProfilePayload & { error?: string };
      if (!response.ok || !body.questionnaire) {
        throw new Error(body.error ?? "Nao foi possivel carregar o questionario da empresa.");
      }
      setPayload(body);
      const normalized = normalizeCompanyRiskProfileAnswers(body.progress?.answers ?? {}, {
        allowIncomplete: true,
      });
      setAnswers(normalized);
      const firstPendingFactorIndex = body.questionnaire.factors.findIndex((factor) =>
        body.questionnaire.questions.some((question) => (normalized[factor.key]?.[question.key] ?? -1) < 0),
      );
      setFactorPageIndex(firstPendingFactorIndex >= 0 ? firstPendingFactorIndex : 0);
      setSelectedReportId((previous) => historyReportId ?? previous ?? body.reports[0]?.id ?? null);
      setShowSelectedResponses(Boolean(historyReportId));
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar questionario.");
    } finally {
      setLoading(false);
    }
  }, [clientSlug, historyReadOnlyMode, historyReportId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totalQuestions = useMemo(() => totalCompanyRiskProfileQuestions(), []);
  const answeredCount = useMemo(() => countAnsweredCompanyRiskProfileAnswers(answers), [answers]);
  const isComplete = payload?.progress.status === "completed";
  const factorCount = payload?.questionnaire.factors.length ?? 0;
  const isCycleLocked = useMemo(() => {
    if (!payload?.progress.latestReportId) return false;
    const nextCycle = payload?.progress.nextCycleAvailableAt;
    if (!nextCycle) return false;
    const nextCycleMs = new Date(nextCycle).getTime();
    if (!Number.isFinite(nextCycleMs)) return false;
    return nextCycleMs > Date.now();
  }, [payload?.progress.latestReportId, payload?.progress.nextCycleAvailableAt]);

  useEffect(() => {
    if (factorCount === 0) {
      setFactorPageIndex(0);
      return;
    }
    setFactorPageIndex((previous) => Math.max(0, Math.min(previous, factorCount - 1)));
  }, [factorCount]);

  const currentFactor = useMemo(() => {
    if (!payload) return null;
    return payload.questionnaire.factors[factorPageIndex] ?? null;
  }, [factorPageIndex, payload]);

  const currentFactorAnsweredCount = useMemo(() => {
    if (!payload || !currentFactor) return 0;
    return payload.questionnaire.questions.filter(
      (question) => (answers[currentFactor.key]?.[question.key] ?? -1) >= 0,
    ).length;
  }, [answers, currentFactor, payload]);

  const currentFactorQuestionsCount = payload?.questionnaire.questions.length ?? 0;
  const isLastFactorPage = factorCount > 0 && factorPageIndex >= factorCount - 1;
  const canGoNextPage =
    currentFactorQuestionsCount > 0 && currentFactorAnsweredCount >= currentFactorQuestionsCount;

  const preview = useMemo(() => {
    if (!payload || answeredCount !== totalQuestions || totalQuestions === 0) return null;
    try {
      return computeCompanyRiskProfile(answers);
    } catch {
      return null;
    }
  }, [answers, answeredCount, payload, totalQuestions]);

  const selectedHistoryReport = useMemo(() => {
    if (!payload) return null;
    if (payload.reports.length === 0) return null;
    const targetId = historyReportId ?? selectedReportId;
    if (!targetId) return payload.reports[0] ?? null;
    return payload.reports.find((report) => report.id === targetId) ?? payload.reports[0] ?? null;
  }, [historyReportId, payload, selectedReportId]);

  const onAnswerChange = useCallback(
    (factorKey: string, questionKey: string, rawValue: string) => {
      const parsed = Number.parseInt(rawValue, 10);
      const optionIndex = Number.isFinite(parsed) ? parsed : -1;
      setAnswers((previous) => ({
        ...previous,
        [factorKey]: {
          ...(previous[factorKey] ?? {}),
          [questionKey]: optionIndex,
        },
      }));
    },
    [],
  );

  const saveProgress = useCallback(
    async (action: "save" | "skip") => {
      if (!payload) return;
      setSaving(true);
      setError("");
      setNotice("");
      try {
        const response = await fetch(`/api/client/portal/${encodeURIComponent(clientSlug)}/company-risk-profile`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, answers }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          progress?: ClientRiskProfilePayload["progress"];
        };
        if (!response.ok || !body.progress) {
          throw new Error(body.error ?? "Nao foi possivel salvar o progresso.");
        }
        setPayload((previous) => {
          if (!previous) return previous;
          return { ...previous, progress: body.progress! };
        });

        if (action === "skip") {
          router.push(`/client/${clientSlug}/company`);
          return;
        }

        setNotice("Progresso salvo. Voce pode continuar depois.");
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "Falha ao salvar progresso.");
      } finally {
        setSaving(false);
      }
    },
    [answers, clientSlug, payload, router],
  );

  const completeQuestionnaire = useCallback(async () => {
    if (!payload) return;
    if (answeredCount !== totalQuestions) {
      setError("Preencha todas as respostas antes de concluir.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/client/portal/${encodeURIComponent(clientSlug)}/company-risk-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        progress?: ClientRiskProfilePayload["progress"];
        report?: ClientRiskProfilePayload["latestReport"];
      };
      if (!response.ok || !body.progress) {
        throw new Error(body.error ?? "Nao foi possivel concluir o questionario.");
      }

      setPayload((previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          progress: body.progress!,
          latestReport: body.report ?? previous.latestReport,
        };
      });
      setNotice("Questionario concluido com sucesso.");
      router.push(`/client/${clientSlug}/company?riskProfileCompleted=1`);
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "Falha ao concluir questionario.");
    } finally {
      setSaving(false);
    }
  }, [answers, answeredCount, clientSlug, payload, router, totalQuestions]);

  if (loading) {
    return <p className="text-sm text-[#3d5a69]">Carregando questionario da empresa...</p>;
  }

  if (error && !payload) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!payload) {
    return <p className="text-sm text-red-600">Questionario indisponivel.</p>;
  }

  if (payload.progressUnavailable && !historyReadOnlyMode) {
    return (
      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <p className="text-sm text-[#8a5b2d]">
          O fluxo do questionario da empresa ainda nao esta disponivel neste ambiente.
        </p>
        <p className="mt-2 text-xs text-[#8a5b2d]">
          Aplique a migration <code>20260305235000_company_risk_profile_client_flow.sql</code>.
        </p>
      </section>
    );
  }

  if (historyReadOnlyMode) {
    return (
      <div className="space-y-6">
        <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
          <div className="space-y-3">
            <nav className="text-xs text-[#4f6977]" aria-label="Breadcrumb">
              <Link href={`/client/${clientSlug}/history`} className="font-semibold text-[#0f5b73] hover:underline">
                Historico
              </Link>
              <span className="px-1 text-[#8aa4b5]">/</span>
              <span className="font-semibold text-[#123447]">Perfil de risco da empresa</span>
            </nav>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[#4f6977]">Perfil de risco da empresa</p>
              <h2 className="mt-1 text-2xl font-semibold text-[#123447]">{payload.client.companyName}</h2>
              <p className="mt-1 text-xs text-[#4f6977]">Versao do questionario: {payload.questionnaire.version}</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#123447]">Questionario concluido (somente leitura)</h3>
          {payload.reportsUnavailable ? (
            <p className="mt-3 text-sm text-[#8a5b2d]">
              Tabela de resultados indisponivel. Aplique a migration{" "}
              <code>20260305233000_company_risk_profile_reports.sql</code>.
            </p>
          ) : payload.reports.length === 0 ? (
            <p className="mt-3 text-sm text-[#5a7383]">Nenhum questionario concluido encontrado.</p>
          ) : selectedHistoryReport ? (
            <>
              <article className="mt-3 rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[#123447]">
                    Resultado selecionado | {formatDateTime(selectedHistoryReport.createdAt)}
                  </p>
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${probabilityClassTone(selectedHistoryReport.overallClass)}`}
                  >
                    {probabilityClassLabel(selectedHistoryReport.overallClass)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[#153748]">
                  Probabilidade geral de ocorrencia: <strong>{selectedHistoryReport.overallScore.toFixed(2)}</strong>
                </p>
                <p className="mt-1 text-xs text-[#4f6977]">
                  Baixa: {selectedHistoryReport.summaryCounts.baixa} | Media: {selectedHistoryReport.summaryCounts.media} | Alta:{" "}
                  {selectedHistoryReport.summaryCounts.alta}
                </p>
                {selectedHistoryReport.notes ? (
                  <p className="mt-1 text-xs text-[#4f6977]">Notas: {selectedHistoryReport.notes}</p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSelectedResponses((previous) => !previous)}
                    className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                  >
                    {showSelectedResponses ? "Ocultar respostas" : "Ver respostas do questionario"}
                  </button>
                </div>

                <div className="mt-3 overflow-x-auto rounded-xl border border-[#d8e4ee] bg-white">
                  <table className="nr-table min-w-full text-sm">
                    <thead>
                      <tr className="border-b bg-[#f8fbfd]">
                        <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Risco psicossocial</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Score</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Probabilidade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedHistoryReport.factorScores.map((factorScore) => (
                        <tr key={`${selectedHistoryReport.id}-${factorScore.factorKey}`} className="border-b last:border-b-0">
                          <td className="px-3 py-2 text-[#123447]">{factorScore.factorLabel}</td>
                          <td className="px-3 py-2 text-[#123447]">{factorScore.score.toFixed(2)}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${probabilityClassTone(factorScore.probabilityClass)}`}
                            >
                              {probabilityClassLabel(factorScore.probabilityClass)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {showSelectedResponses ? (
                  <div className="mt-4 space-y-3 rounded-xl border border-[#cfe2ec] bg-[#f4f9fc] p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4f6977]">
                      Respostas detalhadas
                    </p>
                    {selectedHistoryReport.factorScores.map((factorScore) => (
                      <article
                        key={`responses-${selectedHistoryReport.id}-${factorScore.factorKey}`}
                        className="rounded-xl border border-[#d8e4ee] bg-white p-3"
                      >
                        <h4 className="text-sm font-semibold text-[#123447]">{factorScore.factorLabel}</h4>
                        <div className="mt-2 overflow-x-auto">
                          <table className="nr-table min-w-full text-xs">
                            <thead>
                              <tr className="border-b bg-[#f8fbfd]">
                                <th className="px-2 py-2 text-left text-[#4f6977]">Criterio</th>
                                <th className="px-2 py-2 text-left text-[#4f6977]">Pergunta</th>
                                <th className="px-2 py-2 text-left text-[#4f6977]">Resposta marcada</th>
                                <th className="px-2 py-2 text-left text-[#4f6977]">Score</th>
                              </tr>
                            </thead>
                            <tbody>
                              {factorScore.questionScores.map((questionScore) => (
                                <tr
                                  key={`response-row-${factorScore.factorKey}-${questionScore.questionKey}`}
                                  className="border-b last:border-b-0"
                                >
                                  <td className="px-2 py-2 text-[#123447]">{questionScore.criterion}</td>
                                  <td className="px-2 py-2 text-[#123447]">{questionScore.prompt}</td>
                                  <td className="px-2 py-2 text-[#123447]">{questionScore.optionLabel}</td>
                                  <td className="px-2 py-2 text-[#123447]">{questionScore.score.toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </article>

              <div className="mt-4 overflow-x-auto rounded-xl border border-[#d8e4ee]">
                <table className="nr-table min-w-full text-sm">
                  <thead>
                    <tr className="border-b bg-[#f8fbfd]">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Data</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Score geral</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Probabilidade</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Acao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.reports.map((report) => (
                      <tr key={report.id} className="border-b last:border-b-0">
                        <td className="px-3 py-2 text-[#123447]">{formatDateTime(report.createdAt)}</td>
                        <td className="px-3 py-2 text-[#123447]">{report.overallScore.toFixed(2)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${probabilityClassTone(report.overallClass)}`}
                          >
                            {probabilityClassLabel(report.overallClass)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedReportId(report.id);
                              setShowSelectedResponses(true);
                            }}
                            className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                          >
                            Ver respostas
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-[#5a7383]">Nao foi possivel localizar este questionario no historico.</p>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[#4f6977]">Perfil de risco da empresa</p>
            <h2 className="mt-1 text-2xl font-semibold text-[#123447]">{payload.client.companyName}</h2>
            <p className="mt-1 text-xs text-[#4f6977]">Versao: {payload.questionnaire.version}</p>
          </div>
          <Link
            href={`/client/${clientSlug}/company`}
            className="rounded-full border border-[#c9dce8] px-4 py-2 text-xs font-semibold text-[#123447]"
          >
            Voltar ao home
          </Link>
        </div>

        {fromOnboarding ? (
          <div className="mt-3 rounded-xl border border-[#cfe2ec] bg-[#f4f9fc] p-3 text-sm text-[#153748]">
            Conta criada com sucesso. Complete este questionario agora ou salve para concluir depois.
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <article className="rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
            <p className="text-xs text-[#4f6977]">Status</p>
            <p className="mt-1 text-sm font-semibold text-[#123447]">
              {isComplete ? "Concluido" : payload.progress.status === "in_progress" ? "Em andamento" : "Nao iniciado"}
            </p>
          </article>
          <article className="rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
            <p className="text-xs text-[#4f6977]">Progresso</p>
            <p className="mt-1 text-sm font-semibold text-[#123447]">
              {answeredCount}/{totalQuestions}
            </p>
          </article>
          <article className="rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
            <p className="text-xs text-[#4f6977]">Ultimo salvamento</p>
            <p className="mt-1 text-sm font-semibold text-[#123447]">{formatDateTime(payload.progress.lastSavedAt)}</p>
          </article>
          <article className="rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
            <p className="text-xs text-[#4f6977]">Pagina</p>
            <p className="mt-1 text-sm font-semibold text-[#123447]">
              {Math.min(factorPageIndex + 1, Math.max(factorCount, 1))}/{Math.max(factorCount, 1)}
            </p>
          </article>
        </div>
      </section>

      {isComplete ? (
        <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#123447]">Questionario concluido</h3>
          {payload.latestReport ? (
            <div className="mt-3 rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${probabilityClassTone(payload.latestReport.overallClass)}`}>
                  {probabilityClassLabel(payload.latestReport.overallClass)}
                </span>
                <p className="text-sm text-[#123447]">
                  Score geral: <strong>{payload.latestReport.overallScore.toFixed(2)}</strong>
                </p>
              </div>
              <p className="mt-1 text-xs text-[#4f6977]">
                Concluido em: {formatDateTime(payload.latestReport.createdAt)}
              </p>
            </div>
          ) : null}
          <div className="mt-4">
            <Link
              href={`/client/${clientSlug}/company`}
              className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
            >
              Voltar ao workspace
            </Link>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#123447]">Questionario</h3>
          <p className="mt-2 text-xs text-[#4f6977]">
            Responda de 1 a 5 para cada pergunta, no formato em linha.
          </p>
          {isCycleLocked ? (
            <p className="mt-2 rounded-xl border border-[#f1d8ad] bg-[#fff8ea] px-3 py-2 text-xs text-[#8a5b2d]">
              Nova rodada liberada em {formatDateTime(payload.progress.nextCycleAvailableAt)}.
            </p>
          ) : null}

          {currentFactor ? (
            <article className="mt-4 rounded-xl border border-[#d8e4ee] bg-[#fbfdff] p-4">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-base font-semibold text-[#123447]">{currentFactor.label}</h4>
                <p className="text-xs text-[#4f6977]">
                  Topico {factorPageIndex + 1} de {factorCount}
                </p>
              </header>

              <div className="mt-3 space-y-3">
                {payload.questionnaire.questions.map((question, questionIndex) => {
                  const selectedIndex = answers[currentFactor.key]?.[question.key] ?? -1;
                  return (
                    <article
                      key={`${currentFactor.key}-${question.key}`}
                      className="rounded-xl border border-[#d8e4ee] bg-white p-4"
                    >
                      <p className="text-xs font-semibold text-[#4f6977]">
                        Pergunta {questionIndex + 1} | {question.criterion}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-[#123447]">{question.prompt}</p>
                      <div className="mt-3 flex flex-nowrap gap-2 overflow-x-auto pb-1">
                        {question.options.map((option, optionIndex) => {
                          const selected = selectedIndex === optionIndex;
                          return (
                            <label
                              key={`${question.key}-${optionIndex}`}
                              className={`flex min-w-[150px] shrink-0 cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                                selected
                                  ? "border-[#1e5266] bg-[#eaf4f8] text-[#103243]"
                                  : "border-[#c8cfd4] bg-white text-[#1f2b34]"
                              }`}
                            >
                              <input
                                type="radio"
                                name={`${currentFactor.key}-${question.key}`}
                                value={String(optionIndex)}
                                checked={selected}
                                disabled={isCycleLocked}
                                onChange={(event) =>
                                  onAnswerChange(currentFactor.key, question.key, event.target.value)
                                }
                                className="mt-0.5"
                              />
                              <span className="space-y-0.5">
                                <span className="block font-semibold">{optionIndex + 1}</span>
                                <span className="block text-xs text-[#51636d]">{option}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>
            </article>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={factorPageIndex === 0 || isCycleLocked}
              onClick={() => setFactorPageIndex((previous) => Math.max(previous - 1, 0))}
              className="rounded-full border border-[#c9dce8] px-4 py-2 text-xs font-semibold text-[#123447] disabled:opacity-50"
            >
              Topico anterior
            </button>
            {!isLastFactorPage ? (
              <button
                type="button"
                disabled={!canGoNextPage || isCycleLocked}
                onClick={() =>
                  setFactorPageIndex((previous) => Math.min(previous + 1, Math.max(factorCount - 1, 0)))
                }
                className="rounded-full border border-[#c9dce8] px-4 py-2 text-xs font-semibold text-[#123447] disabled:opacity-50"
              >
                Proximo topico
              </button>
            ) : (
              <p className="text-xs text-[#4f6977]">Ultimo topico.</p>
            )}
          </div>

          {preview ? (
            <div className="mt-4 rounded-xl border border-[#cfe2ec] bg-[#f4f9fc] p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-[#4f6977]">Previa</p>
              <p className="mt-1 text-sm text-[#123447]">
                Score geral: <strong>{preview.overallScore.toFixed(2)}</strong> | Classe: <strong>{probabilityClassLabel(preview.overallClass)}</strong>
              </p>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveProgress("save")}
              disabled={saving || isCycleLocked}
              className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Salvar e continuar depois"}
            </button>
            <button
              type="button"
              onClick={() => void completeQuestionnaire()}
              disabled={saving || isCycleLocked}
              className="rounded-full border border-[#b7dca3] px-4 py-2 text-xs font-semibold text-[#2d5f23] disabled:opacity-50"
            >
              Concluir questionario
            </button>
            <button
              type="button"
              onClick={() => void saveProgress("skip")}
              disabled={saving || isCycleLocked}
              className="rounded-full border border-[#c9dce8] px-4 py-2 text-xs font-semibold text-[#123447] disabled:opacity-50"
            >
              Pular por agora
            </button>
          </div>

          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          {notice ? <p className="mt-2 text-sm text-[#1f6b2f]">{notice}</p> : null}
        </section>
      )}
    </div>
  );
}
