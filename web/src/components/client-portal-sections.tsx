"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
    billingStatus?: string;
    totalEmployees: number;
    remoteEmployees: number;
    onsiteEmployees: number;
    hybridEmployees: number;
    contractStartDate?: string | null;
    contractEndDate?: string | null;
    updatedAt?: string | null;
  };
  assignedPrograms?: Array<{
    id: string;
    programId: string;
    status: "Recommended" | "Active" | "Completed";
    deployedAt: string | null;
    programTitle: string;
    programDescription: string | null;
    targetRiskTopic: number | null;
    triggerThreshold: number | null;
    scheduleFrequency: string;
    scheduleAnchorDate: string | null;
  }>;
  campaigns: Diagnostic[];
  selectedCampaign: Diagnostic | null;
  dashboard: {
    totals: { responses: number; topics: number; activeSectors: number };
    riskDistribution: { low: number; medium: number; high: number; critical: number };
    topics: TopicRow[];
    sectors: SectorRow[];
  } | null;
  reports?: Array<{
    id: string;
    report_title: string;
    status: "draft" | "processing" | "ready" | "failed";
    created_at: string;
  }>;
  invoices?: Array<{
    id: string;
    amount: number;
    status: "Paid" | "Pending" | "Overdue";
    dueDate: string;
  }>;
};

type EvaluationEntry = {
  createdAt: string;
  scores: number[];
};

type SectorLink = {
  id: string;
  name: string;
  accessLink: string;
  isActive: boolean;
  submissionCount: number;
  lastSubmittedAt: string | null;
};

type SectorPayload = {
  campaign: { id: string; name: string; slug: string };
  sectors: SectorLink[];
};

function fmtDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

function fmtDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function fmtCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function csvEscape(value: string | number | null): string {
  if (value === null) return "";
  return `"${String(value).replace(/"/g, '""')}"`;
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
  const router = useRouter();
  const { data, isLoading, error } = useClientPortalData(clientSlug);
  const [openDiagnosticActionsFor, setOpenDiagnosticActionsFor] = useState<string | null>(null);
  const [linksPayload, setLinksPayload] = useState<SectorPayload | null>(null);
  const [isLinksModalOpen, setIsLinksModalOpen] = useState(false);
  const [isLoadingLinksFor, setIsLoadingLinksFor] = useState<string | null>(null);
  const [copiedSectorId, setCopiedSectorId] = useState<string | null>(null);
  const [actionsError, setActionsError] = useState("");

  async function loadQuestionnaireLinks(diagnostic: Diagnostic) {
    setIsLoadingLinksFor(diagnostic.id);
    setActionsError("");
    setLinksPayload(null);
    setIsLinksModalOpen(false);
    try {
      const response = await fetch(
        `/api/client/portal/${clientSlug}/campaigns/${diagnostic.id}/sectors`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setActionsError("Falha ao carregar links do questionario.");
        return;
      }
      setLinksPayload((await response.json()) as SectorPayload);
      setCopiedSectorId(null);
      setIsLinksModalOpen(true);
    } catch {
      setActionsError("Falha ao carregar links do questionario.");
    } finally {
      setIsLoadingLinksFor(null);
    }
  }

  async function copySectorLink(sector: SectorLink) {
    await navigator.clipboard.writeText(sector.accessLink);
    setCopiedSectorId(sector.id);
    window.setTimeout(() => setCopiedSectorId(null), 1200);
  }

  async function copyAllLinks() {
    if (!linksPayload) return;
    const lines = linksPayload.sectors
      .filter((sector) => sector.isActive)
      .map((sector) => `${sector.name}: ${sector.accessLink}`);
    await navigator.clipboard.writeText(lines.join("\n"));
  }

  function exportLinksCsv() {
    if (!linksPayload) return;
    const header = ["campaign_id", "campaign_slug", "sector", "active", "submission_count", "access_link"].join(
      ",",
    );
    const rows = linksPayload.sectors.map((sector) =>
      [
        csvEscape(linksPayload.campaign.id),
        csvEscape(linksPayload.campaign.slug),
        csvEscape(sector.name),
        csvEscape(sector.isActive ? "true" : "false"),
        csvEscape(sector.submissionCount),
        csvEscape(sector.accessLink),
      ].join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${linksPayload.campaign.slug || linksPayload.campaign.id}-links-questionario.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function closeLinksModal() {
    setIsLinksModalOpen(false);
    setCopiedSectorId(null);
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
                      <div className="relative inline-flex">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenDiagnosticActionsFor((previous) =>
                              previous === campaign.id ? null : campaign.id,
                            )
                          }
                          className="rounded-full border border-[#c8c8c8] px-3 py-1 text-xs font-semibold text-[#1b2832]"
                        >
                          ...
                        </button>
                        {openDiagnosticActionsFor === campaign.id ? (
                          <div className="absolute right-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-xl border border-[#d9d9d9] bg-white shadow-lg">
                            <button
                              type="button"
                              onClick={() => {
                                setOpenDiagnosticActionsFor(null);
                                router.push(`/client/${clientSlug}/diagnostic/${campaign.id}`);
                              }}
                              className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#1b2832] hover:bg-[#f5f6f7]"
                            >
                              Ver resultados
                            </button>
                            <button
                              type="button"
                              disabled={isLoadingLinksFor === campaign.id}
                              onClick={() => {
                                setOpenDiagnosticActionsFor(null);
                                void loadQuestionnaireLinks(campaign);
                              }}
                              className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#5a2b8a] hover:bg-[#f8f2ff] disabled:cursor-not-allowed disabled:text-[#9aa6af]"
                            >
                              {isLoadingLinksFor === campaign.id
                                ? "Carregando..."
                                : "Gerar links questionario"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      {actionsError ? <p className="text-sm text-red-600">{actionsError}</p> : null}
      {isLinksModalOpen && linksPayload ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          onClick={closeLinksModal}
        >
          <div
            className="w-full max-w-5xl rounded-2xl border border-[#d9d9d9] bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-lg font-semibold text-[#141d24]">
                Links do questionario: {linksPayload.campaign.name}
              </h4>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyAllLinks()}
                  className="rounded-full border border-[#b9d8a5] px-3 py-1 text-xs font-semibold text-[#2d5f23]"
                >
                  Copiar todos
                </button>
                <button
                  type="button"
                  onClick={exportLinksCsv}
                  className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                >
                  Exportar CSV
                </button>
                <button
                  type="button"
                  onClick={closeLinksModal}
                  className="rounded-full border border-[#c8c8c8] px-3 py-1 text-xs font-semibold text-[#1b2832]"
                >
                  Fechar
                </button>
              </div>
            </div>
            <div className="mt-4 max-h-[65vh] overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left">Setor</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-left">Respostas</th>
                    <th className="px-2 py-2 text-left">Ultimo envio</th>
                    <th className="px-2 py-2 text-left">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {linksPayload.sectors.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-2 py-3 text-xs text-[#5a7383]">
                        Nenhum setor configurado para este diagnostico.
                      </td>
                    </tr>
                  ) : (
                    linksPayload.sectors.map((sector) => (
                      <tr key={sector.id} className="border-b">
                        <td className="px-2 py-2">{sector.name}</td>
                        <td className="px-2 py-2">{sector.isActive ? "Ativo" : "Inativo"}</td>
                        <td className="px-2 py-2">{sector.submissionCount}</td>
                        <td className="px-2 py-2">{fmtDate(sector.lastSubmittedAt)}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <input
                              readOnly
                              value={sector.accessLink}
                              className="w-full min-w-[280px] rounded border border-[#d5e2ea] bg-[#f7fbfe] px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => void copySectorLink(sector)}
                              className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                            >
                              {copiedSectorId === sector.id ? "Copiado" : "Copiar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
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
        <Link href={`/client/${clientSlug}/company`} className="text-[#1b2832]">
          Home
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
                href={`/client/${clientSlug}/programs/${assignment.programId}`}
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

export function ClientReportsSection({ clientSlug }: { clientSlug: string }) {
  const { data, isLoading, error } = useClientPortalData(clientSlug);
  const [downloadingReportId, setDownloadingReportId] = useState<string | null>(null);
  const [reportFeedback, setReportFeedback] = useState("");

  async function downloadReport(reportId: string) {
    setDownloadingReportId(reportId);
    setReportFeedback("");
    try {
      const response = await fetch(`/api/client/portal/${clientSlug}/reports/${reportId}/download`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        fileName?: string;
        report?: {
          id: string;
          title: string;
          status: string;
          createdAt: string;
          summary: Record<string, unknown>;
        };
      };
      if (!response.ok || !body.report) {
        throw new Error(body.error ?? "Nao foi possivel baixar o relatorio.");
      }

      const blob = new Blob(
        [
          JSON.stringify(
            {
              id: body.report.id,
              title: body.report.title,
              status: body.report.status,
              createdAt: body.report.createdAt,
              summary: body.report.summary,
            },
            null,
            2,
          ),
        ],
        { type: "application/json;charset=utf-8" },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = body.fileName ?? `${body.report.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setReportFeedback("Relatorio baixado com sucesso.");
    } catch (downloadError) {
      setReportFeedback(
        downloadError instanceof Error ? downloadError.message : "Nao foi possivel baixar o relatorio.",
      );
    } finally {
      setDownloadingReportId(null);
    }
  }

  if (isLoading) return <p className="text-sm text-[#49697a]">Carregando relatorios...</p>;
  if (error || !data) return <p className="text-sm text-red-600">{error || "Relatorios indisponiveis."}</p>;

  return (
    <div className="space-y-6">
      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">Reports</h2>
        <p className="mt-1 text-sm text-[#475660]">Tabelas de relatorios DRPS e processos continuos.</p>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">Relatorios DRPS</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Titulo</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Data</th>
                <th className="px-2 py-2 text-left">Acao</th>
              </tr>
            </thead>
            <tbody>
              {(data.reports ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-3 text-xs text-[#5a7383]">
                    Sem relatorios DRPS para este cliente.
                  </td>
                </tr>
              ) : (
                (data.reports ?? []).map((report) => (
                  <tr key={report.id} className="border-b">
                    <td className="px-2 py-2">{report.report_title}</td>
                    <td className="px-2 py-2">{report.status}</td>
                    <td className="px-2 py-2">{fmtDateTime(report.created_at)}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => void downloadReport(report.id)}
                        disabled={downloadingReportId === report.id}
                        className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73] disabled:opacity-50"
                      >
                        {downloadingReportId === report.id ? "Baixando..." : "Baixar"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {reportFeedback ? <p className="mt-3 text-sm text-[#0f5b73]">{reportFeedback}</p> : null}
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">Processos continuos</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Programa</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Aplicado em</th>
                <th className="px-2 py-2 text-left">Frequencia</th>
                <th className="px-2 py-2 text-left">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {(data.assignedPrograms ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-xs text-[#5a7383]">
                    Nenhum processo continuo atribuido.
                  </td>
                </tr>
              ) : (
                (data.assignedPrograms ?? []).map((program) => (
                  <tr key={program.id} className="border-b">
                    <td className="px-2 py-2">{program.programTitle}</td>
                    <td className="px-2 py-2">{program.status}</td>
                    <td className="px-2 py-2">{fmtDateTime(program.deployedAt)}</td>
                    <td className="px-2 py-2">{program.scheduleFrequency || "-"}</td>
                    <td className="px-2 py-2">
                      <Link
                        href={`/client/${clientSlug}/programs/${program.programId}`}
                        className="rounded-full border border-[#c8c8c8] px-3 py-1 text-xs font-semibold text-[#1b2832]"
                      >
                        Abrir
                      </Link>
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

export function ClientContractsInvoicesSection({ clientSlug }: { clientSlug: string }) {
  const { data, isLoading, error } = useClientPortalData(clientSlug);

  if (isLoading) return <p className="text-sm text-[#49697a]">Carregando contratos e invoices...</p>;
  if (error || !data) return <p className="text-sm text-red-600">{error || "Contratos indisponiveis."}</p>;

  return (
    <div className="space-y-6">
      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">Contracts and invoces</h2>
        <p className="mt-1 text-sm text-[#475660]">
          Financeiro: {data.client.billingStatus ?? "-"} | Contrato:{" "}
          {fmtDate(data.client.contractStartDate ?? null)} - {fmtDate(data.client.contractEndDate ?? null)}
        </p>
        <p className="mt-1 text-xs text-[#5a7383]">Ultima atualizacao: {fmtDateTime(data.client.updatedAt)}</p>
      </section>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#141d24]">Contracts invoces</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Invoice ID</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Valor</th>
                <th className="px-2 py-2 text-left">Vencimento</th>
              </tr>
            </thead>
            <tbody>
              {(data.invoices ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-3 text-xs text-[#5a7383]">
                    Nenhum invoice registrado para este cliente.
                  </td>
                </tr>
              ) : (
                (data.invoices ?? []).map((invoice) => (
                  <tr key={invoice.id} className="border-b">
                    <td className="px-2 py-2">{invoice.id}</td>
                    <td className="px-2 py-2">{invoice.status}</td>
                    <td className="px-2 py-2">{fmtCurrency(invoice.amount)}</td>
                    <td className="px-2 py-2">{fmtDate(invoice.dueDate)}</td>
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

export function ClientProgramDetailsSection({
  clientSlug,
  programId,
}: {
  clientSlug: string;
  programId: string;
}) {
  const { data, isLoading, error } = useClientPortalData(clientSlug);
  const program = findProgramById(programId);
  const assignment = listAssignedPrograms(clientSlug).find((item) => item.programId === programId) ?? null;
  const assignedFromApi = useMemo(
    () =>
      data?.assignedPrograms?.find((item) => item.programId === programId) ?? null,
    [data?.assignedPrograms, programId],
  );
  const hasAssignment = Boolean(assignedFromApi || (program && assignment));
  const displayTitle = assignedFromApi?.programTitle ?? program?.name ?? "Programa";
  const displaySummary = assignedFromApi?.programDescription ?? program?.summary ?? null;
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
  const [evaluationError, setEvaluationError] = useState("");

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
      setEvaluationError("Answer all evaluation questions from 1 to 5.");
      return;
    }
    const nextEntries = [...entries, { createdAt: new Date().toISOString(), scores: answers }];
    setEntries(nextEntries);
    localStorage.setItem(storageKey, JSON.stringify(nextEntries));
    setScores({});
    setEvaluationError("");
  }

  if (isLoading) {
    return <p className="text-sm text-[#49697a]">Carregando detalhes do processo...</p>;
  }

  if (error || !data) {
    return <p className="text-sm text-red-600">{error || "Detalhes indisponiveis."}</p>;
  }

  if (!hasAssignment) {
    return <p className="text-sm text-red-600">Program not assigned for this client.</p>;
  }

  return (
    <div className="space-y-6">
      <nav className="text-xs text-[#4f6977]">
        <Link href={`/client/${clientSlug}/programs`} className="text-[#1b2832]">
          Programas Continuos
        </Link>{" "}
        &gt; <span>{displayTitle}</span>
      </nav>

      <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#141d24]">{displayTitle}</h2>
        {displaySummary ? <p className="mt-1 text-sm text-[#475660]">{displaySummary}</p> : null}
        <p className="mt-2 text-xs text-[#55707f]">
          {assignedFromApi
            ? `${assignedFromApi.status} | Aplicado em ${fmtDate(assignedFromApi.deployedAt)}`
            : assignment
              ? `${assignment.campaignCode} | ${fmtDate(assignment.startDate)} - ${fmtDate(assignment.endDate)}`
              : "-"}
        </p>
      </section>

      {assignedFromApi ? (
        <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#141d24]">Dados do processo continuo</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <tbody>
                <tr className="border-b">
                  <td className="px-2 py-2 font-semibold text-[#3e5b6b]">ID atribuicao</td>
                  <td className="px-2 py-2">{assignedFromApi.id}</td>
                </tr>
                <tr className="border-b">
                  <td className="px-2 py-2 font-semibold text-[#3e5b6b]">Status</td>
                  <td className="px-2 py-2">{assignedFromApi.status}</td>
                </tr>
                <tr className="border-b">
                  <td className="px-2 py-2 font-semibold text-[#3e5b6b]">Aplicado em</td>
                  <td className="px-2 py-2">{fmtDate(assignedFromApi.deployedAt)}</td>
                </tr>
                <tr className="border-b">
                  <td className="px-2 py-2 font-semibold text-[#3e5b6b]">Frequencia</td>
                  <td className="px-2 py-2">{assignedFromApi.scheduleFrequency || "-"}</td>
                </tr>
                <tr className="border-b">
                  <td className="px-2 py-2 font-semibold text-[#3e5b6b]">Data ancora</td>
                  <td className="px-2 py-2">{fmtDate(assignedFromApi.scheduleAnchorDate)}</td>
                </tr>
                <tr className="border-b">
                  <td className="px-2 py-2 font-semibold text-[#3e5b6b]">Topico de risco alvo</td>
                  <td className="px-2 py-2">{assignedFromApi.targetRiskTopic ?? "-"}</td>
                </tr>
                <tr>
                  <td className="px-2 py-2 font-semibold text-[#3e5b6b]">Threshold gatilho</td>
                  <td className="px-2 py-2">{assignedFromApi.triggerThreshold ?? "-"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {program ? (
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
      ) : null}

      {program ? (
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
      ) : null}

      {program ? (
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
            {evaluationError ? <p className="text-sm text-red-600">{evaluationError}</p> : null}
            <button
              type="submit"
              className="rounded-full bg-[#131313] px-4 py-2 text-sm font-semibold text-white"
            >
              Submit evaluation
            </button>
          </form>
        </section>
      ) : null}

      {program ? (
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
      ) : null}
    </div>
  );
}



