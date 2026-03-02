"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { findProgramById, listAssignedPrograms } from "@/lib/programs-catalog";

type Diagnostic = {
  id: string;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  starts_at: string | null;
  closes_at: string | null;
};

type ClientSector = {
  id: string;
  name: string;
  riskParameter: number;
};

type ClientDetail = {
  id: string;
  companyName: string;
  cnpj: string;
  status: "Active" | "Pending" | "Inactive";
  billingStatus: "up_to_date" | "pending" | "overdue" | "blocked";
  portalSlug: string;
  totalEmployees: number;
  remoteEmployees: number;
  onsiteEmployees: number;
  hybridEmployees: number;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  updatedAt: string | null;
  sectors: ClientSector[];
  campaigns: Diagnostic[];
};

type Report = {
  id: string;
  report_title: string;
  status: "draft" | "processing" | "ready" | "failed";
  created_at: string;
};

type PortalSnapshot = {
  totals: { responses: number; topics: number };
  riskDistribution: { high: number; critical: number };
  drps: { part1_probability_score: number; part1_probability_class: string } | null;
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

type ClientTab = "overview" | "company-data" | "assigned-drps" | "assigned-continuous" | "contracts-invoicing";

const TAB_ITEMS: Array<{ id: ClientTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "company-data", label: "Company data" },
  { id: "assigned-drps", label: "Assigned Diagnosticos DRPS" },
  { id: "assigned-continuous", label: "Assigned processo continuos" },
  { id: "contracts-invoicing", label: "contracts & invoicing" },
];

function fmt(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function fmtDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

function toDatetimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromDatetimeLocal(value: string): string | "" {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function csvEscape(value: string | number | null): string {
  if (value === null) return "";
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function ManagerClientFicha({ clientId }: { clientId: string }) {
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [snapshot, setSnapshot] = useState<PortalSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isSavingDiagnostic, setIsSavingDiagnostic] = useState(false);
  const [linksPayload, setLinksPayload] = useState<SectorPayload | null>(null);
  const [copiedSectorId, setCopiedSectorId] = useState<string | null>(null);
  const [isLoadingLinksFor, setIsLoadingLinksFor] = useState<string | null>(null);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ClientTab>("overview");
  const [editForm, setEditForm] = useState({
    name: "",
    status: "draft" as "draft" | "live" | "closed" | "archived",
    startsAt: "",
    closesAt: "",
  });

  const selectedCampaign = useMemo(
    () => client?.campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null,
    [client, selectedCampaignId],
  );

  const assignedPrograms = useMemo(() => {
    if (!client) return [];
    return listAssignedPrograms(client.portalSlug);
  }, [client]);

  const primaryContinuousProgram = assignedPrograms[0] ?? null;
  const primaryProgramDetails = primaryContinuousProgram
    ? findProgramById(primaryContinuousProgram.programId)
    : null;

  const loadBase = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [detailRes, reportsRes] = await Promise.all([
        fetch(`/api/admin/clients/${clientId}`, { cache: "no-store" }),
        fetch(`/api/admin/clients/${clientId}/reports`, { cache: "no-store" }),
      ]);
      if (!detailRes.ok) throw new Error("Falha ao carregar ficha do cliente.");
      if (!reportsRes.ok) throw new Error("Falha ao carregar relatorios do cliente.");
      const detailPayload = (await detailRes.json()) as { client: ClientDetail };
      const reportsPayload = (await reportsRes.json()) as { reports: Report[] };
      setClient(detailPayload.client);
      setReports(reportsPayload.reports ?? []);
      setSelectedCampaignId((previous) => {
        if (previous && detailPayload.client.campaigns.some((campaign) => campaign.id === previous)) return previous;
        return (
          detailPayload.client.campaigns.find((campaign) => campaign.status === "live")?.id ??
          detailPayload.client.campaigns[0]?.id ??
          ""
        );
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar ficha.");
      setClient(null);
    } finally {
      setIsLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    async function loadSnapshot() {
      if (!selectedCampaign || selectedCampaign.status !== "live") {
        setSnapshot(null);
        return;
      }
      const response = await fetch(`/api/admin/surveys/${selectedCampaign.public_slug}/portal`, { cache: "no-store" });
      if (!response.ok) {
        setSnapshot(null);
        return;
      }
      setSnapshot((await response.json()) as PortalSnapshot);
    }
    void loadSnapshot();
  }, [selectedCampaign]);

  async function updateDiagnostic(campaignId: string, payload: Record<string, unknown>) {
    setIsSavingDiagnostic(true);
    const response = await fetch(`/api/admin/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error || "Falha ao atualizar diagnostico.");
      setIsSavingDiagnostic(false);
      return;
    }
    await loadBase();
    setEditingCampaignId(null);
    setIsSavingDiagnostic(false);
  }

  async function generateSeriesReports() {
    if (!client) return;
    setIsBusy(true);
    const response = await fetch(`/api/admin/clients/${client.id}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generateAll: true }),
    });
    if (!response.ok && response.status !== 207) setError("Falha ao gerar serie de relatorios.");
    await loadBase();
    setIsBusy(false);
  }

  async function generateReportForCampaign(campaignId: string) {
    if (!client) return;
    setIsBusy(true);
    const response = await fetch(`/api/admin/clients/${client.id}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surveyId: campaignId }),
    });
    if (!response.ok && response.status !== 207) setError("Falha ao gerar relatorio.");
    await loadBase();
    setIsBusy(false);
  }

  async function loadQuestionnaireLinks(campaign: Diagnostic) {
    setIsLoadingLinksFor(campaign.id);
    const response = await fetch(`/api/admin/campaigns/${campaign.id}/sectors`, { cache: "no-store" });
    if (!response.ok) {
      setError("Falha ao carregar links.");
      setIsLoadingLinksFor(null);
      return;
    }
    setLinksPayload((await response.json()) as SectorPayload);
    setIsLoadingLinksFor(null);
  }

  async function copySectorLink(sector: SectorLink) {
    await navigator.clipboard.writeText(sector.accessLink);
    setCopiedSectorId(sector.id);
    window.setTimeout(() => setCopiedSectorId(null), 1200);
  }

  async function copyAllLinks() {
    if (!linksPayload) return;
    const lines = linksPayload.sectors.filter((sector) => sector.isActive).map((sector) => `${sector.name}: ${sector.accessLink}`);
    await navigator.clipboard.writeText(lines.join("\n"));
  }

  function exportLinksCsv() {
    if (!linksPayload) return;
    const header = ["campaign_id", "campaign_slug", "sector", "active", "submission_count", "access_link"].join(",");
    const rows = linksPayload.sectors.map((sector) =>
      [csvEscape(linksPayload.campaign.id), csvEscape(linksPayload.campaign.slug), csvEscape(sector.name), csvEscape(sector.isActive ? "true" : "false"), csvEscape(sector.submissionCount), csvEscape(sector.accessLink)].join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${linksPayload.campaign.slug || linksPayload.campaign.id}-links-questionario.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function focusResults(campaign: Diagnostic) {
    setActiveTab("assigned-drps");
    setSelectedCampaignId(campaign.id);
    setTimeout(() => {
      document.getElementById("drps-dashboard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  if (isLoading) return <p className="text-sm text-[#49697a]">Carregando ficha do cliente...</p>;
  if (!client) return <p className="text-sm text-red-600">{error || "Cliente indisponivel."}</p>;

  return (
    <div className="space-y-6">
      <nav className="text-xs text-[#4f6977]">
        <Link href="/manager/clients" className="text-[#0f5b73]">
          Client area
        </Link>{" "}
        / <span>{client.companyName}</span>
      </nav>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-[#123447]">{client.companyName}</h2>
            <p className="mt-1 text-sm text-[#35515f]">
              CNPJ {client.cnpj} | Status {client.status} | Financeiro {client.billingStatus}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border border-[#d7d7d7] bg-[#ececec] p-2">
          <p className="px-2 pb-2 text-xs font-semibold text-[#697983]">Company profile</p>
          <nav className="space-y-1">
            {TAB_ITEMS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm ${
                  activeTab === tab.id
                    ? "bg-white font-semibold text-[#0f1720]"
                    : "text-[#202f38] hover:bg-white/70"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>
        <div className="space-y-6">

      {(activeTab === "overview" || activeTab === "assigned-drps") ? (
        <section id="drps-dashboard" className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-[#123447]">Dashboard DRPS do diagnostico selecionado</h3>
            <select className="rounded border border-[#c9dce8] px-3 py-2 text-sm" value={selectedCampaignId} onChange={(event) => setSelectedCampaignId(event.target.value)}>
              {client.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} ({campaign.status})</option>)}
            </select>
          </div>
          {snapshot ? (
            <div className="grid gap-3 md:grid-cols-4">
              <article className="rounded-xl border border-[#d8e4ee] p-3"><p className="text-xs text-[#4f6977]">Respostas</p><p className="mt-1 text-xl font-semibold text-[#133748]">{snapshot.totals.responses}</p></article>
              <article className="rounded-xl border border-[#d8e4ee] p-3"><p className="text-xs text-[#4f6977]">Topicos</p><p className="mt-1 text-xl font-semibold text-[#133748]">{snapshot.totals.topics}</p></article>
              <article className="rounded-xl border border-[#d8e4ee] p-3"><p className="text-xs text-[#4f6977]">Risco alto+critico</p><p className="mt-1 text-xl font-semibold text-[#133748]">{snapshot.riskDistribution.high + snapshot.riskDistribution.critical}</p></article>
              <article className="rounded-xl border border-[#d8e4ee] p-3"><p className="text-xs text-[#4f6977]">Ultimo DRPS</p><p className="mt-1 text-sm font-semibold text-[#133748]">{snapshot.drps ? `${snapshot.drps.part1_probability_score.toFixed(2)} (${snapshot.drps.part1_probability_class})` : "Sem DRPS"}</p></article>
            </div>
          ) : <p className="text-sm text-[#5a7383]">Selecione um diagnostico ativo para visualizar resultados.</p>}
        </section>
      ) : null}

      {activeTab === "overview" ? (
        <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#123447]">Resultados atuais</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <article className="rounded-xl border border-[#d8e4ee] p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-[#4f6977]">DRPS atual</p>
              {snapshot?.drps ? (
                <>
                  <p className="mt-1 text-sm font-semibold text-[#133748]">
                    {snapshot.drps.part1_probability_score.toFixed(2)} ({snapshot.drps.part1_probability_class})
                  </p>
                  <p className="mt-1 text-xs text-[#4f6977]">Campanha: {selectedCampaign?.name ?? "Nao selecionada"}</p>
                </>
              ) : (
                <p className="mt-1 text-sm text-[#5a7383]">Sem resultado DRPS disponivel.</p>
              )}
            </article>
            <article className="rounded-xl border border-[#d8e4ee] p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-[#4f6977]">Processo continuo atual</p>
              {primaryContinuousProgram ? (
                <>
                  <p className="mt-1 text-sm font-semibold text-[#133748]">
                    {primaryProgramDetails?.name ?? primaryContinuousProgram.programId}
                  </p>
                  <p className="mt-1 text-xs text-[#4f6977]">
                    Status {primaryContinuousProgram.status} | Periodo {fmtDate(primaryContinuousProgram.startDate)} -{" "}
                    {fmtDate(primaryContinuousProgram.endDate)}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-[#5a7383]">Nenhum processo continuo atribuido.</p>
              )}
            </article>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("assigned-drps")}
              className="rounded-full border border-[#9ec8db] px-4 py-2 text-sm font-semibold text-[#0f5b73]"
            >
              Ver diagnosticos atribuidos
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("assigned-continuous")}
              className="rounded-full border border-[#9ec8db] px-4 py-2 text-sm font-semibold text-[#0f5b73]"
            >
              Ver processos continuos
            </button>
          </div>
        </section>
      ) : null}

      {activeTab === "company-data" ? (
        <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#123447]">Company data</h3>
          <p className="mt-2 text-sm">Contato: {client.contactName || "-"} | {client.contactEmail || "-"} | {client.contactPhone || "-"}</p>
          <p className="mt-1 text-sm">Colaboradores: {client.totalEmployees} (R {client.remoteEmployees} / P {client.onsiteEmployees} / H {client.hybridEmployees})</p>
          <p className="mt-1 text-sm">Setores: {client.sectors.length}</p>
        </section>
      ) : null}

      {activeTab === "assigned-drps" ? (
        <>
          <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
            <div className="flex flex-wrap gap-2">
              <Link href={`/manager/clients/${client.id}/assign-drps`} className="rounded-full bg-[#0f5b73] px-4 py-2 text-sm font-semibold text-white">
                Atribuir diagnosticos DRPS
              </Link>
              <button type="button" disabled={isBusy} onClick={() => void generateSeriesReports()} className="rounded-full border border-[#e4c898] px-4 py-2 text-sm font-semibold text-[#7a4b00] disabled:opacity-50">Gerar serie de relatorios</button>
            </div>
          </section>
          <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-[#123447]">Diagnosticos DRPS atribuidos</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="border-b"><th className="px-2 py-2 text-left">Diagnostico</th><th className="px-2 py-2 text-left">Status</th><th className="px-2 py-2 text-left">Inicio</th><th className="px-2 py-2 text-left">Fechamento</th><th className="px-2 py-2 text-left">Acoes</th></tr></thead>
                <tbody>
                  {client.campaigns.length === 0 ? <tr><td colSpan={5} className="px-2 py-3 text-xs text-[#5a7383]">Nenhum diagnostico atribuido.</td></tr> : client.campaigns.map((campaign) => (
                    <Fragment key={campaign.id}>
                      <tr className="border-b">
                        <td className="px-2 py-2">{campaign.name}</td><td className="px-2 py-2">{campaign.status}</td><td className="px-2 py-2">{fmt(campaign.starts_at)}</td><td className="px-2 py-2">{fmt(campaign.closes_at)}</td>
                        <td className="px-2 py-2"><div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => focusResults(campaign)} className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]">Ver resultados</button>
                          <button type="button" onClick={() => { setEditingCampaignId(campaign.id); setEditForm({ name: campaign.name, status: campaign.status, startsAt: toDatetimeLocal(campaign.starts_at), closesAt: toDatetimeLocal(campaign.closes_at) }); }} className="rounded-full border border-[#b9d8a5] px-3 py-1 text-xs font-semibold text-[#2d5f23]">Editar</button>
                          <button type="button" disabled={isSavingDiagnostic || campaign.status === "closed"} onClick={() => void updateDiagnostic(campaign.id, { status: "closed", closesAt: new Date().toISOString() })} className="rounded-full border border-[#e4c898] px-3 py-1 text-xs font-semibold text-[#7a4b00] disabled:opacity-50">Fechar</button>
                          <button type="button" disabled={isLoadingLinksFor === campaign.id} onClick={() => void loadQuestionnaireLinks(campaign)} className="rounded-full border border-[#d5c2f0] px-3 py-1 text-xs font-semibold text-[#5a2b8a] disabled:opacity-50">{isLoadingLinksFor === campaign.id ? "Carregando..." : "Gerar links questionario"}</button>
                          <button type="button" disabled={isBusy} onClick={() => void generateReportForCampaign(campaign.id)} className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73] disabled:opacity-50">Gerar relatorio</button>
                        </div></td>
                      </tr>
                      {editingCampaignId === campaign.id ? (
                        <tr className="border-b bg-[#f8fbfd]"><td colSpan={5} className="px-2 py-3">
                          <div className="grid gap-2 md:grid-cols-4">
                            <input className="rounded border border-[#c9dce8] px-3 py-2 text-sm md:col-span-2" value={editForm.name} onChange={(event) => setEditForm((p) => ({ ...p, name: event.target.value }))} />
                            <select className="rounded border border-[#c9dce8] px-3 py-2 text-sm" value={editForm.status} onChange={(event) => setEditForm((p) => ({ ...p, status: event.target.value as "draft" | "live" | "closed" | "archived" }))}><option value="draft">Rascunho</option><option value="live">Ativo</option><option value="closed">Concluido</option><option value="archived">Arquivado</option></select>
                            <input type="datetime-local" className="rounded border border-[#c9dce8] px-3 py-2 text-sm" value={editForm.startsAt} onChange={(event) => setEditForm((p) => ({ ...p, startsAt: event.target.value }))} />
                            <input type="datetime-local" className="rounded border border-[#c9dce8] px-3 py-2 text-sm" value={editForm.closesAt} onChange={(event) => setEditForm((p) => ({ ...p, closesAt: event.target.value }))} />
                          </div>
                          <div className="mt-3 flex gap-2"><button type="button" disabled={isSavingDiagnostic} onClick={() => void updateDiagnostic(campaign.id, { name: editForm.name.trim(), status: editForm.status, startsAt: fromDatetimeLocal(editForm.startsAt), closesAt: fromDatetimeLocal(editForm.closesAt) })} className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Salvar</button><button type="button" onClick={() => setEditingCampaignId(null)} className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]">Cancelar</button></div>
                        </td></tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {linksPayload ? (
            <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold text-[#123447]">Links do questionario: {linksPayload.campaign.name}</h3><div className="flex gap-2"><button type="button" onClick={() => void copyAllLinks()} className="rounded-full border border-[#b9d8a5] px-3 py-1 text-xs font-semibold text-[#2d5f23]">Copiar todos</button><button type="button" onClick={exportLinksCsv} className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]">Exportar CSV</button></div></div>
              <div className="mt-3 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b"><th className="px-2 py-2 text-left">Setor</th><th className="px-2 py-2 text-left">Status</th><th className="px-2 py-2 text-left">Respostas</th><th className="px-2 py-2 text-left">Ultimo envio</th><th className="px-2 py-2 text-left">Link</th></tr></thead><tbody>{linksPayload.sectors.length === 0 ? <tr><td colSpan={5} className="px-2 py-3 text-xs text-[#5a7383]">Nenhum setor configurado para este diagnostico.</td></tr> : linksPayload.sectors.map((sector) => <tr key={sector.id} className="border-b"><td className="px-2 py-2">{sector.name}</td><td className="px-2 py-2">{sector.isActive ? "Ativo" : "Inativo"}</td><td className="px-2 py-2">{sector.submissionCount}</td><td className="px-2 py-2">{fmt(sector.lastSubmittedAt)}</td><td className="px-2 py-2"><div className="flex items-center gap-2"><input readOnly value={sector.accessLink} className="min-w-[320px] rounded border border-[#d5e2ea] bg-[#f7fbfe] px-2 py-1 text-xs" /><button type="button" onClick={() => void copySectorLink(sector)} className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]">{copiedSectorId === sector.id ? "Copiado" : "Copiar"}</button></div></td></tr>)}</tbody></table></div>
            </section>
          ) : null}
          <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-[#123447]">Relatorios gerados</h3>
            <div className="mt-3 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b"><th className="px-2 py-2 text-left">Titulo</th><th className="px-2 py-2 text-left">Status</th><th className="px-2 py-2 text-left">Criado</th></tr></thead><tbody>{reports.length === 0 ? <tr><td className="px-2 py-3 text-xs text-[#5a7383]" colSpan={3}>Sem relatorios.</td></tr> : reports.map((report) => <tr key={report.id} className="border-b"><td className="px-2 py-2">{report.report_title}</td><td className="px-2 py-2">{report.status}</td><td className="px-2 py-2">{fmt(report.created_at)}</td></tr>)}</tbody></table></div>
          </section>
        </>
      ) : null}

      {activeTab === "assigned-continuous" ? (
        <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-[#123447]">Assigned processo continuos</h3>
            <Link href="/manager/programs" className="rounded-full bg-[#0f5b73] px-4 py-2 text-sm font-semibold text-white">
              Atribuir processo continuo
            </Link>
          </div>
          <div className="mt-3 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b"><th className="px-2 py-2 text-left">Programa</th><th className="px-2 py-2 text-left">Categoria</th><th className="px-2 py-2 text-left">Status</th><th className="px-2 py-2 text-left">Periodo</th></tr></thead><tbody>{assignedPrograms.length === 0 ? <tr><td colSpan={4} className="px-2 py-3 text-xs text-[#5a7383]">Nenhum processo continuo atribuido.</td></tr> : assignedPrograms.map((assignment) => { const program = findProgramById(assignment.programId); return <tr key={assignment.campaignCode} className="border-b"><td className="px-2 py-2">{program?.name ?? assignment.programId}</td><td className="px-2 py-2">{program?.category ?? "-"}</td><td className="px-2 py-2">{assignment.status}</td><td className="px-2 py-2">{fmtDate(assignment.startDate)} - {fmtDate(assignment.endDate)}</td></tr>; })}</tbody></table></div>
        </section>
      ) : null}

      {activeTab === "contracts-invoicing" ? (
        <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#123447]">contracts & invoicing</h3>
          <p className="mt-2 text-sm">Financeiro: {client.billingStatus}</p>
          <p className="mt-1 text-sm">Contrato: {fmtDate(client.contractStartDate)} - {fmtDate(client.contractEndDate)}</p>
          <p className="mt-1 text-sm">Ultima atualizacao: {fmt(client.updatedAt)}</p>
        </section>
      ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
