"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { findProgramById, listAssignedPrograms } from "@/lib/programs-catalog";

type Diagnostic = {
  id: string;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  starts_at: string | null;
  closes_at: string | null;
  employeeFormLink?: string;
};

type TopicRow = {
  topicId: number;
  meanSeverity: number | null;
  risk: "low" | "medium" | "high" | "critical" | null;
};

type SectorRow = {
  sector: string;
  nResponses: number;
  adjustedRiskIndex: number | null;
  adjustedRiskClass: "low" | "medium" | "high" | null;
};

type ClientPortalPayload = {
  client: {
    companyName: string;
    cnpj: string;
    status: string;
    totalEmployees: number;
    remoteEmployees: number;
    onsiteEmployees: number;
    hybridEmployees: number;
  };
  campaigns: Diagnostic[];
  selectedCampaign: Diagnostic | null;
  dashboard: {
    totals: { responses: number; topics: number; activeSectors: number };
    riskDistribution: { low: number; medium: number; high: number; critical: number };
    topics: TopicRow[];
    sectors: SectorRow[];
  } | null;
};

type EvaluationEntry = {
  createdAt: string;
  scores: number[];
};

function fmtDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

function useClientPortalData(clientSlug: string, campaignId?: string, reloadToken = 0) {
  const [data, setData] = useState<ClientPortalPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    async function load() {
      setIsLoading(true);
      setError("");
      try {
        const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
        const response = await fetch(`/api/client/portal/${clientSlug}${query}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Could not load client data.");
        }
        const payload = (await response.json()) as ClientPortalPayload;
        if (!ignore) {
          setData(payload);
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : "Could not load client data.");
          setData(null);
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [campaignId, clientSlug, reloadToken]);

  return { data, isLoading, error };
}

function questionnaireCollectionStatus(status: Diagnostic["status"]) {
  if (status === "live") return "Questionario aberto (coletando respostas)";
  if (status === "closed") return "Questionario fechado";
  if (status === "draft") return "Questionario em rascunho";
  return "Questionario arquivado";
}

function RiskBadge({ risk }: { risk: "low" | "medium" | "high" | "critical" | null | undefined }) {
  const classes =
    risk === "low"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : risk === "medium"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : risk === "high"
          ? "border-orange-200 bg-orange-50 text-orange-700"
          : risk === "critical"
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-slate-200 bg-slate-50 text-slate-600";
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${classes}`}>{risk ?? "n/a"}</span>;
}

export function ClientCompanyDataSection({ clientSlug }: { clientSlug: string }) {
  const { data, isLoading, error } = useClientPortalData(clientSlug);

  if (isLoading) return <p className="text-sm text-[#49697a]">Loading company data...</p>;
  if (error || !data) return <p className="text-sm text-red-600">{error || "Company data unavailable."}</p>;

  const total = Math.max(data.client.totalEmployees, 1);
  const remotePct = Math.round((data.client.remoteEmployees / total) * 100);
  const onsitePct = Math.round((data.client.onsiteEmployees / total) * 100);
  const hybridPct = Math.round((data.client.hybridEmployees / total) * 100);

  return (
    <div className="space-y-6">
      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">Company Data</h2>
        <p className="mt-1 text-sm text-[#475660]">
          {data.client.companyName} | CNPJ {data.client.cnpj} | Status {data.client.status}
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <article className="rounded-2xl border border-[#dfdfdf] bg-[#f8f8f8] p-4 shadow-sm">
          <p className="text-xs text-[#4f6977]">Total employees</p>
          <p className="mt-1 text-2xl font-semibold text-[#133748]">{data.client.totalEmployees}</p>
        </article>
        <article className="rounded-2xl border border-[#dfdfdf] bg-[#f8f8f8] p-4 shadow-sm">
          <p className="text-xs text-[#4f6977]">Home office ratio</p>
          <p className="mt-1 text-2xl font-semibold text-[#133748]">{remotePct}%</p>
        </article>
        <article className="rounded-2xl border border-[#dfdfdf] bg-[#f8f8f8] p-4 shadow-sm">
          <p className="text-xs text-[#4f6977]">Presential ratio</p>
          <p className="mt-1 text-2xl font-semibold text-[#133748]">{onsitePct}%</p>
        </article>
        <article className="rounded-2xl border border-[#dfdfdf] bg-[#f8f8f8] p-4 shadow-sm">
          <p className="text-xs text-[#4f6977]">Hybrid ratio</p>
          <p className="mt-1 text-2xl font-semibold text-[#133748]">{hybridPct}%</p>
        </article>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">Metricas por setor (ultimo diagnostico DRPS)</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Department</th>
                <th className="px-2 py-2 text-left">Responses</th>
                <th className="px-2 py-2 text-left">Adjusted risk index</th>
                <th className="px-2 py-2 text-left">Risk class</th>
              </tr>
            </thead>
            <tbody>
              {(data.dashboard?.sectors ?? []).map((sector) => (
                <tr key={sector.sector} className="border-b">
                  <td className="px-2 py-2">{sector.sector}</td>
                  <td className="px-2 py-2">{sector.nResponses}</td>
                  <td className="px-2 py-2">
                    {sector.adjustedRiskIndex !== null ? sector.adjustedRiskIndex.toFixed(2) : "-"}
                  </td>
                  <td className="px-2 py-2">
                    <RiskBadge risk={sector.adjustedRiskClass} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function ClientDiagnosticStatusSection({ clientSlug }: { clientSlug: string }) {
  const [selectedDiagnosticId, setSelectedDiagnosticId] = useState<string | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);
  const { data, isLoading, error } = useClientPortalData(clientSlug, selectedDiagnosticId, reloadToken);
  const [copiedDiagnosticId, setCopiedDiagnosticId] = useState<string | null>(null);

  async function copyEmployeeLink(diagnostic: Diagnostic) {
    const link = diagnostic.employeeFormLink ?? `${window.location.origin}/s/${diagnostic.public_slug}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedDiagnosticId(diagnostic.id);
      window.setTimeout(() => setCopiedDiagnosticId(null), 1500);
    } catch {
      // no-op on copy failure to keep dashboard usable
    }
  }

  if (isLoading) return <p className="text-sm text-[#49697a]">Carregando diagnosticos DRPS...</p>;
  if (error || !data) return <p className="text-sm text-red-600">{error || "Diagnostic unavailable."}</p>;
  const openCampaigns = data.campaigns.filter((campaign) => campaign.status === "live");
  const hasClosedCampaigns = data.campaigns.some((campaign) => campaign.status === "closed");

  return (
    <div className="space-y-6">
      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">Diagnosticos DRPS (status e resultados)</h2>
        <p className="mt-1 text-sm text-[#475660]">
          Diagnosticos DRPS atribuidos pelo gestor com status de coleta e acesso ao resultado.
        </p>
        <p className="mt-1 text-xs text-[#5a7383]">
          {data.selectedCampaign
            ? `Questionario atual: ${questionnaireCollectionStatus(data.selectedCampaign.status)}`
            : "Sem questionario selecionado."}
        </p>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Diagnostico</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Janela</th>
                <th className="px-2 py-2 text-left">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {openCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-3 text-[#5a7383]">
                    {hasClosedCampaigns
                      ? "Nao ha questionarios abertos. Os diagnosticos existentes estao fechados."
                      : "Nenhum diagnostico DRPS atribuido."}
                  </td>
                </tr>
              ) : (
                openCampaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-b">
                    <td className="px-2 py-2">{campaign.name}</td>
                    <td className="px-2 py-2">{questionnaireCollectionStatus(campaign.status)}</td>
                    <td className="px-2 py-2">
                      {fmtDate(campaign.starts_at)} - {fmtDate(campaign.closes_at)}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void copyEmployeeLink(campaign)}
                          className="rounded-full border border-[#b9d8a5] px-3 py-1 text-xs font-semibold text-[#2d5f23]"
                        >
                          {copiedDiagnosticId === campaign.id ? "Link copiado" : "Gerar link colaboradores"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDiagnosticId(campaign.id);
                            setReloadToken((previous) => previous + 1);
                          }}
                          className="rounded-full border border-[#c8c8c8] px-3 py-1 text-xs font-semibold text-[#1b2832]"
                        >
                          Ver
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function ClientDiagnosticResultsSection({
  clientSlug,
  campaignId,
}: {
  clientSlug: string;
  campaignId: string;
}) {
  const { data, isLoading, error } = useClientPortalData(clientSlug, campaignId);

  if (isLoading) return <p className="text-sm text-[#49697a]">Carregando resultados do diagnostico...</p>;
  if (error || !data) return <p className="text-sm text-red-600">{error || "Resultados indisponiveis."}</p>;

  const campaign = data.selectedCampaign;
  const dashboard = data.dashboard;
  const topics = (dashboard?.topics ?? [])
    .slice()
    .sort((a, b) => (b.meanSeverity ?? 0) - (a.meanSeverity ?? 0))
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <nav className="text-xs text-[#4f6977]">
        <Link href={`/client/${clientSlug}/diagnostic`} className="text-[#1b2832]">
          Diagnosticos DRPS
        </Link>{" "}
        &gt; <span>{campaign?.name ?? "Diagnostico"}</span> &gt; <span>Resultados</span>
      </nav>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">{campaign?.name ?? "Resultados do diagnostico"}</h2>
        <p className="mt-1 text-sm text-[#475660]">
          Responses {dashboard?.totals.responses ?? 0} | Topics {dashboard?.totals.topics ?? 0} |
          Setores ativos {dashboard?.totals.activeSectors ?? 0}
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#141d24]">Risk distribution</h3>
          <div className="mt-4 space-y-3">
            {Object.entries(dashboard?.riskDistribution ?? {}).map(([risk, count]) => (
              <div key={risk} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="capitalize text-[#475660]">{risk}</span>
                  <span className="font-semibold text-[#141d24]">{count}</span>
                </div>
                <div className="h-2 rounded-full bg-[#edf3f7]">
                  <div
                    className={`h-2 rounded-full ${
                      risk === "low"
                        ? "bg-emerald-500"
                        : risk === "medium"
                          ? "bg-amber-500"
                          : risk === "high"
                            ? "bg-orange-500"
                            : "bg-rose-500"
                    }`}
                    style={{
                      width: `${(count / Math.max(dashboard?.totals.topics ?? 1, 1)) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#141d24]">Department heatmap</h3>
          <div className="mt-3 space-y-2">
            {(dashboard?.sectors ?? []).map((sector) => (
              <div key={sector.sector} className="rounded-xl border border-[#e3edf3] p-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-[#141d24]">{sector.sector}</p>
                  <RiskBadge risk={sector.adjustedRiskClass} />
                </div>
                <p className="mt-1 text-xs text-[#54707f]">
                  Responses {sector.nResponses} | Index{" "}
                  {sector.adjustedRiskIndex !== null ? sector.adjustedRiskIndex.toFixed(2) : "n/a"}
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">Most critical topics</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Topic</th>
                <th className="px-2 py-2 text-left">Mean severity</th>
                <th className="px-2 py-2 text-left">Risk</th>
              </tr>
            </thead>
            <tbody>
              {topics.map((topic) => (
                <tr key={topic.topicId} className="border-b">
                  <td className="px-2 py-2">Topic {topic.topicId}</td>
                  <td className="px-2 py-2">
                    {topic.meanSeverity !== null ? topic.meanSeverity.toFixed(2) : "-"}
                  </td>
                  <td className="px-2 py-2">
                    <RiskBadge risk={topic.risk} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function ClientProgramsListSection({ clientSlug }: { clientSlug: string }) {
  const assigned = listAssignedPrograms(clientSlug);

  return (
    <div className="space-y-6">
      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">Programas Continuos (Campanhas)</h2>
        <p className="mt-1 text-sm text-[#475660]">
          Campanhas preventivas e interventivas atribuidas pelo gestor.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {assigned.map((assignment) => {
          const program = findProgramById(assignment.programId);
          if (!program) return null;

          return (
            <article key={assignment.campaignCode} className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.15em] text-[#55707f]">{assignment.campaignCode}</p>
              <h3 className="mt-1 text-xl font-semibold text-[#141d24]">{program.name}</h3>
              <p className="mt-1 text-sm text-[#3e5b6b]">{program.summary}</p>
              <p className="mt-2 text-xs text-[#55707f]">
                {assignment.status} | {fmtDate(assignment.startDate)} - {fmtDate(assignment.endDate)}
              </p>
              <Link
                href={`/client/${clientSlug}/programs/${program.id}`}
                className="mt-4 inline-flex rounded-full border border-[#c8c8c8] px-4 py-2 text-xs font-semibold text-[#1b2832]"
              >
                Abrir detalhes
              </Link>
            </article>
          );
        })}
      </section>
    </div>
  );
}

export function ClientProgramDetailsSection({
  clientSlug,
  programId,
}: {
  clientSlug: string;
  programId: string;
}) {
  const program = findProgramById(programId);
  const assignment = listAssignedPrograms(clientSlug).find((item) => item.programId === programId) ?? null;
  const storageKey = `nr1-program-evals:${clientSlug}:${programId}`;
  const [scores, setScores] = useState<Record<number, number>>({});
  const [entries, setEntries] = useState<EvaluationEntry[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as EvaluationEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [error, setError] = useState("");

  const averageByQuestion = useMemo(() => {
    if (!program || entries.length === 0) return [] as number[];
    return program.evaluationQuestions.map((_, index) => {
      const values = entries.map((entry) => entry.scores[index]).filter((value) => typeof value === "number");
      if (values.length === 0) return 0;
      return values.reduce((acc, value) => acc + value, 0) / values.length;
    });
  }, [entries, program]);

  const overallAverage = useMemo(() => {
    if (averageByQuestion.length === 0) return 0;
    return averageByQuestion.reduce((acc, value) => acc + value, 0) / averageByQuestion.length;
  }, [averageByQuestion]);

  function submitEvaluation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!program) return;
    const answers = program.evaluationQuestions.map((_, index) => scores[index] ?? 0);
    if (answers.some((value) => value < 1 || value > 5)) {
      setError("Answer all evaluation questions from 1 to 5.");
      return;
    }
    const nextEntries = [...entries, { createdAt: new Date().toISOString(), scores: answers }];
    setEntries(nextEntries);
    localStorage.setItem(storageKey, JSON.stringify(nextEntries));
    setScores({});
    setError("");
  }

  if (!program || !assignment) {
    return <p className="text-sm text-red-600">Program not assigned for this client.</p>;
  }

  return (
    <div className="space-y-6">
      <nav className="text-xs text-[#4f6977]">
        <Link href={`/client/${clientSlug}/programs`} className="text-[#1b2832]">
          Programas Continuos
        </Link>{" "}
        &gt; <span>{program.name}</span>
      </nav>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">{program.name}</h2>
        <p className="mt-1 text-sm text-[#475660]">{program.summary}</p>
        <p className="mt-2 text-xs text-[#55707f]">
          {assignment.campaignCode} | {fmtDate(assignment.startDate)} - {fmtDate(assignment.endDate)}
        </p>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">Program chronogram</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Milestone</th>
                <th className="px-2 py-2 text-left">Date</th>
                <th className="px-2 py-2 text-left">Owner</th>
              </tr>
            </thead>
            <tbody>
              {program.chronogram.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="px-2 py-2">{item.label}</td>
                  <td className="px-2 py-2">{fmtDate(item.date)}</td>
                  <td className="px-2 py-2">{item.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">Materials</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {program.materials.map((item) => (
            <li key={item.id} className="flex items-center justify-between rounded-xl border border-[#e3edf3] px-3 py-2">
              <span>
                {item.title} <span className="text-xs text-[#54707f]">({item.type})</span>
              </span>
              <a
                href={item.downloadUrl}
                className="rounded-full border border-[#c8c8c8] px-3 py-1 text-xs font-semibold text-[#1b2832]"
              >
                Download
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">Short evaluation questionnaire</h3>
        <form onSubmit={submitEvaluation} className="mt-3 space-y-4">
          {program.evaluationQuestions.map((question, index) => (
            <label key={question} className="block space-y-1">
              <span className="text-sm text-[#475660]">{question}</span>
              <select
                value={scores[index] ?? ""}
                onChange={(event) =>
                  setScores((prev) => ({ ...prev, [index]: Number(event.target.value || 0) }))
                }
                className="w-full rounded-xl border border-[#c9dce8] px-3 py-2 text-sm"
              >
                <option value="">Select score</option>
                <option value="1">1 - Very low</option>
                <option value="2">2 - Low</option>
                <option value="3">3 - Medium</option>
                <option value="4">4 - Good</option>
                <option value="5">5 - Excellent</option>
              </select>
            </label>
          ))}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            className="rounded-full bg-[#131313] px-4 py-2 text-sm font-semibold text-white"
          >
            Submit evaluation
          </button>
        </form>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">Effectiveness metrics</h3>
        <p className="mt-1 text-sm text-[#475660]">Submissions: {entries.length}</p>
        <p className="mt-1 text-sm text-[#475660]">
          Overall average: {entries.length ? overallAverage.toFixed(2) : "-"} / 5.00
        </p>
        <div className="mt-4 space-y-3">
          {program.evaluationQuestions.map((question, index) => {
            const avg = averageByQuestion[index] ?? 0;
            return (
              <div key={question} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-[#475660]">{question}</span>
                  <span className="font-semibold text-[#141d24]">
                    {entries.length ? avg.toFixed(2) : "-"}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[#edf3f7]">
                  <div className="h-2 rounded-full bg-[#131313]" style={{ width: `${(avg / 5) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}



