export type DrpsPart1Answer = {
  key: string;
  label: string;
  score: number;
};

export type DrpsDerived = {
  dimensionScores: {
    frequency: number;
    history: number;
    resources: number;
    resourcesRisk: number;
  };
  probabilityScore: number;
  probabilityClass: "low" | "medium" | "high";
  recommendedPrograms: string[];
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((acc, value) => acc + value, 0) / values.length).toFixed(2));
}

export function classifyProbability(score: number): "low" | "medium" | "high" {
  if (score <= 2.3) {
    return "low";
  }
  if (score <= 3.6) {
    return "medium";
  }
  return "high";
}

export function deriveDrps(payload: {
  part1Answers: DrpsPart1Answer[];
  criticalTopics: number[];
}): DrpsDerived {
  const frequencyKeys = new Set(["freq_regularidade", "freq_duracao", "freq_impactados"]);
  const historyKeys = new Set(["hist_registros", "hist_gravidade", "hist_causas"]);
  const resourceKeys = new Set([
    "rec_medidas",
    "rec_revisao",
    "rec_conhecimento",
    "rec_recursos",
  ]);

  const frequencyScores = payload.part1Answers
    .filter((item) => frequencyKeys.has(item.key))
    .map((item) => item.score);
  const historyScores = payload.part1Answers
    .filter((item) => historyKeys.has(item.key))
    .map((item) => item.score);
  const resourcesScores = payload.part1Answers
    .filter((item) => resourceKeys.has(item.key))
    .map((item) => item.score);

  const frequency = average(frequencyScores);
  const history = average(historyScores);
  const resources = average(resourcesScores);

  // Recursos altos reduzem risco; convertemos para eixo de risco.
  const resourcesRisk = Number((6 - resources).toFixed(2));
  const probabilityScore = Number(average([frequency, history, resourcesRisk]).toFixed(2));
  const probabilityClass = classifyProbability(probabilityScore);

  const recommendedPrograms = mapPrograms({
    criticalTopics: payload.criticalTopics,
    resourcesRisk,
  });

  return {
    dimensionScores: {
      frequency,
      history,
      resources,
      resourcesRisk,
    },
    probabilityScore,
    probabilityClass,
    recommendedPrograms,
  };
}

function mapPrograms(input: { criticalTopics: number[]; resourcesRisk: number }): string[] {
  const topics = new Set(input.criticalTopics);
  const programs = new Set<string>();

  const hasAny = (list: number[]) => list.some((topic) => topics.has(topic));

  if (hasAny([1, 7])) {
    programs.add("Programa de prevencao ao assedio moral e psicologico no trabalho");
    programs.add("Programa de inteligencia emocional para lideres");
  }
  if (hasAny([9, 10])) {
    programs.add("Programa de gestao do estresse e prevencao ao burnout");
    programs.add("Programa de prevencao e manejo da ansiedade");
  }
  if (hasAny([4, 6])) {
    programs.add("Programa de equilibrio vida-trabalho");
    programs.add("Programa de comunicacao assertiva e nao agressiva");
  }
  if (hasAny([2, 11, 12, 13])) {
    programs.add("Programa de saude mental e clima organizacional");
    programs.add("Programa de apoio psicologico");
  }
  if (hasAny([8])) {
    programs.add("Programa de avaliacao psicologica com acompanhamento individualizado");
    programs.add("Programa de apoio psicologico");
  }

  programs.add("Programa de psicologia positiva");
  programs.add("Programa de formacao de multiplicadores da cultura do cuidado");

  if (input.resourcesRisk >= 3) {
    programs.add("Programa de treinamento a equipe de RH para implementacao da NR-01");
  }

  return Array.from(programs.values());
}
