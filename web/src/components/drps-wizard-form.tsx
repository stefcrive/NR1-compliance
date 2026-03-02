"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type CampaignOption = {
  id: string;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
};

type DrpsFormState = {
  surveyId: string;
  sector: string;
  psychologistName: string;
  psychologistCrp: string;
  companyName: string;
  companyCnpj: string;
  referencePeriod: string;
  part1Answers: Record<string, number>;
  criticalTopics: number[];
  governanceActions: string[];
  notes: string;
};

type DrpsSubmitResult = {
  item: {
    id: string;
    part1_probability_score: number;
    part1_probability_class: "low" | "medium" | "high";
  };
  derived: {
    recommendedPrograms: string[];
  };
};

const STEP_TITLES = [
  "Identificacao",
  "Matriz Qualitativa",
  "Topicos Criticos e Governanca",
  "Revisao e Envio",
];

const PART1_QUESTIONS = [
  { key: "freq_regularidade", label: "Com que regularidade o risco psicossocial ocorre no ambiente?" },
  { key: "freq_duracao", label: "Qual e a duracao tipica dos episodios desse risco?" },
  { key: "freq_impactados", label: "Quantos colaboradores sao afetados simultaneamente?" },
  { key: "hist_registros", label: "Ha registros anteriores de incidentes relacionados a esse risco?" },
  { key: "hist_gravidade", label: "Qual foi a gravidade dos incidentes anteriores?" },
  { key: "hist_causas", label: "As causas foram identificadas e abordadas com eficacia?" },
  { key: "rec_medidas", label: "Quais medidas preventivas estao atualmente implementadas?" },
  { key: "rec_revisao", label: "Com que frequencia as medidas preventivas sao revisadas?" },
  { key: "rec_conhecimento", label: "Qual e o nivel de conhecimento sobre mitigacao?" },
  { key: "rec_recursos", label: "Existem recursos dedicados para apoiar a implementacao?" },
];

const TOPICS = [
  { id: 1, label: "T01 Assedio de qualquer natureza" },
  { id: 2, label: "T02 Falta de suporte/apoio" },
  { id: 3, label: "T03 Ma gestao de mudancas" },
  { id: 4, label: "T04 Baixa clareza de papel" },
  { id: 5, label: "T05 Baixas recompensas e reconhecimento" },
  { id: 6, label: "T06 Baixo controle/falta de autonomia" },
  { id: 7, label: "T07 Baixa justica organizacional" },
  { id: 8, label: "T08 Eventos violentos/traumaticos" },
  { id: 9, label: "T09 Baixa demanda (subcarga)" },
  { id: 10, label: "T10 Excesso de demandas (sobrecarga)" },
  { id: 11, label: "T11 Maus relacionamentos" },
  { id: 12, label: "T12 Dificil comunicacao" },
  { id: 13, label: "T13 Trabalho remoto e isolado" },
];

const GOVERNANCE_OPTIONS = [
  "Check-list de aplicacao das acoes",
  "Reuniao mensal de acompanhamento",
  "Reaplicacao periodica do DRPS",
  "Auditoria interna do sistema psicossocial",
  "Treinamento continuo de liderancas e RH",
  "Comite multidisciplinar integrado (TST, Eng, MT, Enf, RH, CIPA, SIPAT, Ergonomista)",
];

function optionStyle(selected: boolean) {
  return selected
    ? "border-[#0f6077] bg-[#e8f3f8] text-[#0f6077]"
    : "border-[#c9dce8] bg-white text-[#2f5060]";
}

export function DrpsWizardForm() {
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitResult, setSubmitResult] = useState<DrpsSubmitResult | null>(null);

  const [form, setForm] = useState<DrpsFormState>({
    surveyId: "",
    sector: "",
    psychologistName: "",
    psychologistCrp: "",
    companyName: "",
    companyCnpj: "",
    referencePeriod: "",
    part1Answers: {},
    criticalTopics: [],
    governanceActions: [],
    notes: "",
  });

  useEffect(() => {
    let ignore = false;
    async function loadCampaigns() {
      const response = await fetch("/api/admin/campaigns", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { campaigns: CampaignOption[] };
      if (ignore) {
        return;
      }
      const liveCampaigns = (payload.campaigns ?? []).filter((item) => item.status === "live");
      setCampaigns(liveCampaigns);
      if (!form.surveyId && liveCampaigns.length > 0) {
        setForm((previous) => ({ ...previous, surveyId: liveCampaigns[0].id }));
      }
    }
    void loadCampaigns();
    return () => {
      ignore = true;
    };
  }, [form.surveyId]);

  const progress = useMemo(() => ((step + 1) / STEP_TITLES.length) * 100, [step]);

  function setPart1Score(key: string, score: number) {
    setForm((previous) => ({
      ...previous,
      part1Answers: {
        ...previous.part1Answers,
        [key]: score,
      },
    }));
  }

  function toggleCriticalTopic(topicId: number) {
    setForm((previous) => ({
      ...previous,
      criticalTopics: previous.criticalTopics.includes(topicId)
        ? previous.criticalTopics.filter((item) => item !== topicId)
        : [...previous.criticalTopics, topicId],
    }));
  }

  function toggleGovernance(option: string) {
    setForm((previous) => ({
      ...previous,
      governanceActions: previous.governanceActions.includes(option)
        ? previous.governanceActions.filter((item) => item !== option)
        : [...previous.governanceActions, option],
    }));
  }

  function canContinueCurrentStep() {
    if (step === 0) {
      return (
        form.surveyId &&
        form.sector.trim() &&
        form.psychologistName.trim() &&
        form.companyName.trim() &&
        form.referencePeriod.trim()
      );
    }
    if (step === 1) {
      return PART1_QUESTIONS.every((question) => form.part1Answers[question.key] !== undefined);
    }
    return true;
  }

  async function handleSubmit() {
    setSubmitError("");
    setIsSubmitting(true);
    try {
      const part1Answers = PART1_QUESTIONS.map((question) => ({
        key: question.key,
        label: question.label,
        score: Number(form.part1Answers[question.key]),
      }));
      const response = await fetch("/api/admin/drps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surveyId: form.surveyId,
          sector: form.sector,
          psychologistName: form.psychologistName,
          psychologistCrp: form.psychologistCrp || undefined,
          companyName: form.companyName,
          companyCnpj: form.companyCnpj || undefined,
          referencePeriod: form.referencePeriod,
          part1Answers,
          criticalTopics: form.criticalTopics,
          governanceActions: form.governanceActions,
          notes: form.notes || undefined,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Nao foi possivel salvar DRPS.");
      }
      const payload = (await response.json()) as DrpsSubmitResult;
      setSubmitResult(payload);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Erro no envio do DRPS.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitResult) {
    return (
      <div className="space-y-6 rounded-2xl border border-[#d8e4ee] bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#123447]">DRPS salvo com sucesso</h2>
        <p className="text-sm text-[#345466]">
          Probabilidade qualitativa:{" "}
          <strong>
            {submitResult.item.part1_probability_score.toFixed(2)} (
            {submitResult.item.part1_probability_class})
          </strong>
        </p>
        <div>
          <p className="text-sm font-semibold text-[#163a4c]">Programas recomendados</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#355565]">
            {submitResult.derived.recommendedPrograms.map((program) => (
              <li key={program}>{program}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/portal/dashboard"
            className="rounded-full bg-[#0f5b73] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0c4d61]"
          >
            Ver dashboard compilado
          </Link>
          <button
            type="button"
            onClick={() => {
              setSubmitResult(null);
              setStep(0);
            }}
            className="rounded-full border border-[#9ec8db] px-5 py-2 text-sm font-semibold text-[#0e4e62] hover:bg-[#e8f3f8]"
          >
            Cadastrar novo DRPS
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-2xl border border-[#d8e4ee] bg-white p-6 shadow-sm">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-[#0f6077]">Formulario tecnico DRPS</p>
        <h2 className="mt-1 text-2xl font-semibold text-[#123447]">{STEP_TITLES[step]}</h2>
        <div className="mt-3 h-2 rounded bg-[#edf3f7]">
          <div className="h-2 rounded bg-[#0f6077]" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-1 text-xs text-[#4f6977]">
          Etapa {step + 1} de {STEP_TITLES.length}
        </p>
      </header>

      {step === 0 ? (
        <section className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium text-[#244a5c]">Campanha</span>
            <select
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={form.surveyId}
              onChange={(event) => setForm((previous) => ({ ...previous, surveyId: event.target.value }))}
            >
              <option value="">Selecione...</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-[#244a5c]">Setor avaliado</span>
            <input
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={form.sector}
              onChange={(event) => setForm((previous) => ({ ...previous, sector: event.target.value }))}
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-[#244a5c]">Periodo de referencia</span>
            <input
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              placeholder="Ex: Jan/2026 a Mar/2026"
              value={form.referencePeriod}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, referencePeriod: event.target.value }))
              }
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-[#244a5c]">Psicologo responsavel</span>
            <input
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={form.psychologistName}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, psychologistName: event.target.value }))
              }
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-[#244a5c]">CRP (opcional)</span>
            <input
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={form.psychologistCrp}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, psychologistCrp: event.target.value }))
              }
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-[#244a5c]">Empresa</span>
            <input
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={form.companyName}
              onChange={(event) => setForm((previous) => ({ ...previous, companyName: event.target.value }))}
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium text-[#244a5c]">CNPJ (opcional)</span>
            <input
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={form.companyCnpj}
              onChange={(event) => setForm((previous) => ({ ...previous, companyCnpj: event.target.value }))}
            />
          </label>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="space-y-4">
          {PART1_QUESTIONS.map((question) => (
            <article key={question.key} className="rounded-xl border border-[#dbe8ef] p-4">
              <p className="text-sm font-medium text-[#1f4354]">{question.label}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5].map((score) => (
                  <button
                    key={`${question.key}-${score}`}
                    type="button"
                    onClick={() => setPart1Score(question.key, score)}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium ${optionStyle(
                      form.part1Answers[question.key] === score,
                    )}`}
                  >
                    {score}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-[#1f4354]">Topicos criticos identificados</h3>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {TOPICS.map((topic) => (
                <label
                  key={topic.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${optionStyle(
                    form.criticalTopics.includes(topic.id),
                  )}`}
                >
                  <input
                    type="checkbox"
                    checked={form.criticalTopics.includes(topic.id)}
                    onChange={() => toggleCriticalTopic(topic.id)}
                  />
                  {topic.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[#1f4354]">Acoes de governanca para melhoria continua</h3>
            <div className="mt-2 space-y-2">
              {GOVERNANCE_OPTIONS.map((action) => (
                <label
                  key={action}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${optionStyle(
                    form.governanceActions.includes(action),
                  )}`}
                >
                  <input
                    type="checkbox"
                    checked={form.governanceActions.includes(action)}
                    onChange={() => toggleGovernance(action)}
                  />
                  {action}
                </label>
              ))}
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-sm font-semibold text-[#1f4354]">Observacoes tecnicas</span>
            <textarea
              rows={5}
              className="w-full rounded-lg border border-[#c9dce8] px-3 py-2 text-sm"
              value={form.notes}
              onChange={(event) => setForm((previous) => ({ ...previous, notes: event.target.value }))}
            />
          </label>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-4 rounded-xl border border-[#dbe8ef] p-4">
          <h3 className="text-sm font-semibold text-[#1f4354]">Revisao final</h3>
          <ul className="space-y-1 text-sm text-[#2f5060]">
            <li>
              Campanha selecionada:{" "}
              <strong>{campaigns.find((item) => item.id === form.surveyId)?.name ?? "-"}</strong>
            </li>
            <li>
              Setor: <strong>{form.sector}</strong>
            </li>
            <li>
              Psicologo: <strong>{form.psychologistName}</strong>
            </li>
            <li>
              Respostas matriz qualitativa:{" "}
              <strong>
                {Object.keys(form.part1Answers).length}/{PART1_QUESTIONS.length}
              </strong>
            </li>
            <li>
              Topicos criticos: <strong>{form.criticalTopics.length}</strong>
            </li>
            <li>
              Acoes de governanca: <strong>{form.governanceActions.length}</strong>
            </li>
          </ul>

          <p className="text-xs text-[#5a7483]">
            Ao enviar, o sistema classifica a probabilidade qualitativa, seleciona programas de
            intervencao recomendados e integra o resultado ao dashboard do portal.
          </p>
        </section>
      ) : null}

      {submitError && <p className="text-sm text-red-600">{submitError}</p>}

      <footer className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((previous) => Math.max(previous - 1, 0))}
          className="rounded-full border border-[#9ec8db] px-5 py-2 text-sm font-semibold text-[#0f5b73] disabled:opacity-40"
        >
          Voltar
        </button>

        {step < STEP_TITLES.length - 1 ? (
          <button
            type="button"
            disabled={!canContinueCurrentStep()}
            onClick={() => setStep((previous) => Math.min(previous + 1, STEP_TITLES.length - 1))}
            className="rounded-full bg-[#0f5b73] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Continuar
          </button>
        ) : (
          <button
            type="button"
            disabled={isSubmitting || !canContinueCurrentStep()}
            onClick={handleSubmit}
            className="rounded-full bg-[#0f5b73] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {isSubmitting ? "Enviando..." : "Salvar DRPS"}
          </button>
        )}
      </footer>
    </div>
  );
}
