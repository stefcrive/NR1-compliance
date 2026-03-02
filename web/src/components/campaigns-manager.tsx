"use client";

import { useEffect, useMemo, useState } from "react";

type Campaign = {
  id: string;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  starts_at: string | null;
  closes_at: string | null;
  k_anonymity_min: number;
  question_count: number;
  response_count: number;
  latest_response_at: string | null;
  created_at: string;
};

type CampaignPayload = {
  name: string;
  publicSlug?: string;
  status: "draft" | "live";
  kAnonymityMin: number;
  sourceSurveyId?: string;
};

type SectorConfig = {
  id: string;
  key: string;
  name: string;
  riskParameter: number;
  accessToken: string;
  accessLink: string;
  isActive: boolean;
  submissionCount: number;
  lastSubmittedAt: string | null;
  createdAt: string;
};

type SectorPayload = {
  campaign: {
    id: string;
    name: string;
    slug: string;
  };
  sectors: SectorConfig[];
};

const statusLabels: Record<Campaign["status"], string> = {
  draft: "Rascunho",
  live: "Ativa",
  closed: "Encerrada",
  archived: "Arquivada",
};

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

function csvEscape(value: string | number | null): string {
  if (value === null) {
    return "";
  }
  const normalized = String(value).replace(/"/g, "\"\"");
  return `"${normalized}"`;
}

export function CampaignsManager() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [createError, setCreateError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<CampaignPayload>({
    name: "",
    status: "draft",
    kAnonymityMin: 5,
  });

  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [sectorData, setSectorData] = useState<SectorPayload | null>(null);
  const [isLoadingSectors, setIsLoadingSectors] = useState(false);
  const [sectorError, setSectorError] = useState("");
  const [sectorSaveError, setSectorSaveError] = useState("");
  const [isSavingSector, setIsSavingSector] = useState(false);
  const [isRotatingSectorId, setIsRotatingSectorId] = useState<string | null>(null);
  const [copiedSectorId, setCopiedSectorId] = useState<string | null>(null);
  const [sectorForm, setSectorForm] = useState({
    name: "",
    riskParameter: 1,
  });

  async function loadCampaigns() {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/campaigns", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Nao foi possivel carregar campanhas.");
      }
      const payload = (await response.json()) as { campaigns: Campaign[] };
      const campaignsResult = payload.campaigns ?? [];
      setCampaigns(campaignsResult);
      setSelectedCampaignId((previous) => {
        if (previous && campaignsResult.some((campaign) => campaign.id === previous)) {
          return previous;
        }
        return campaignsResult[0]?.id ?? "";
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar campanhas.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSectors(campaignId: string) {
    if (!campaignId) {
      setSectorData(null);
      return;
    }

    setIsLoadingSectors(true);
    setSectorError("");
    try {
      const response = await fetch(`/api/admin/campaigns/${campaignId}/sectors`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Nao foi possivel carregar setores.");
      }
      const payload = (await response.json()) as SectorPayload;
      setSectorData(payload);
    } catch (loadError) {
      setSectorError(loadError instanceof Error ? loadError.message : "Erro ao carregar setores.");
      setSectorData(null);
    } finally {
      setIsLoadingSectors(false);
    }
  }

  useEffect(() => {
    void loadCampaigns();
  }, []);

  useEffect(() => {
    void loadSectors(selectedCampaignId);
  }, [selectedCampaignId]);

  const sortedCampaigns = useMemo(
    () =>
      [...campaigns].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [campaigns],
  );

  async function handleCreate() {
    setCreateError("");
    if (form.name.trim().length < 3) {
      setCreateError("Informe um nome de campanha valido.");
      return;
    }

    setIsCreating(true);
    try {
      const response = await fetch("/api/admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok && response.status !== 207) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Falha ao criar campanha.");
      }

      setForm({
        name: "",
        status: "draft",
        kAnonymityMin: 5,
      });
      await loadCampaigns();
    } catch (createErr) {
      setCreateError(createErr instanceof Error ? createErr.message : "Erro ao criar campanha.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSaveSector() {
    if (!selectedCampaignId) {
      setSectorSaveError("Selecione uma campanha para cadastrar setores.");
      return;
    }
    setSectorSaveError("");
    if (sectorForm.name.trim().length < 2) {
      setSectorSaveError("Informe um nome de setor valido.");
      return;
    }
    if (!Number.isFinite(sectorForm.riskParameter) || sectorForm.riskParameter < 0.5 || sectorForm.riskParameter > 2) {
      setSectorSaveError("Parametro de risco deve estar entre 0.5 e 2.0.");
      return;
    }

    setIsSavingSector(true);
    try {
      const response = await fetch(`/api/admin/campaigns/${selectedCampaignId}/sectors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: sectorForm.name.trim(),
          riskParameter: Number(sectorForm.riskParameter.toFixed(2)),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Falha ao salvar setor.");
      }

      setSectorForm({
        name: "",
        riskParameter: 1,
      });
      await loadSectors(selectedCampaignId);
    } catch (saveError) {
      setSectorSaveError(saveError instanceof Error ? saveError.message : "Erro ao salvar setor.");
    } finally {
      setIsSavingSector(false);
    }
  }

  async function handleRotateToken(sectorId: string) {
    if (!selectedCampaignId) {
      return;
    }
    setSectorSaveError("");
    setIsRotatingSectorId(sectorId);
    try {
      const response = await fetch(
        `/api/admin/campaigns/${selectedCampaignId}/sectors/${sectorId}/token`,
        {
          method: "POST",
        },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Nao foi possivel rotacionar token.");
      }
      await loadSectors(selectedCampaignId);
    } catch (rotateError) {
      setSectorSaveError(
        rotateError instanceof Error ? rotateError.message : "Erro ao rotacionar token.",
      );
    } finally {
      setIsRotatingSectorId(null);
    }
  }

  async function handleCopyLink(sector: SectorConfig) {
    try {
      await navigator.clipboard.writeText(sector.accessLink);
      setCopiedSectorId(sector.id);
      window.setTimeout(() => setCopiedSectorId(null), 1800);
    } catch {
      setSectorSaveError("Nao foi possivel copiar o link no navegador.");
    }
  }

  function handleExportSectorCsv() {
    if (!sectorData || sectorData.sectors.length === 0) {
      setSectorSaveError("Nao ha setores para exportar.");
      return;
    }

    const header = [
      "campaign_id",
      "campaign_slug",
      "sector_id",
      "sector_key",
      "sector_name",
      "risk_parameter",
      "access_token",
      "access_link",
      "submission_count",
      "last_submitted_at",
    ].join(",");

    const rows = sectorData.sectors.map((sector) =>
      [
        csvEscape(sectorData.campaign.id),
        csvEscape(sectorData.campaign.slug),
        csvEscape(sector.id),
        csvEscape(sector.key),
        csvEscape(sector.name),
        csvEscape(sector.riskParameter.toFixed(2)),
        csvEscape(sector.accessToken),
        csvEscape(sector.accessLink),
        csvEscape(sector.submissionCount),
        csvEscape(sector.lastSubmittedAt),
      ].join(","),
    );

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${sectorData.campaign.slug}-sector-tokens.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-[#123447]">Criar nova campanha</h2>
        <p className="mt-1 text-sm text-[#3d5a69]">
          Opcionalmente clone estrutura de perguntas e grupos de uma campanha existente.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-[#214759]">Nome</span>
            <input
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Ex: DRPS 2026 - Unidade Sul"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-[#214759]">Slug publico (opcional)</span>
            <input
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={form.publicSlug ?? ""}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, publicSlug: event.target.value || undefined }))
              }
              placeholder="drps-2026-unidade-sul"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-[#214759]">Status inicial</span>
            <select
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={form.status}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, status: event.target.value as "draft" | "live" }))
              }
            >
              <option value="draft">Rascunho</option>
              <option value="live">Ativa</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-[#214759]">k-anonimato minimo</span>
            <input
              type="number"
              min={3}
              max={20}
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={form.kAnonymityMin}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, kAnonymityMin: Number(event.target.value || 5) }))
              }
            />
          </label>

          <label className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium text-[#214759]">Clonar estrutura de</span>
            <select
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={form.sourceSurveyId ?? ""}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  sourceSurveyId: event.target.value || undefined,
                }))
              }
            >
              <option value="">Nao clonar</option>
              {sortedCampaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name} ({campaign.public_slug})
                </option>
              ))}
            </select>
          </label>
        </div>

        {createError && <p className="mt-3 text-sm text-red-600">{createError}</p>}
        <button
          type="button"
          disabled={isCreating}
          onClick={handleCreate}
          className="mt-4 rounded-full bg-[#0f5b73] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0c4d61] disabled:opacity-60"
        >
          {isCreating ? "Criando..." : "Criar campanha"}
        </button>
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-[#123447]">Campanhas existentes</h2>
          <button
            type="button"
            onClick={() => void loadCampaigns()}
            className="rounded-full border border-[#9ec8db] px-4 py-1 text-xs font-semibold text-[#0f5b73]"
          >
            Recarregar
          </button>
        </div>

        {isLoading ? <p className="mt-4 text-sm text-[#49697a]">Carregando...</p> : null}
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

        {!isLoading && !error && (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#d8e4ee] text-[#20495a]">
                  <th className="px-2 py-2">Campanha</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Perguntas</th>
                  <th className="px-2 py-2">Respostas</th>
                  <th className="px-2 py-2">Ultima resposta</th>
                  <th className="px-2 py-2">k</th>
                </tr>
              </thead>
              <tbody>
                {sortedCampaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-b border-[#edf3f7]">
                    <td className="px-2 py-2">
                      <p className="font-medium text-[#14384a]">{campaign.name}</p>
                      <p className="text-xs text-[#4f6c7b]">/{campaign.public_slug}</p>
                    </td>
                    <td className="px-2 py-2 text-[#365868]">{statusLabels[campaign.status]}</td>
                    <td className="px-2 py-2 text-[#365868]">{campaign.question_count}</td>
                    <td className="px-2 py-2 text-[#365868]">{campaign.response_count}</td>
                    <td className="px-2 py-2 text-[#365868]">
                      {formatDate(campaign.latest_response_at)}
                    </td>
                    <td className="px-2 py-2 text-[#365868]">{campaign.k_anonymity_min}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-[#123447]">Setores e tokens por campanha</h2>
            <p className="mt-1 text-sm text-[#3d5a69]">
              Cadastre setores da empresa, defina parametro de risco e exporte links tokenizados
              por setor para envio aos colaboradores.
            </p>
          </div>
          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-[#315667]">
              Campanha
            </span>
            <select
              className="min-w-[280px] rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={selectedCampaignId}
              onChange={(event) => setSelectedCampaignId(event.target.value)}
            >
              {sortedCampaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name} ({campaign.public_slug})
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 rounded-xl border border-[#e4edf3] bg-[#f8fbfd] p-4">
          <h3 className="text-sm font-semibold text-[#163a4c]">Novo setor</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-[1.5fr_180px_auto]">
            <input
              className="rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={sectorForm.name}
              onChange={(event) =>
                setSectorForm((previous) => ({ ...previous, name: event.target.value }))
              }
              placeholder="Ex: Operacoes"
            />
            <input
              type="number"
              step={0.05}
              min={0.5}
              max={2}
              className="rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={sectorForm.riskParameter}
              onChange={(event) =>
                setSectorForm((previous) => ({
                  ...previous,
                  riskParameter: Number(event.target.value || 1),
                }))
              }
            />
            <button
              type="button"
              disabled={isSavingSector || !selectedCampaignId}
              onClick={() => void handleSaveSector()}
              className="rounded-full bg-[#0f5b73] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0c4d61] disabled:opacity-60"
            >
              {isSavingSector ? "Salvando..." : "Salvar setor"}
            </button>
          </div>
          <p className="mt-2 text-xs text-[#4a6676]">
            Parametro de risco setorial: 1.00 = neutro, &gt;1 aumenta sensibilidade, &lt;1 reduz
            sensibilidade.
          </p>
        </div>

        {sectorSaveError ? <p className="mt-3 text-sm text-red-600">{sectorSaveError}</p> : null}
        {sectorError ? <p className="mt-3 text-sm text-red-600">{sectorError}</p> : null}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={handleExportSectorCsv}
            disabled={!sectorData || sectorData.sectors.length === 0}
            className="rounded-full border border-[#9ec8db] px-4 py-1.5 text-xs font-semibold text-[#0f5b73] disabled:opacity-60"
          >
            Exportar CSV de tokens por setor
          </button>
        </div>

        {isLoadingSectors ? <p className="mt-4 text-sm text-[#49697a]">Carregando setores...</p> : null}

        {!isLoadingSectors && sectorData && (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#d8e4ee] text-[#20495a]">
                  <th className="px-2 py-2">Setor</th>
                  <th className="px-2 py-2">Parametro</th>
                  <th className="px-2 py-2">Respostas</th>
                  <th className="px-2 py-2">Ultimo envio</th>
                  <th className="px-2 py-2">Link tokenizado</th>
                  <th className="px-2 py-2">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {sectorData.sectors.length === 0 ? (
                  <tr>
                    <td className="px-2 py-4 text-sm text-[#4b6878]" colSpan={6}>
                      Nenhum setor cadastrado para esta campanha.
                    </td>
                  </tr>
                ) : (
                  sectorData.sectors.map((sector) => (
                    <tr key={sector.id} className="border-b border-[#edf3f7]">
                      <td className="px-2 py-2">
                        <p className="font-medium text-[#14384a]">{sector.name}</p>
                        <p className="text-xs text-[#4f6c7b]">{sector.key}</p>
                      </td>
                      <td className="px-2 py-2 text-[#365868]">{sector.riskParameter.toFixed(2)}x</td>
                      <td className="px-2 py-2 text-[#365868]">{sector.submissionCount}</td>
                      <td className="px-2 py-2 text-[#365868]">{formatDate(sector.lastSubmittedAt)}</td>
                      <td className="px-2 py-2">
                        <input
                          readOnly
                          value={sector.accessLink}
                          className="w-full min-w-[280px] rounded border border-[#d5e2ea] bg-[#f7fbfe] px-2 py-1 text-xs text-[#355565]"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleCopyLink(sector)}
                            className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                          >
                            {copiedSectorId === sector.id ? "Copiado" : "Copiar"}
                          </button>
                          <button
                            type="button"
                            disabled={isRotatingSectorId === sector.id}
                            onClick={() => void handleRotateToken(sector.id)}
                            className="rounded-full border border-[#e4c898] px-3 py-1 text-xs font-semibold text-[#7a4b00] disabled:opacity-60"
                          >
                            {isRotatingSectorId === sector.id ? "Gerando..." : "Rotacionar token"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
