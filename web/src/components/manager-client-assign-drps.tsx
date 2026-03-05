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

function createSectorAssignment(sector: ClientSector, templateId: string): SectorAssignment {
  return {
    sectorId: sector.id,
    sectorKey: sector.key,
    sectorName: sector.name,
    sectorRiskParameter: sector.riskParameter,
    templateId,
    promptsText: "",
    loadingQuestions: false,
  };
}

export function ManagerClientAssignDrps({ clientId }: { clientId: string }) {
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [templates, setTemplates] = useState<DiagnosticTemplateOption[]>([]);
  const [assignments, setAssignments] = useState<SectorAssignment[]>([]);
  const [sectorToAddId, setSectorToAddId] = useState("");
  const [questionsByTemplate, setQuestionsByTemplate] = useState<Record<string, string[]>>({});
  const [questionnaireSectorId, setQuestionnaireSectorId] = useState<string | null>(null);
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
        nextClient.sectors.map((sector) => createSectorAssignment(sector, firstTemplateId)),
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

  const questionnaireAssignment = useMemo(() => {
    if (!questionnaireSectorId) return null;
    return assignments.find((item) => item.sectorId === questionnaireSectorId) ?? null;
  }, [assignments, questionnaireSectorId]);

  const questionnaireTemplate = useMemo(() => {
    if (!questionnaireAssignment) return null;
    return templateById.get(questionnaireAssignment.templateId) ?? null;
  }, [questionnaireAssignment, templateById]);

  const availableSectors = useMemo(() => {
    if (!client) return [] as ClientSector[];
    const assignedSectorIds = new Set(assignments.map((item) => item.sectorId));
    return client.sectors.filter((sector) => !assignedSectorIds.has(sector.id));
  }, [assignments, client]);

  useEffect(() => {
    if (!questionnaireSectorId) return;
    const stillExists = assignments.some((item) => item.sectorId === questionnaireSectorId);
    if (!stillExists) setQuestionnaireSectorId(null);
  }, [assignments, questionnaireSectorId]);

  useEffect(() => {
    if (availableSectors.length === 0) {
      setSectorToAddId("");
      return;
    }
    const stillAvailable = availableSectors.some((sector) => sector.id === sectorToAddId);
    if (!stillAvailable) {
      setSectorToAddId(availableSectors[0]?.id ?? "");
    }
  }, [availableSectors, sectorToAddId]);

  function removeSectorAssignment(sectorId: string) {
    setAssignments((prev) => prev.filter((item) => item.sectorId !== sectorId));
  }

  function addSectorAssignment() {
    if (!client || !sectorToAddId) return;
    const sector = client.sectors.find((item) => item.id === sectorToAddId);
    if (!sector) return;

    setAssignments((prev) => {
      if (prev.some((item) => item.sectorId === sector.id)) return prev;
      return [...prev, createSectorAssignment(sector, defaultTemplateId)];
    });
  }

  async function syncCampaignSectors(campaignId: string, selectedAssignments: SectorAssignment[]) {
    const selectedByKey = new Map<
      string,
      {
        key: string;
        name: string;
        riskParameter: number;
      }
    >();
    for (const assignment of selectedAssignments) {
      const normalizedKey = normalize(assignment.sectorKey || assignment.sectorName);
      if (!normalizedKey) continue;
      selectedByKey.set(normalizedKey, {
        key: normalizedKey,
        name: assignment.sectorName.trim(),
        riskParameter: assignment.sectorRiskParameter,
      });
    }
    if (selectedByKey.size === 0) {
      throw new Error("Selecione ao menos um setor para a campanha umbrella.");
    }

    const sectorsRes = await fetch(`/api/admin/campaigns/${campaignId}/sectors`, { cache: "no-store" });
    if (!sectorsRes.ok) {
      const sectorsPayload = (await sectorsRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(sectorsPayload.error ?? "Falha ao carregar setores do diagnostico criado.");
    }
    const payload = (await sectorsRes.json()) as { sectors: CampaignSector[] };
    const sectors = payload.sectors ?? [];
    const syncedKeys = new Set<string>();
    for (const sector of sectors) {
      const normalizedExistingKey = normalize(sector.key || sector.name);
      const selected = selectedByKey.get(normalizedExistingKey) ?? null;
      if (selected) syncedKeys.add(selected.key);
      const syncResponse = await fetch(`/api/admin/campaigns/${campaignId}/sectors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selected?.name || sector.name,
          riskParameter: selected?.riskParameter ?? sector.riskParameter,
          isActive: Boolean(selected),
        }),
      });
      if (!syncResponse.ok && syncResponse.status !== 207) {
        const syncPayload = (await syncResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(syncPayload.error ?? "Falha ao sincronizar setores do diagnostico criado.");
      }
    }

    for (const selected of selectedByKey.values()) {
      if (syncedKeys.has(selected.key)) continue;
      const createSelectedRes = await fetch(`/api/admin/campaigns/${campaignId}/sectors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selected.name,
          riskParameter: selected.riskParameter,
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
      const uniqueTemplateIds = Array.from(new Set(assignments.map((assignment) => assignment.templateId)));
      if (uniqueTemplateIds.length !== 1) {
        throw new Error(
          "A campanha umbrella DRPS usa um template unico. Selecione o mesmo template para todos os setores.",
        );
      }

      const template = templateById.get(uniqueTemplateIds[0]) ?? null;
      if (!template) {
        throw new Error("Template base nao encontrado.");
      }
      if (template.source !== "surveys") {
        throw new Error("Template invalido. Use um template Survey para a campanha umbrella.");
      }

      const templatePrompts =
        questionsByTemplate[template.id] ?? (await loadTemplateQuestions(template.id));
      const effectivePromptsBySector = assignments.map((assignment) => {
        const editedPrompts = normalizePrompts(assignment.promptsText);
        const effectivePrompts = editedPrompts.length > 0 ? editedPrompts : templatePrompts;
        if (effectivePrompts.some((item) => item.length < 3)) {
          throw new Error(
            `Setor ${assignment.sectorName}: cada pergunta editada precisa ter ao menos 3 caracteres.`,
          );
        }
        return {
          sectorName: assignment.sectorName,
          prompts: effectivePrompts,
        };
      });

      const referencePrompts = effectivePromptsBySector[0]?.prompts ?? templatePrompts;
      for (const item of effectivePromptsBySector) {
        if (!areSamePrompts(item.prompts, referencePrompts)) {
          throw new Error(
            "Neste fluxo umbrella, todos os setores compartilham o mesmo questionario base. Uniformize as perguntas antes de publicar.",
          );
        }
      }

      const campaignName = `${template.name} - ${client.companyName}`.trim().slice(0, 120);
      if (campaignName.length < 3) {
        throw new Error("Nome da campanha umbrella invalido.");
      }
      const publicSlugSeed = `${client.portalSlug || client.companyName}-${template.slug || template.name}-umbrella`;
      const publicSlug = slugify(publicSlugSeed).slice(0, 120);

      const assignRes = await fetch(`/api/admin/clients/${client.id}/assign-drps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignName,
          publicSlug: publicSlug || undefined,
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
        throw new Error(assignPayload.error || assignPayload.details || "Falha ao criar campanha umbrella DRPS.");
      }
      if (assignRes.status === 207 && assignPayload.error) {
        throw new Error(assignPayload.error || assignPayload.details || "Falha ao criar campanha umbrella DRPS.");
      }

      const campaignId = assignPayload.campaign?.id;
      if (!campaignId) {
        throw new Error("Resposta invalida ao criar campanha umbrella DRPS.");
      }

      const shouldUpdateQuestions = !areSamePrompts(referencePrompts, templatePrompts);
      if (shouldUpdateQuestions) {
        const updateQuestionsRes = await fetch(`/api/admin/campaigns/${campaignId}/questions`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompts: referencePrompts }),
        });
        if (!updateQuestionsRes.ok) {
          const updatePayload = (await updateQuestionsRes.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(updatePayload.error || "Falha ao atualizar perguntas da campanha umbrella.");
        }
      }

      await syncCampaignSectors(campaignId, assignments);
      setSuccess("Campanha umbrella DRPS atribuida com sucesso. Setores foram vinculados como sub-questionarios.");
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
          Crie uma campanha umbrella DRPS unica, vincule os setores como sub-questionarios e
          publique a coleta em um unico pacote.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-[#d8e4ee] p-3">
            <p className="text-xs text-[#4f6977]">Empresa</p>
            <p className="mt-1 text-sm font-semibold text-[#133748]">{client.companyName}</p>
          </div>
          <label className="rounded-xl border border-[#d8e4ee] p-3">
            <span className="text-xs text-[#4f6977]">Status inicial da campanha umbrella</span>
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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-lg font-semibold text-[#123447]">Configuracao por setor</h3>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="text-xs text-[#4f6977]">Setor disponivel</span>
              <select
                value={sectorToAddId}
                onChange={(event) => setSectorToAddId(event.target.value)}
                disabled={availableSectors.length === 0}
                className="min-w-52 rounded border border-[#c9dce8] px-3 py-2 text-sm disabled:opacity-70"
              >
                {availableSectors.length === 0 ? (
                  <option value="">Todos os setores ja estao na lista</option>
                ) : null}
                {availableSectors.map((sector) => (
                  <option key={sector.id} value={sector.id}>
                    {sector.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => addSectorAssignment()}
              disabled={!sectorToAddId}
              className="rounded-full border border-[#9ec8db] px-3 py-2 text-xs font-semibold text-[#0f5b73] disabled:opacity-50"
            >
              Add setor
            </button>
          </div>
        </div>
        {assignments.length === 0 ? (
          <p className="text-sm text-[#4f6977]">
            Nenhum setor selecionado. Adicione ao menos um setor para atribuir diagnosticos.
          </p>
        ) : null}
        {assignments.map((assignment) => {
          const selectedTemplate = templateById.get(assignment.templateId) ?? null;
          const supportsQuestionEditing = selectedTemplate?.source === "surveys";
          return (
            <article key={assignment.sectorId} className="rounded-xl border border-[#d8e4ee] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-[#4f6977]">Setor</p>
                  <p className="text-sm font-semibold text-[#133748]">{assignment.sectorName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeSectorAssignment(assignment.sectorId)}
                  className="rounded-full border border-[#e9c0c0] px-3 py-1 text-xs font-semibold text-[#8f2a2a]"
                >
                  Remover setor
                </button>
              </div>

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
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-[#4f6977]">
                        Perguntas customizadas: {normalizePrompts(assignment.promptsText).length}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQuestionnaireSectorId(assignment.sectorId)}
                        className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                      >
                        mostra questionario
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>

      <section className="flex flex-wrap gap-2">
        <p className="w-full text-xs text-[#4f6977]">
          Fluxo umbrella: todos os setores selecionados serao publicados dentro da mesma campanha DRPS.
          No momento, o pacote usa um unico template/questionario base para todos os setores.
        </p>
        <button
          type="button"
          disabled={!canSubmit || isSubmitting}
          onClick={() => void submitAssignments()}
          className="rounded-full bg-[#0f5b73] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isSubmitting ? "Atribuindo..." : "Atribuir campanha umbrella DRPS"}
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

      {questionnaireAssignment && questionnaireTemplate?.source === "surveys" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2532]/45 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-[#c9dce8] bg-white p-5 shadow-xl">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-[#4f6977]">
                  {questionnaireAssignment.sectorName}
                </p>
                <h4 className="text-lg font-semibold text-[#123447]">
                  Lista de perguntas (uma por linha)
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setQuestionnaireSectorId(null)}
                className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447]"
              >
                Fechar
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-[#4f6977]">
                Template atual: {questionnaireTemplate.name} ({mapStatus(questionnaireTemplate.status)})
              </p>
              <button
                type="button"
                onClick={() =>
                  void applyTemplateToSector(questionnaireAssignment.sectorId, questionnaireAssignment.templateId)
                }
                className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
              >
                Recarregar do template
              </button>
            </div>

            <textarea
              value={questionnaireAssignment.promptsText}
              onChange={(event) =>
                setAssignments((prev) =>
                  prev.map((item) =>
                    item.sectorId === questionnaireAssignment.sectorId
                      ? { ...item, promptsText: event.target.value }
                      : item,
                  ),
                )
              }
              rows={12}
              className="mt-3 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
              placeholder={
                questionnaireAssignment.loadingQuestions
                  ? "Carregando perguntas do template..."
                  : "Digite uma pergunta por linha."
              }
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
