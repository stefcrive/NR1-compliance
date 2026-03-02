"use client";

import { useEffect, useMemo, useState } from "react";

type CampaignOption = {
  id: string;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
};

type TopicRow = {
  topicId: number;
  nResponses: number;
  meanSeverity: number | null;
  meanProbability: number | null;
  severityClass: "low" | "medium" | "high" | null;
  probabilityClass: "low" | "medium" | "high" | null;
  risk: "low" | "medium" | "high" | "critical" | null;
};

type SectorRow = {
  sector: string;
  sectorId: string | null;
  sectorKey: string | null;
  riskParameter: number;
  accessLink: string | null;
  submissionCount: number;
  lastSubmittedAt: string | null;
  nResponses: number;
  suppressed: boolean;
  adjustedRiskIndex: number | null;
  adjustedRiskClass: "low" | "medium" | "high" | null;
  topics: TopicRow[];
};

type PortalPayload = {
  survey: {
    id: string;
    name: string;
    slug: string;
    kAnonymityMin: number;
  };
  totals: {
    responses: number;
    topics: number;
    activeSectors: number;
  };
  riskDistribution: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  topics: TopicRow[];
  responseTimeseries: Array<{ day: string; response_count: number }>;
  sectors: SectorRow[];
  drps: {
    id: string;
    sector: string;
    reference_period: string;
    part1_probability_score: number;
    part1_probability_class: "low" | "medium" | "high";
    recommended_programs: string[];
    governance_actions: string[];
    created_at: string;
  } | null;
};

const RISK_COLORS: Record<string, string> = {
  low: "#3d9962",
  medium: "#c79a2f",
  high: "#d86b2d",
  critical: "#b83f3f",
};

const TOPIC_LABELS: Record<number, string> = {
  1: "Assedio",
  2: "Suporte",
  3: "Mudancas",
  4: "Clareza",
  5: "Reconhecimento",
  6: "Autonomia",
  7: "Justica",
  8: "Traumaticos",
  9: "Subcarga",
  10: "Sobrecarga",
  11: "Relacionamentos",
  12: "Comunicacao",
  13: "Remoto/isolado",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

function riskTone(risk: string | null) {
  if (!risk) {
    return "border-slate-200 bg-slate-50 text-slate-600";
  }
  const table: Record<string, string> = {
    low: "border-emerald-200 bg-emerald-50 text-emerald-700",
    medium: "border-amber-200 bg-amber-50 text-amber-700",
    high: "border-orange-200 bg-orange-50 text-orange-700",
    critical: "border-rose-200 bg-rose-50 text-rose-700",
  };
  return table[risk] ?? "border-slate-200 bg-slate-50 text-slate-600";
}

function normalizeRiskLabel(risk: string | null) {
  if (!risk) {
    return "n/a";
  }
  const labels: Record<string, string> = {
    low: "baixo",
    medium: "medio",
    high: "alto",
    critical: "critico",
  };
  return labels[risk] ?? risk;
}

export function ClientPortalDashboard() {
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("demo-nr1-2026");
  const [payload, setPayload] = useState<PortalPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    async function loadCampaigns() {
      try {
        const response = await fetch("/api/admin/campaigns", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { campaigns: CampaignOption[] };
        if (ignore) {
          return;
        }
        const liveCampaigns = (data.campaigns ?? []).filter((item) => item.status === "live");
        setCampaigns(liveCampaigns);
        if (liveCampaigns.length > 0 && !liveCampaigns.some((item) => item.public_slug === selectedSlug)) {
          setSelectedSlug(liveCampaigns[0].public_slug);
        }
      } catch {
        // silent
      }
    }
    void loadCampaigns();
    return () => {
      ignore = true;
    };
  }, [selectedSlug]);

  useEffect(() => {
    let ignore = false;
    async function loadPortal() {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/admin/surveys/${selectedSlug}/portal`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Nao foi possivel carregar dados do dashboard.");
        }
        const data = (await response.json()) as PortalPayload;
        if (!ignore) {
          setPayload(data);
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : "Erro ao carregar dashboard.");
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }
    void loadPortal();
    return () => {
      ignore = true;
    };
  }, [selectedSlug]);

  const sortedTopics = useMemo(
    () => (payload ? [...payload.topics].sort((a, b) => (b.meanSeverity ?? 0) - (a.meanSeverity ?? 0)) : []),
    [payload],
  );

  const chartModel = useMemo(() => {
    if (!payload || payload.responseTimeseries.length === 0) {
      return null;
    }
    const width = 760;
    const height = 220;
    const maxY = Math.max(...payload.responseTimeseries.map((item) => item.response_count), 1);

    const points = payload.responseTimeseries.map((point, index) => {
      const x = (index / Math.max(payload.responseTimeseries.length - 1, 1)) * width;
      const y = height - (point.response_count / maxY) * height;
      return { x, y, value: point.response_count, day: point.day };
    });

    const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
    const area = `0,${height} ${polyline} ${width},${height}`;

    return {
      width,
      height,
      maxY,
      points,
      polyline,
      area,
    };
  }, [payload]);

  const topSector = useMemo(() => {
    if (!payload) {
      return null;
    }
    return (
      payload.sectors
        .filter((sector) => !sector.suppressed && sector.adjustedRiskIndex !== null)
        .slice()
        .sort((a, b) => (b.adjustedRiskIndex ?? 0) - (a.adjustedRiskIndex ?? 0))[0] ?? null
    );
  }, [payload]);

  if (isLoading) {
    return <p className="text-sm text-[#345466]">Carregando dashboard...</p>;
  }
  if (error || !payload) {
    return <p className="text-sm text-red-600">{error || "Dashboard indisponivel."}</p>;
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-[#c8dde9] bg-[radial-gradient(1200px_300px_at_100%_-60%,#b9dce9_0%,transparent_55%),linear-gradient(120deg,#f8fcff_0%,#eef7fb_48%,#fff5e8_100%)] p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.22em] text-[#0f6077]">Painel executivo</p>
            <h2 className="text-3xl font-semibold tracking-tight text-[#122f3d]">{payload.survey.name}</h2>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-[#d6e8f2] bg-white px-3 py-1 text-xs font-medium text-[#315667]">
                k-anonimato minimo {payload.survey.kAnonymityMin}
              </span>
              <span className="rounded-full border border-[#d6e8f2] bg-white px-3 py-1 text-xs font-medium text-[#315667]">
                setores ativos {payload.totals.activeSectors}
              </span>
              {topSector ? (
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${riskTone(
                    topSector.adjustedRiskClass,
                  )}`}
                >
                  setor prioritario {topSector.sector} ({topSector.adjustedRiskIndex?.toFixed(2)})
                </span>
              ) : null}
            </div>
          </div>
          <label className="space-y-1 rounded-2xl border border-[#d7e7ef] bg-white/90 p-3 shadow-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[#315768]">
              Campanha ativa
            </span>
            <select
              className="min-w-[260px] rounded-xl border border-[#c8dbe7] bg-white px-3 py-2 text-sm text-[#163a4c]"
              value={selectedSlug}
              onChange={(event) => setSelectedSlug(event.target.value)}
            >
              {[
                ...campaigns,
                {
                  id: payload.survey.id,
                  name: payload.survey.name,
                  public_slug: payload.survey.slug,
                  status: "live" as const,
                },
              ]
                .filter(
                  (value, index, array) =>
                    array.findIndex((item) => item.public_slug === value.public_slug) === index,
                )
                .map((campaign) => (
                  <option key={campaign.id} value={campaign.public_slug}>
                    {campaign.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <article className="rounded-2xl border border-[#d9e7ef] bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.15em] text-[#4f6977]">Respostas</p>
          <p className="mt-2 text-3xl font-semibold text-[#133748]">{payload.totals.responses}</p>
        </article>
        <article className="rounded-2xl border border-[#d9e7ef] bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.15em] text-[#4f6977]">Topicos medidos</p>
          <p className="mt-2 text-3xl font-semibold text-[#133748]">{payload.totals.topics}</p>
        </article>
        <article className="rounded-2xl border border-[#d9e7ef] bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.15em] text-[#4f6977]">Risco alto/critico</p>
          <p className="mt-2 text-3xl font-semibold text-[#133748]">
            {payload.riskDistribution.high + payload.riskDistribution.critical}
          </p>
        </article>
        <article className="rounded-2xl border border-[#d9e7ef] bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.15em] text-[#4f6977]">Setores monitorados</p>
          <p className="mt-2 text-3xl font-semibold text-[#133748]">{payload.sectors.length}</p>
        </article>
        <article className="rounded-2xl border border-[#d9e7ef] bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.15em] text-[#4f6977]">Ultimo DRPS</p>
          <p className="mt-2 text-sm font-semibold text-[#133748]">
            {payload.drps ? formatDate(payload.drps.created_at) : "Nao preenchido"}
          </p>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <article className="rounded-2xl border border-[#d9e7ef] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-[#123447]">Evolucao de respostas (30 dias)</h3>
            <p className="text-xs text-[#4f6977]">janela diaria</p>
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-[#edf3f7] bg-[#f9fcfe] p-3">
            {chartModel ? (
              <svg
                viewBox={`0 0 ${chartModel.width} ${chartModel.height + 20}`}
                className="h-[240px] w-full min-w-[760px]"
              >
                <defs>
                  <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4fa8c2" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#4fa8c2" stopOpacity="0.04" />
                  </linearGradient>
                </defs>
                {[0, 0.25, 0.5, 0.75, 1].map((step) => {
                  const y = chartModel.height * step;
                  return (
                    <line
                      key={step}
                      x1={0}
                      y1={y}
                      x2={chartModel.width}
                      y2={y}
                      stroke="#dbe8f0"
                      strokeDasharray="3 6"
                      strokeWidth={1}
                    />
                  );
                })}
                <polygon points={chartModel.area} fill="url(#lineFill)" />
                <polyline fill="none" stroke="#0d6077" strokeWidth="3" points={chartModel.polyline} />
                {chartModel.points.map((point, index) => (
                  <circle
                    key={`${point.day}-${index}`}
                    cx={point.x}
                    cy={point.y}
                    r={2.8}
                    fill="#0d6077"
                    opacity={0.9}
                  />
                ))}
              </svg>
            ) : (
              <p className="p-4 text-sm text-[#4f6977]">Sem dados de respostas no periodo.</p>
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-[#d9e7ef] bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#123447]">Distribuicao por nivel de risco</h3>
          <div className="mt-4 space-y-3">
            {Object.entries(payload.riskDistribution).map(([risk, count]) => (
              <div key={risk} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="capitalize text-[#335362]">{normalizeRiskLabel(risk)}</span>
                  <span className="font-semibold text-[#153749]">{count}</span>
                </div>
                <div className="h-2.5 rounded-full bg-[#edf3f7]">
                  <div
                    className="h-2.5 rounded-full transition-all duration-500"
                    style={{
                      width: `${(count / Math.max(payload.totals.topics, 1)) * 100}%`,
                      backgroundColor: RISK_COLORS[risk],
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          {payload.drps ? (
            <div className="mt-5 rounded-xl border border-[#ddeaf1] bg-[#f8fbfd] p-3 text-sm text-[#2f5060]">
              <p>
                DRPS mais recente: <strong>{payload.drps.reference_period}</strong>
              </p>
              <p className="mt-1">
                Probabilidade qualitativa:{" "}
                <strong>
                  {payload.drps.part1_probability_score.toFixed(2)} (
                  {payload.drps.part1_probability_class})
                </strong>
              </p>
            </div>
          ) : null}
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <article className="rounded-2xl border border-[#d9e7ef] bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#123447]">Topicos por gravidade media</h3>
          <div className="mt-4 space-y-3">
            {sortedTopics.map((topic, index) => (
              <div key={topic.topicId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#2e4e5e]">
                    #{index + 1} T{String(topic.topicId).padStart(2, "0")} -{" "}
                    {TOPIC_LABELS[topic.topicId] ?? "Topico"}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[#14394b]">
                      {(topic.meanSeverity ?? 0).toFixed(2)}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${riskTone(topic.risk)}`}>
                      {normalizeRiskLabel(topic.risk)}
                    </span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-[#edf3f7]">
                  <div
                    className="h-2 rounded-full bg-[#0f6077]"
                    style={{
                      width: `${((topic.meanSeverity ?? 0) / 5) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-[#d9e7ef] bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#123447]">DRPS tecnico</h3>
          {!payload.drps ? (
            <p className="mt-4 text-sm text-[#456373]">Ainda nao ha DRPS registrado para esta campanha.</p>
          ) : (
            <div className="mt-4 space-y-3 text-sm">
              <p className="text-[#2f5060]">
                Setor: <strong>{payload.drps.sector}</strong>
              </p>
              <p className="text-[#2f5060]">
                Periodo: <strong>{payload.drps.reference_period}</strong>
              </p>
              <div>
                <p className="font-semibold text-[#194154]">Programas recomendados</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[#2f5060]">
                  {payload.drps.recommended_programs.slice(0, 6).map((program) => (
                    <li key={program}>{program}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </article>
      </section>

      <section className="rounded-2xl border border-[#d9e7ef] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-[#123447]">Risco por setor com parametro configurado</h3>
          <p className="text-xs text-[#4f6977]">parametro aplicado no calculo de indice setorial</p>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {payload.sectors.map((sector) => {
            const topTopic =
              sector.topics
                .slice()
                .sort((a, b) => (b.meanSeverity ?? 0) - (a.meanSeverity ?? 0))[0] ?? null;

            return (
              <article key={`${sector.sector}-${sector.sectorKey ?? "legacy"}`} className="rounded-xl border border-[#e2edf3] bg-[#fbfdff] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#1a4253]">{sector.sector}</p>
                    <p className="mt-1 text-xs text-[#4e6979]">{sector.nResponses} respostas validas</p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${riskTone(sector.adjustedRiskClass)}`}>
                    {sector.adjustedRiskClass ? normalizeRiskLabel(sector.adjustedRiskClass) : "sem indice"}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-[#e2edf3] bg-white p-2">
                    <p className="text-[#5c7381]">Parametro</p>
                    <p className="mt-1 font-semibold text-[#1f4252]">{sector.riskParameter.toFixed(2)}x</p>
                  </div>
                  <div className="rounded-lg border border-[#e2edf3] bg-white p-2">
                    <p className="text-[#5c7381]">Indice ajustado</p>
                    <p className="mt-1 font-semibold text-[#1f4252]">
                      {sector.adjustedRiskIndex !== null ? sector.adjustedRiskIndex.toFixed(2) : "n/a"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[#e2edf3] bg-white p-2">
                    <p className="text-[#5c7381]">Uso do token</p>
                    <p className="mt-1 font-semibold text-[#1f4252]">{sector.submissionCount}</p>
                  </div>
                  <div className="rounded-lg border border-[#e2edf3] bg-white p-2">
                    <p className="text-[#5c7381]">Token ativo</p>
                    <p className="mt-1 font-semibold text-[#1f4252]">
                      {sector.accessLink ? "sim" : "nao"}
                    </p>
                  </div>
                </div>

                {sector.nResponses === 0 ? (
                  <p className="mt-3 text-xs text-[#6b8290]">Sem respostas registradas para este setor.</p>
                ) : sector.suppressed ? (
                  <p className="mt-3 text-xs text-[#8a5d00]">
                    Oculto por k-anonimato (n &lt; {payload.survey.kAnonymityMin}).
                  </p>
                ) : (
                  <p className="mt-3 text-xs text-[#4e6979]">
                    Topico mais critico:{" "}
                    <strong>
                      {topTopic
                        ? `T${String(topTopic.topicId).padStart(2, "0")} - ${
                            TOPIC_LABELS[topTopic.topicId] ?? "Topico"
                          }`
                        : "n/a"}
                    </strong>
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
