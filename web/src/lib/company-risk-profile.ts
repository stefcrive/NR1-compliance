export type CompanyRiskProbabilityClass = "baixa" | "media" | "alta";

export type CompanyRiskProfileFactorDefinition = {
  key: string;
  label: string;
};

export type CompanyRiskProfileQuestionDefinition = {
  key: string;
  criterion: string;
  prompt: string;
  options: string[];
  scoringRule: "direct" | "inverse";
};

export type CompanyRiskProfileAnswers = Record<string, Record<string, number>>;

export type CompanyRiskProfileQuestionScore = {
  questionKey: string;
  criterion: string;
  prompt: string;
  optionIndex: number;
  optionLabel: string;
  score: number;
};

export type CompanyRiskProfileFactorScore = {
  factorKey: string;
  factorLabel: string;
  score: number;
  probabilityClass: CompanyRiskProbabilityClass;
  questionScores: CompanyRiskProfileQuestionScore[];
};

export type CompanyRiskProfileComputation = {
  overallScore: number;
  overallClass: CompanyRiskProbabilityClass;
  summaryCounts: Record<CompanyRiskProbabilityClass, number>;
  factorScores: CompanyRiskProfileFactorScore[];
  answers: CompanyRiskProfileAnswers;
};

export type NormalizeCompanyRiskProfileAnswersOptions = {
  allowIncomplete?: boolean;
};

export const COMPANY_RISK_PROFILE_QUESTIONNAIRE_VERSION = "questionario-impresa-2026-v1";

export const COMPANY_RISK_PROFILE_FACTORS: CompanyRiskProfileFactorDefinition[] = [
  { key: "assedio-moral", label: "Assedio Moral" },
  { key: "carga-excessiva", label: "Carga Excessiva de Trabalho" },
  { key: "falta-reconhecimento", label: "Falta de Reconhecimento e Recompensas" },
  { key: "clima-organizacional", label: "Clima Organizacional" },
  { key: "falta-autonomia", label: "Falta de Autonomia e Controle sobre o Trabalho" },
  { key: "pressao-metas", label: "Pressao e Metas Irrealistas" },
  { key: "inseguranca-ameacas", label: "Inseguranca e Ameacas" },
  { key: "conflitos-comunicacao", label: "Conflitos Interpessoais e Falta de Comunicacao" },
  { key: "vida-pessoal-profissional", label: "Alinhamento entre Vida Pessoal e Profissional" },
];

export const COMPANY_RISK_PROFILE_QUESTIONS: CompanyRiskProfileQuestionDefinition[] = [
  {
    key: "frequencia-ocorrencia",
    criterion: "Frequencia",
    prompt: "Com que regularidade o risco psicossocial ocorre no ambiente de trabalho?",
    options: ["Nunca", "Raramente", "Ocasionalmente", "Frequentemente", "Sempre"],
    scoringRule: "direct",
  },
  {
    key: "duracao-episodios",
    criterion: "Frequencia",
    prompt: "Qual e a duracao tipica dos episodios desse risco?",
    options: [
      "Menos de uma hora",
      "Algumas horas",
      "Um dia inteiro",
      "Dois a tres dias",
      "Varios dias consecutivos",
    ],
    scoringRule: "direct",
  },
  {
    key: "colaboradores-afetados",
    criterion: "Frequencia",
    prompt: "Quantos colaboradores sao afetados simultaneamente quando o risco ocorre?",
    options: [
      "Nenhum",
      "1-2 colaboradores",
      "3-5 colaboradores",
      "6-10 colaboradores",
      "Mais de 10 colaboradores",
    ],
    scoringRule: "direct",
  },
  {
    key: "historico-incidentes",
    criterion: "Historico do Risco no Setor",
    prompt: "Ha registros anteriores de incidentes relacionados a esse risco no setor?",
    options: [
      "Nao ha registros",
      "Registros esporadicos",
      "Registros ocasionais",
      "Registros frequentes",
      "Registros constantes",
    ],
    scoringRule: "direct",
  },
  {
    key: "gravidade-incidentes",
    criterion: "Historico do Risco no Setor",
    prompt: "Qual foi a gravidade dos incidentes anteriores relacionados a esse risco?",
    options: ["Nenhum impacto", "Impacto leve", "Impacto moderado", "Impacto significativo", "Impacto severo"],
    scoringRule: "direct",
  },
  {
    key: "causas-identificadas",
    criterion: "Historico do Risco no Setor",
    prompt: "As causas desses incidentes foram identificadas e abordadas de forma eficaz?",
    options: [
      "Nao identificadas",
      "Identificadas, mas nao abordadas",
      "Identificadas e parcialmente abordadas",
      "Identificadas e abordadas na maioria dos casos",
      "Identificadas e totalmente abordadas",
    ],
    scoringRule: "inverse",
  },
  {
    key: "medidas-preventivas",
    criterion: "Recursos Disponiveis",
    prompt: "Quais medidas preventivas estao atualmente implementadas para mitigar esse risco?",
    options: [
      "Nenhuma medida",
      "Medidas informais",
      "Procedimentos formais documentados",
      "Treinamentos regulares",
      "Suporte psicologico disponivel",
    ],
    scoringRule: "inverse",
  },
  {
    key: "frequencia-revisao-medidas",
    criterion: "Recursos Disponiveis",
    prompt: "Com que frequencia as medidas preventivas existentes sao revisadas ou atualizadas?",
    options: ["Nunca", "Raramente", "Anualmente", "Semestralmente", "Trimestralmente ou mais frequentemente"],
    scoringRule: "inverse",
  },
  {
    key: "nivel-conhecimento",
    criterion: "Recursos Disponiveis",
    prompt: "Qual e o nivel de conhecimento e treinamento dos gestores e colaboradores sobre as medidas de mitigacao disponiveis?",
    options: [
      "Nenhum conhecimento",
      "Conhecimento basico",
      "Conhecimento intermediario",
      "Alto nivel de conhecimento",
      "Conhecimento especializado e atualizado",
    ],
    scoringRule: "inverse",
  },
  {
    key: "recursos-dedicados",
    criterion: "Recursos Disponiveis",
    prompt: "Existem recursos dedicados para apoiar a implementacao e monitoramento das medidas de mitigacao?",
    options: [
      "Nao existem recursos dedicados",
      "Recursos limitados disponiveis",
      "Recursos moderados disponiveis",
      "Recursos adequados disponiveis",
      "Recursos amplamente disponiveis e acessiveis",
    ],
    scoringRule: "inverse",
  },
];

const SCORE_SCALE_BY_OPTION_COUNT: Record<number, number[]> = {
  1: [2],
  2: [1, 3],
  3: [1, 2, 3],
  4: [1, 2, 2, 3],
  5: [1, 1, 2, 3, 3],
};

export function createEmptyCompanyRiskProfileAnswers(): CompanyRiskProfileAnswers {
  const answers: CompanyRiskProfileAnswers = {};
  for (const factor of COMPANY_RISK_PROFILE_FACTORS) {
    answers[factor.key] = {};
    for (const question of COMPANY_RISK_PROFILE_QUESTIONS) {
      answers[factor.key][question.key] = -1;
    }
  }
  return answers;
}

export function totalCompanyRiskProfileQuestions(): number {
  return COMPANY_RISK_PROFILE_FACTORS.length * COMPANY_RISK_PROFILE_QUESTIONS.length;
}

export function countAnsweredCompanyRiskProfileAnswers(answers: CompanyRiskProfileAnswers): number {
  let count = 0;
  for (const factor of COMPANY_RISK_PROFILE_FACTORS) {
    const byFactor = answers[factor.key] ?? {};
    for (const question of COMPANY_RISK_PROFILE_QUESTIONS) {
      const value = byFactor[question.key];
      if (Number.isInteger(value) && value >= 0) {
        count += 1;
      }
    }
  }
  return count;
}

export function normalizeCompanyRiskProfileAnswers(
  input: unknown,
  options?: NormalizeCompanyRiskProfileAnswersOptions,
): CompanyRiskProfileAnswers {
  const allowIncomplete = options?.allowIncomplete ?? true;
  const answers = createEmptyCompanyRiskProfileAnswers();
  const root = input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  for (const factor of COMPANY_RISK_PROFILE_FACTORS) {
    const rawFactor = root[factor.key];
    const byFactor =
      rawFactor && typeof rawFactor === "object" ? (rawFactor as Record<string, unknown>) : {};

    for (const question of COMPANY_RISK_PROFILE_QUESTIONS) {
      const rawValue = byFactor[question.key];
      const numeric = typeof rawValue === "number" ? rawValue : Number.parseInt(String(rawValue ?? ""), 10);
      const parsed = Number.isInteger(numeric) ? numeric : -1;
      const minValue = allowIncomplete ? -1 : 0;
      const maxValue = question.options.length - 1;
      answers[factor.key][question.key] =
        parsed >= minValue && parsed <= maxValue ? parsed : allowIncomplete ? -1 : 0;
    }
  }

  return answers;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function classifyProbability(value: number): CompanyRiskProbabilityClass {
  if (value < 1.67) return "baixa";
  if (value < 2.34) return "media";
  return "alta";
}

function scoreOptionIndex(
  optionIndex: number,
  optionCount: number,
  scoringRule: "direct" | "inverse",
): number {
  const scale = SCORE_SCALE_BY_OPTION_COUNT[optionCount] ?? SCORE_SCALE_BY_OPTION_COUNT[5];
  const boundedIndex = Math.min(Math.max(optionIndex, 0), scale.length - 1);
  const directScore = scale[boundedIndex] ?? 2;
  return scoringRule === "inverse" ? 4 - directScore : directScore;
}

function mustGetAnswer(
  answers: CompanyRiskProfileAnswers,
  factorKey: string,
  questionKey: string,
): number {
  const byFactor = answers[factorKey];
  if (!byFactor) {
    throw new Error(`Respostas ausentes para o fator ${factorKey}.`);
  }
  const value = byFactor[questionKey];
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Resposta invalida para ${factorKey}/${questionKey}.`);
  }
  return value;
}

export function computeCompanyRiskProfile(
  answersInput: CompanyRiskProfileAnswers,
): CompanyRiskProfileComputation {
  const normalizedAnswers: CompanyRiskProfileAnswers = createEmptyCompanyRiskProfileAnswers();
  const factorScores: CompanyRiskProfileFactorScore[] = [];
  const summaryCounts: Record<CompanyRiskProbabilityClass, number> = {
    baixa: 0,
    media: 0,
    alta: 0,
  };

  for (const factor of COMPANY_RISK_PROFILE_FACTORS) {
    const questionScores: CompanyRiskProfileQuestionScore[] = [];

    for (const question of COMPANY_RISK_PROFILE_QUESTIONS) {
      const optionIndex = mustGetAnswer(answersInput, factor.key, question.key);
      if (optionIndex >= question.options.length) {
        throw new Error(`Opcao fora do intervalo para ${factor.key}/${question.key}.`);
      }
      normalizedAnswers[factor.key][question.key] = optionIndex;

      const score = scoreOptionIndex(optionIndex, question.options.length, question.scoringRule);
      questionScores.push({
        questionKey: question.key,
        criterion: question.criterion,
        prompt: question.prompt,
        optionIndex,
        optionLabel: question.options[optionIndex] ?? "",
        score,
      });
    }

    const factorAverage =
      questionScores.reduce((total, current) => total + current.score, 0) /
      COMPANY_RISK_PROFILE_QUESTIONS.length;
    const probabilityClass = classifyProbability(factorAverage);
    summaryCounts[probabilityClass] += 1;

    factorScores.push({
      factorKey: factor.key,
      factorLabel: factor.label,
      score: round2(factorAverage),
      probabilityClass,
      questionScores,
    });
  }

  const overallRaw =
    factorScores.reduce((total, factorScore) => total + factorScore.score, 0) /
    COMPANY_RISK_PROFILE_FACTORS.length;
  const overallScore = round2(overallRaw);

  return {
    overallScore,
    overallClass: classifyProbability(overallScore),
    summaryCounts,
    factorScores,
    answers: normalizedAnswers,
  };
}
