"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type CompanyRiskProbabilityClass,
  type CompanyRiskProfileAnswers,
  type CompanyRiskProfileFactorScore,
} from "@/lib/company-risk-profile";

type RiskProfileReport = {
  id: string;
  questionnaireVersion: string;
  sector: string | null;
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

type RiskOccurrenceTrendSeries = {
  factorKey: string;
  factorLabel: string;
  points: Array<{
    reportId: string;
    createdAt: string;
    score: number;
    probabilityClass: CompanyRiskProbabilityClass;
    occurrenceProbability: 1 | 2 | 3;
  }>;
};

type RiskProfilePayload = {
  client: {
    id: string;
    companyName: string;
  };
  questionnaire: {
    version: string;
  };
  progress: {
    status: "not_started" | "in_progress" | "completed";
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
  reports: RiskProfileReport[];
  trendSeries: RiskOccurrenceTrendSeries[];
  reportsUnavailable?: boolean;
  progressUnavailable?: boolean;
};

type TrendCardModel = {
  factorKey: string;
  factorLabel: string;
  latestPoint: {
    createdAt: string;
    occurrenceProbability: 1 | 2 | 3;
    probabilityClass: CompanyRiskProbabilityClass;
  } | null;
  strokeColor: string;
  points: Array<{
    createdAt: string;
    x: number;
    y: number;
    probabilityClass: CompanyRiskProbabilityClass;
    occurrenceProbability: 1 | 2 | 3;
  }>;
  polyline: string;
};

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
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

function probabilityClassLabel(value: CompanyRiskProbabilityClass) {
  if (value === "baixa") return "Baixa";
  if (value === "media") return "Media";
  return "Alta";
}

function probabilityClassColor(value: CompanyRiskProbabilityClass) {
  if (value === "baixa") return "#2a7d2a";
  if (value === "media") return "#a56a0b";
  return "#b02323";
}

function statusLabel(value: RiskProfilePayload["progress"]["status"]) {
  if (value === "not_started") return "Nao iniciado";
  if (value === "in_progress") return "Em andamento";
  return "Concluido";
}

function parseIsoToMs(value: string): number | null {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function formatAxisLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("pt-BR", { month: "2-digit", year: "2-digit" }).format(date);
}

export function ManagerCompanyRiskProfile({ clientId }: { clientId: string }) {
  const [payload, setPayload] = useState<RiskProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [showSelectedResponses, setShowSelectedResponses] = useState(false);
  const [reassignAfterDays, setReassignAfterDays] = useState("30");
  const [isReassigning, setIsReassigning] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/clients/${clientId}/company-risk-profile`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as RiskProfilePayload & { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Nao foi possivel carregar os resultados de perfil de risco.");
      }
      setPayload(body);
      setSelectedReportId((previous) => previous ?? body.reports[0]?.id ?? null);
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar os dados.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedReport = useMemo(() => {
    if (!payload) return null;
    if (!selectedReportId) return payload.reports[0] ?? null;
    return payload.reports.find((report) => report.id === selectedReportId) ?? payload.reports[0] ?? null;
  }, [payload, selectedReportId]);

  const trendChartsModel = useMemo(() => {
    if (!payload || payload.trendSeries.length === 0) return null;

    const chartWidth = 420;
    const chartHeight = 246;
    const chartPadding = { left: 42, right: 16, top: 20, bottom: 42 };
    const plotWidth = chartWidth - chartPadding.left - chartPadding.right;
    const plotHeight = chartHeight - chartPadding.top - chartPadding.bottom;

    const parsedSeries = payload.trendSeries
      .map((series) => {
        const points = series.points
          .reduce<
            Array<
              RiskOccurrenceTrendSeries["points"][number] & {
                timeMs: number;
              }
            >
          >((acc, point) => {
            const timeMs = parseIsoToMs(point.createdAt);
            if (timeMs === null) return acc;
            acc.push({
              ...point,
              timeMs,
            });
            return acc;
          }, [])
          .sort((left, right) => left.timeMs - right.timeMs);
        return {
          factorKey: series.factorKey,
          factorLabel: series.factorLabel,
          points,
        };
      })
      .filter((series) => series.points.length > 0);

    if (parsedSeries.length === 0) return null;

    const allTimes = Array.from(
      new Set(parsedSeries.flatMap((series) => series.points.map((point) => point.timeMs))),
    ).sort((a, b) => a - b);
    if (allTimes.length === 0) return null;

    const minX = allTimes[0];
    const maxX = allTimes[allTimes.length - 1];
    const xSpan = Math.max(maxX - minX, 1);
    const xScale =
      allTimes.length === 1
        ? () => chartPadding.left + plotWidth / 2
        : (value: number) => chartPadding.left + ((value - minX) / xSpan) * plotWidth;

    const yMin = 1;
    const yMax = 3;
    const yScale = (value: number) =>
      chartPadding.top + (1 - (value - yMin) / Math.max(yMax - yMin, 1)) * plotHeight;

    const xTickTarget = Math.min(5, allTimes.length);
    const rawXTicks = Array.from({ length: xTickTarget }, (_, index) => {
      if (allTimes.length === 1) return allTimes[0];
      const sourceIndex = Math.round((index * (allTimes.length - 1)) / Math.max(xTickTarget - 1, 1));
      return allTimes[sourceIndex];
    });
    const xTicks = Array.from(new Set(rawXTicks))
      .sort((a, b) => a - b)
      .map((timeMs) => ({
        timeMs,
        x: xScale(timeMs),
        label: formatAxisLabel(new Date(timeMs).toISOString()),
      }));

    const yTicks = [1, 2, 3].map((value) => ({
      value,
      y: yScale(value),
    }));

    const cards: TrendCardModel[] = parsedSeries.map((series) => {
      const points = series.points.map((point) => ({
        createdAt: point.createdAt,
        probabilityClass: point.probabilityClass,
        occurrenceProbability: point.occurrenceProbability,
        x: xScale(point.timeMs),
        y: yScale(point.occurrenceProbability),
      }));
      const latestPoint = points[points.length - 1] ?? null;
      const strokeColor = probabilityClassColor(latestPoint?.probabilityClass ?? "media");

      return {
        factorKey: series.factorKey,
        factorLabel: series.factorLabel,
        latestPoint: latestPoint
          ? {
              createdAt: latestPoint.createdAt,
              occurrenceProbability: latestPoint.occurrenceProbability,
              probabilityClass: latestPoint.probabilityClass,
            }
          : null,
        strokeColor,
        points,
        polyline: points.map((point) => `${point.x},${point.y}`).join(" "),
      };
    });

    return {
      width: chartWidth,
      height: chartHeight,
      padding: chartPadding,
      xAxisY: chartHeight - chartPadding.bottom,
      yAxisX: chartPadding.left,
      xTicks,
      yTicks,
      cards,
    };
  }, [payload]);

  const reassignQuestionnaire = useCallback(async () => {
    const parsedDays = Number.parseInt(reassignAfterDays, 10);
    const cooldownDays = Number.isFinite(parsedDays) && parsedDays >= 0 ? parsedDays : 30;

    setIsReassigning(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/clients/${clientId}/company-risk-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reassign", cooldownDays }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        progress?: RiskProfilePayload["progress"];
        nextCycleAvailableAt?: string | null;
      };

      if (!response.ok || !body.progress) {
        throw new Error(body.error ?? "Nao foi possivel reatribuir o questionario.");
      }

      setPayload((previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          progress: body.progress ?? previous.progress,
        };
      });
      const availabilityLabel = formatDateTime(body.nextCycleAvailableAt ?? null);
      setNotice(
        cooldownDays > 0
          ? `Questionario reatribuido. Nova rodada disponivel em ${availabilityLabel}.`
          : "Questionario reatribuido para preenchimento imediato.",
      );
    } catch (reassignError) {
      setError(reassignError instanceof Error ? reassignError.message : "Falha ao reatribuir questionario.");
    } finally {
      setIsReassigning(false);
    }
  }, [clientId, reassignAfterDays]);

  if (loading) {
    return <p className="text-sm text-[#3d5a69]">Carregando resultados de perfil de risco...</p>;
  }

  if (error && !payload) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!payload) {
    return <p className="text-sm text-red-600">Dados indisponiveis.</p>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[#4f6977]">Perfil de risco da empresa</p>
            <h2 className="mt-1 text-2xl font-semibold text-[#123447]">{payload.client.companyName}</h2>
            <p className="mt-1 text-xs text-[#4f6977]">Versao do questionario: {payload.questionnaire.version}</p>
          </div>
          <Link
            href={`/manager/clients/${clientId}?tab=company-data`}
            className="rounded-full border border-[#c9dce8] px-4 py-2 text-xs font-semibold text-[#123447]"
          >
            Voltar para company data
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Resultado do questionario (cliente)</h3>
        {payload.reportsUnavailable ? (
          <p className="mt-3 text-sm text-[#8a5b2d]">
            Tabela de resultados indisponivel. Aplique a migration{" "}
            <code>20260305233000_company_risk_profile_reports.sql</code>.
          </p>
        ) : payload.reports.length === 0 ? (
          <p className="mt-3 text-sm text-[#5a7383]">Nenhum questionario enviado pelo cliente ainda.</p>
        ) : (
          <>
            {selectedReport ? (
              <article className="mt-3 rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[#123447]">
                    Ultimo resultado selecionado | {formatDateTime(selectedReport.createdAt)}
                  </p>
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${probabilityClassTone(selectedReport.overallClass)}`}
                  >
                    {probabilityClassLabel(selectedReport.overallClass)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[#153748]">
                  Probabilidade geral de ocorrencia: <strong>{selectedReport.overallScore.toFixed(2)}</strong>
                  {selectedReport.sector ? ` | Setor: ${selectedReport.sector}` : ""}
                </p>
                <p className="mt-1 text-xs text-[#4f6977]">
                  Baixa: {selectedReport.summaryCounts.baixa} | Media: {selectedReport.summaryCounts.media} | Alta:{" "}
                  {selectedReport.summaryCounts.alta}
                </p>
                {selectedReport.notes ? <p className="mt-1 text-xs text-[#4f6977]">Notas: {selectedReport.notes}</p> : null}

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
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b bg-[#f8fbfd]">
                        <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Risco psicossocial</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Score</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Probabilidade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedReport.factorScores.map((factorScore) => (
                        <tr key={`${selectedReport.id}-${factorScore.factorKey}`} className="border-b last:border-b-0">
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
                    {selectedReport.factorScores.map((factorScore) => (
                      <article
                        key={`responses-${selectedReport.id}-${factorScore.factorKey}`}
                        className="rounded-xl border border-[#d8e4ee] bg-white p-3"
                      >
                        <h4 className="text-sm font-semibold text-[#123447]">{factorScore.factorLabel}</h4>
                        <div className="mt-2 overflow-x-auto">
                          <table className="min-w-full text-xs">
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
            ) : null}

            <div className="mt-4 overflow-x-auto rounded-xl border border-[#d8e4ee]">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b bg-[#f8fbfd]">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Data</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Setor</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Score geral</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Probabilidade</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Avaliador</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Acao</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.reports.map((report) => (
                    <tr key={report.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2 text-[#123447]">{formatDateTime(report.createdAt)}</td>
                      <td className="px-3 py-2 text-[#123447]">{report.sector ?? "-"}</td>
                      <td className="px-3 py-2 text-[#123447]">{report.overallScore.toFixed(2)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${probabilityClassTone(report.overallClass)}`}
                        >
                          {probabilityClassLabel(report.overallClass)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[#123447]">
                        {report.createdByRole === "client" ? "Cliente" : "Gestor"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedReportId(report.id);
                              setShowSelectedResponses(false);
                            }}
                            className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447]"
                          >
                            Ver resumo
                          </button>
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
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Reatribuir questionario ao cliente</h3>
        {payload.progressUnavailable ? (
          <p className="mt-3 text-sm text-[#8a5b2d]">
            Fluxo de progresso indisponivel. Aplique a migration{" "}
            <code>20260305235000_company_risk_profile_client_flow.sql</code>.
          </p>
        ) : (
          <>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <article className="rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
                <p className="text-xs text-[#4f6977]">Status atual</p>
                <p className="mt-1 text-sm font-semibold text-[#123447]">{statusLabel(payload.progress.status)}</p>
              </article>
              <article className="rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
                <p className="text-xs text-[#4f6977]">Ultima conclusao</p>
                <p className="mt-1 text-sm font-semibold text-[#123447]">{formatDateTime(payload.progress.completedAt)}</p>
              </article>
              <article className="rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
                <p className="text-xs text-[#4f6977]">Nova rodada disponivel em</p>
                <p className="mt-1 text-sm font-semibold text-[#123447]">
                  {formatDateTime(payload.progress.nextCycleAvailableAt)}
                </p>
              </article>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-2">
              <label className="text-xs text-[#4f6977]">
                Reabrir apos quantos dias
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={reassignAfterDays}
                  onChange={(event) => setReassignAfterDays(event.target.value)}
                  className="mt-1 w-40 rounded border border-[#c9dce8] px-3 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                onClick={() => void reassignQuestionnaire()}
                disabled={isReassigning}
                className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {isReassigning ? "Reatribuindo..." : "Reatribuir questionario"}
              </button>
            </div>
          </>
        )}

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        {notice ? <p className="mt-2 text-sm text-[#1f6b2f]">{notice}</p> : null}
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">
          Serie temporal de probabilidade de ocorrencia por risco psicossocial
        </h3>
        <p className="mt-1 text-xs text-[#4f6977]">
          Grade de charts (tempo x score de risco) para apoiar analise de tendencia no estilo DRPS.
        </p>

        {!trendChartsModel || trendChartsModel.cards.length === 0 ? (
          <p className="mt-3 text-sm text-[#5a7383]">Sem historico suficiente para construir os charts.</p>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {trendChartsModel.cards.map((card) => (
              <article key={`trend-card-${card.factorKey}`} className="rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold text-[#123447]">{card.factorLabel}</h4>
                  {card.latestPoint ? (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${probabilityClassTone(card.latestPoint.probabilityClass)}`}
                    >
                      P{card.latestPoint.occurrenceProbability} {probabilityClassLabel(card.latestPoint.probabilityClass)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-[#5f7785]">
                  Ultima medicao: {formatDateTime(card.latestPoint?.createdAt ?? null)}
                </p>

                <svg viewBox={`0 0 ${trendChartsModel.width} ${trendChartsModel.height}`} className="mt-2 h-[220px] w-full">
                  {trendChartsModel.yTicks.map((tick) => (
                    <g key={`y-${card.factorKey}-${tick.value}`}>
                      <line
                        x1={trendChartsModel.padding.left}
                        y1={tick.y}
                        x2={trendChartsModel.width - trendChartsModel.padding.right}
                        y2={tick.y}
                        stroke="#e7eef2"
                        strokeWidth={1}
                      />
                      <text
                        x={trendChartsModel.padding.left - 8}
                        y={tick.y + 4}
                        textAnchor="end"
                        fontSize={10}
                        fill="#5f7785"
                      >
                        {tick.value}
                      </text>
                    </g>
                  ))}

                  {trendChartsModel.xTicks.map((tick) => (
                    <g key={`x-${card.factorKey}-${tick.timeMs}`}>
                      <line
                        x1={tick.x}
                        y1={trendChartsModel.padding.top}
                        x2={tick.x}
                        y2={trendChartsModel.xAxisY}
                        stroke="#f0f4f7"
                        strokeWidth={1}
                      />
                      <text x={tick.x} y={trendChartsModel.height - 20} textAnchor="middle" fontSize={10} fill="#5f7785">
                        {tick.label}
                      </text>
                    </g>
                  ))}

                  <line
                    x1={trendChartsModel.padding.left}
                    y1={trendChartsModel.xAxisY}
                    x2={trendChartsModel.width - trendChartsModel.padding.right}
                    y2={trendChartsModel.xAxisY}
                    stroke="#9fb8c6"
                    strokeWidth={1}
                  />
                  <line
                    x1={trendChartsModel.yAxisX}
                    y1={trendChartsModel.padding.top}
                    x2={trendChartsModel.yAxisX}
                    y2={trendChartsModel.xAxisY}
                    stroke="#9fb8c6"
                    strokeWidth={1}
                  />

                  {card.polyline.length > 0 ? (
                    <polyline fill="none" stroke={card.strokeColor} strokeWidth={2.4} points={card.polyline} />
                  ) : null}

                  {card.points.map((point) => (
                    <g key={`point-${card.factorKey}-${point.createdAt}`}>
                      <circle cx={point.x} cy={point.y} r={3.8} fill={probabilityClassColor(point.probabilityClass)} />
                    </g>
                  ))}
                </svg>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
