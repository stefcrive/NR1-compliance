"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { slugify } from "@/lib/slug";

type ClientSector = {
  id: string;
  key: string;
  name: string;
  riskParameter: number;
};

type ClientDetail = {
  id: string;
  companyName: string;
  portalSlug: string;
  sectors: ClientSector[];
};

type DiagnosticTemplateOption = {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "live" | "closed" | "archived";
  linkedClientId: string | null;
  source: "surveys" | "legacy_drps_campaigns";
  questionCount?: number | null;
};

type TemplateQuestion = {
  id: string;
  prompt: string;
  isActive: boolean;
};

type SectorAssignment = {
  sectorId: string;
  sectorKey: string;
  sectorName: string;
  sectorRiskParameter: number;
  templateId: string;
  promptsText: string;
  loadingQuestions: boolean;
};

type CampaignSector = {
  id: string;
  key: string;
  name: string;
  riskParameter: number;
};

function mapStatus(status: DiagnosticTemplateOption["status"]) {
  if (status === "live") return "Ativo";
  if (status === "closed") return "Concluido";
  if (status === "archived") return "Arquivado";
  return "Rascunho";
}

function normalize(value: string) {
  return slugify(value);
}

function normalizePrompts(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function areSamePrompts(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function ManagerClientAssignDrps({ clientId }: { clientId: string }) {
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [templates, setTemplates] = useState<DiagnosticTemplateOption[]>([]);
  const [assignments, setAssignments] = useState<SectorAssignment[]>([]);
  const [questionsByTemplate, setQuestionsByTemplate] = useState<Record<string, string[]>>({});
  const [campaignStatus, setCampaignStatus] = useState<"draft" | "live">("live");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const templateById = useMemo(() => {
    return new Map(templates.map((item) => [item.id, item]));
  }, [templates]);

  const defaultTemplateId = useMemo(() => {
    return templates[0]?.id ?? "";
  }, [templates]);

  const loadTemplateQuestions = useCallback(
    async (templateId: string) => {
      if (!templateId) return [] as string[];
      const cached = questionsByTemplate[templateId];
      if (cached) return cached;

      const response = await fetch(`/api/admin/survey-templates/${templateId}/questions`, { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Falha ao carregar perguntas do template.");
      }
      const payload = (await response.json()) as { questions: TemplateQuestion[] };
      const prompts = (payload.questions ?? [])
        .filter((question) => question.isActive)
        .map((question) => question.prompt.trim())
        .filter((question) => question.length > 0);

      setQuestionsByTemplate((prev) => ({ ...prev, [templateId]: prompts }));
      return prompts;
    },
    [questionsByTemplate],
  );

  const applyTemplateToSector = useCallback(
    async (sectorId: string, templateId: string) => {
      const selectedTemplate = templateById.get(templateId) ?? null;
      setAssignments((prev) =>
        prev.map((item) =>
          item.sectorId === sectorId
            ? {
                ...item,
                templateId,
                promptsText: selectedTemplate?.source === "surveys" ? item.promptsText : "",
                loadingQuestions: selectedTemplate?.source === "surveys",
              }
            : item,
        ),
      );

      if (!selectedTemplate || selectedTemplate.source !== "surveys") {
        return;
      }

      try {
        const prompts = await loadTemplateQuestions(templateId);
        setAssignments((prev) =>
          prev.map((item) =>
            item.sectorId === sectorId
              ? {
                  ...item,
                  templateId,
                  promptsText: prompts.join("\n"),
                  loadingQuestions: false,
                }
              : item,
          ),
        );
      } catch (loadError) {
        setAssignments((prev) =>
          prev.map((item) =>
            item.sectorId === sectorId ? { ...item, loadingQuestions: false } : item,
          ),
        );
        setError(
          loadError instanceof Error ? loadError.message : "Erro ao carregar perguntas do template.",
        );
      }
    },
    [loadTemplateQuestions, templateById],
  );

  const loadBase = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [detailRes, databaseRes] = await Promise.all([
        fetch(`/api/admin/clients/${clientId}`, { cache: "no-store" }),
        fetch("/api/admin/programs-database", { cache: "no-store" }),
      ]);

      if (!detailRes.ok) throw new Error("Falha ao carregar cliente.");
      if (!databaseRes.ok) throw new Error("Falha ao carregar base DRPS.");

      const detailPayload = (await detailRes.json()) as { client: ClientDetail };
      const databasePayload = (await databaseRes.json()) as {
        drpsDiagnostics: DiagnosticTemplateOption[];
      };

      const nextClient = detailPayload.client;
      if (!nextClient.sectors || nextClient.sectors.length === 0) {
        throw new Error("Cadastre os setores da empresa na ficha do cliente antes de atribuir diagnosticos.");
      }

      const surveyTemplates = (databasePayload.drpsDiagnostics ?? []).filter(
        (item) => item.source === "surveys" && (item.questionCount ?? 0) > 0,
      );
      const unlinkedSurveyTemplates = surveyTemplates.filter((item) => !item.linkedClientId);
      const nextTemplates =
        unlinkedSurveyTemplates.length > 0 ? unlinkedSurveyTemplates : surveyTemplates;

      if (nextTemplates.length === 0) {
        throw new Error("Nenhum template DRPS com questionario base disponivel.");
      }

      const firstTemplateId =
        nextTemplates.find((item) => item.source === "surveys")?.id ?? nextTemplates[0]?.id ?? "";

      setClient(nextClient);
      setTemplates(nextTemplates);
      setAssignments(
        nextClient.sectors.map((sector) => ({
          sectorId: sector.id,
          sectorKey: sector.key,
          sectorName: sector.name,
          sectorRiskParameter: sector.riskParameter,
          templateId: firstTemplateId,
          promptsText: "",
          loadingQuestions: false,
        })),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar formulario.");
      setClient(null);
    } finally {
      setIsLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (!defaultTemplateId) return;
    const defaultTemplate = templateById.get(defaultTemplateId) ?? null;
    if (!defaultTemplate || defaultTemplate.source !== "surveys") return;
    if (assignments.length === 0) return;

    const hasEmptyPrompts = assignments.some(
      (assignment) => assignment.templateId === defaultTemplateId && assignment.promptsText.trim().length === 0,
    );
    if (!hasEmptyPrompts) return;

    void (async () => {
      try {
        const prompts = await loadTemplateQuestions(defaultTemplateId);
        setAssignments((prev) =>
          prev.map((assignment) =>
            assignment.templateId === defaultTemplateId && assignment.promptsText.trim().length === 0
              ? { ...assignment, promptsText: prompts.join("\n"), loadingQuestions: false }
              : assignment,
          ),
        );
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "Erro ao carregar perguntas do template.",
        );
      }
    })();
  }, [assignments, defaultTemplateId, loadTemplateQuestions, templateById]);

  const canSubmit = useMemo(() => {
    if (!client || assignments.length === 0 || templates.length === 0) return false;
    return assignments.every((item) => item.templateId);
  }, [assignments, client, templates.length]);

  async function syncCampaignSectors(
    campaignId: string,
    selectedSectorName: string,
    selectedRiskParameter: number,
  ) {
    const selectedKey = normalize(selectedSectorName);
    const sectorsRes = await fetch(`/api/admin/campaigns/${campaignId}/sectors`, { cache: "no-store" });
    if (!sectorsRes.ok) {
      const sectorsPayload = (await sectorsRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(sectorsPayload.error ?? "Falha ao carregar setores do diagnostico criado.");
    }
    const payload = (await sectorsRes.json()) as { sectors: CampaignSector[] };
    const sectors = payload.sectors ?? [];
    let hasSelected = false;
    for (const sector of sectors) {
      const isSelected = sector.key === selectedKey || normalize(sector.name) === selectedKey;
      if (isSelected) hasSelected = true;
      const syncResponse = await fetch(`/api/admin/campaigns/${campaignId}/sectors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: sector.name,
          riskParameter: sector.riskParameter,
          isActive: isSelected,
        }),
      });
      if (!syncResponse.ok && syncResponse.status !== 207) {
        const syncPayload = (await syncResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(syncPayload.error ?? "Falha ao sincronizar setores do diagnostico criado.");
      }
    }
    if (!hasSelected && selectedSectorName.trim()) {
      const createSelectedRes = await fetch(`/api/admin/campaigns/${campaignId}/sectors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selectedSectorName.trim(),
          riskParameter: selectedRiskParameter,
          isActive: true,
        }),
      });
      if (!createSelectedRes.ok && createSelectedRes.status !== 207) {
        const createSelectedPayload = (await createSelectedRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(createSelectedPayload.error ?? "Falha ao vincular setor do diagnostico criado.");
      }
    }
  }

  async function submitAssignments() {
    if (!client || !canSubmit) return;
    setIsSubmitting(true);
    setError("");
    setSuccess("");
    try {
      for (const assignment of assignments) {
        const template = templateById.get(assignment.templateId) ?? null;
        if (!template) {
          throw new Error(`Template nao encontrado para o setor ${assignment.sectorName}.`);
        }
        if (template.source !== "surveys") {
          throw new Error(`Template invalido para o setor ${assignment.sectorName}. Use um template Survey.`);
        }

        const campaignName = `${template.name} - ${client.companyName} - ${assignment.sectorName}`
          .trim()
          .slice(0, 120);
        if (campaignName.length < 3) {
          throw new Error(`Nome de diagnostico invalido para o setor ${assignment.sectorName}.`);
        }

        const publicSlugSeed = `${client.portalSlug || client.companyName}-${template.slug || template.name}-${assignment.sectorKey || assignment.sectorName}`;

        const assignRes = await fetch(`/api/admin/clients/${client.id}/assign-drps`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaignName,
            publicSlug: publicSlugSeed,
            status: campaignStatus,
            sourceSurveyId: template.id,
          }),
        });

        const assignPayload = (await assignRes.json().catch(() => ({}))) as {
          error?: string;
          details?: string;
          warning?: string;
          campaign?: { id: string };
        };

        if (!assignRes.ok && assignRes.status !== 207) {
          throw new Error(
            assignPayload.error ||
              assignPayload.details ||
              `Falha ao atribuir diagnostico para o setor ${assignment.sectorName}.`,
          );
        }

        if (assignRes.status === 207 && assignPayload.error) {
          throw new Error(
            assignPayload.error ||
              assignPayload.details ||
              `Falha ao atribuir diagnostico para o setor ${assignment.sectorName}.`,
          );
        }

        const campaignId = assignPayload.campaign?.id;
        if (!campaignId) {
          throw new Error(`Resposta invalida ao atribuir diagnostico para o setor ${assignment.sectorName}.`);
        }

        if (template.source === "surveys") {
          const templatePrompts =
            questionsByTemplate[template.id] ?? (await loadTemplateQuestions(template.id));
          const editedPrompts = normalizePrompts(assignment.promptsText);
          const effectivePrompts = editedPrompts.length > 0 ? editedPrompts : templatePrompts;
          const shouldUpdateQuestions = !areSamePrompts(effectivePrompts, templatePrompts);

          if (shouldUpdateQuestions) {
            if (effectivePrompts.some((item) => item.length < 3)) {
              throw new Error(
                `Setor ${assignment.sectorName}: cada pergunta editada precisa ter ao menos 3 caracteres.`,
              );
            }
            const updateQuestionsRes = await fetch(
              `/api/admin/campaigns/${campaignId}/questions`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompts: effectivePrompts }),
              },
            );
            if (!updateQuestionsRes.ok) {
              const updatePayload = (await updateQuestionsRes.json().catch(() => ({}))) as {
                error?: string;
              };
              throw new Error(
                updatePayload.error ||
                  `Falha ao atualizar perguntas do diagnostico para o setor ${assignment.sectorName}.`,
              );
            }
          }
        }
        await syncCampaignSectors(
          campaignId,
          assignment.sectorName,
          assignment.sectorRiskParameter,
        );
      }

      setSuccess("Diagnosticos DRPS atribuidos com sucesso para os setores selecionados.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Erro ao atribuir diagnosticos.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) return <p className="text-sm text-[#49697a]">Carregando atribuicao de diagnosticos...</p>;
  if (!client) return <p className="text-sm text-red-600">{error || "Cliente indisponivel."}</p>;

  return (
    <div className="space-y-6">
      <nav className="text-xs text-[#4f6977]">
        <Link href="/manager" className="text-[#0f5b73]">
          Home
        </Link>{" "}
        /{" "}
        <Link href="/manager/clients" className="text-[#0f5b73]">
          Client area
        </Link>{" "}
        /{" "}
        <Link href={`/manager/clients/${client.id}`} className="text-[#0f5b73]">
          {client.companyName}
        </Link>{" "}
        /{" "}
        <Link href={`/manager/clients/${client.id}/assign-drps`} className="text-[#0f5b73]">
          Atribuir diagnostico DRPS
        </Link>
      </nav>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#123447]">Atribuir diagnosticos DRPS</h2>
        <p className="mt-1 text-sm text-[#35515f]">
          Selecione templates da base DRPS por setor, edite a lista de perguntas e publique os
          diagnosticos em lote.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-[#d8e4ee] p-3">
            <p className="text-xs text-[#4f6977]">Empresa</p>
            <p className="mt-1 text-sm font-semibold text-[#133748]">{client.companyName}</p>
          </div>
          <label className="rounded-xl border border-[#d8e4ee] p-3">
            <span className="text-xs text-[#4f6977]">Status inicial dos diagnosticos</span>
            <select
              className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
              value={campaignStatus}
              onChange={(event) => setCampaignStatus(event.target.value as "draft" | "live")}
            >
              <option value="live">Ativo</option>
              <option value="draft">Rascunho</option>
            </select>
          </label>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">Configuracao por setor</h3>
        {assignments.map((assignment) => {
          const selectedTemplate = templateById.get(assignment.templateId) ?? null;
          const supportsQuestionEditing = selectedTemplate?.source === "surveys";
          return (
            <article key={assignment.sectorId} className="rounded-xl border border-[#d8e4ee] p-4">
              <p className="text-xs uppercase tracking-[0.12em] text-[#4f6977]">Setor</p>
              <p className="text-sm font-semibold text-[#133748]">{assignment.sectorName}</p>

              <div className="mt-3 grid gap-3">
                <label className="space-y-1">
                  <span className="text-xs text-[#4f6977]">Template DRPS da base</span>
                  <select
                    value={assignment.templateId}
                    onChange={(event) => void applyTemplateToSector(assignment.sectorId, event.target.value)}
                    className="w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                  >
                    {templates.length === 0 ? <option value="">Sem templates na base</option> : null}
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} ({mapStatus(template.status)})
                      </option>
                    ))}
                  </select>
                </label>

                {supportsQuestionEditing ? (
                  <label className="space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-[#4f6977]">Lista de perguntas (uma por linha)</span>
                      <button
                        type="button"
                        onClick={() => void applyTemplateToSector(assignment.sectorId, assignment.templateId)}
                        className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                      >
                        Recarregar do template
                      </button>
                    </div>
                    <textarea
                      value={assignment.promptsText}
                      onChange={(event) =>
                        setAssignments((prev) =>
                          prev.map((item) =>
                            item.sectorId === assignment.sectorId
                              ? { ...item, promptsText: event.target.value }
                              : item,
                          ),
                        )
                      }
                      rows={8}
                      className="w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                      placeholder={
                        assignment.loadingQuestions
                          ? "Carregando perguntas do template..."
                          : "Digite uma pergunta por linha."
                      }
                    />
                  </label>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>

      <section className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canSubmit || isSubmitting}
          onClick={() => void submitAssignments()}
          className="rounded-full bg-[#0f5b73] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isSubmitting ? "Atribuindo..." : "Atribuir diagnosticos DRPS"}
        </button>
        <Link
          href={`/manager/clients/${client.id}`}
          className="rounded-full border border-[#9ec8db] px-5 py-2 text-sm font-semibold text-[#0f5b73]"
        >
          Voltar para ficha
        </Link>
      </section>

      {success ? <p className="text-sm text-[#1f6b2f]">{success}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
