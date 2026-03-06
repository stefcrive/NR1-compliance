import { DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS } from "@/lib/continuous-programs";

export type ContinuousProgramEvaluationSummary = {
  submissions: number;
  averageByQuestion: Array<number | null>;
  overallAverage: number | null;
};

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toValidAnswer(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric)) return null;
  if (numeric < 1 || numeric > 5) return null;
  return numeric;
}

export function parseContinuousProgramEvaluationQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS;
  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 20);
  return normalized.length > 0 ? normalized : DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS;
}

export function createEmptyContinuousProgramEvaluationSummary(
  questionCount: number,
): ContinuousProgramEvaluationSummary {
  const total = Number.isInteger(questionCount) ? Math.max(0, questionCount) : 0;
  return {
    submissions: 0,
    averageByQuestion: Array.from({ length: total }, () => null),
    overallAverage: null,
  };
}

export function summarizeContinuousProgramEvaluations(input: {
  answerPayloads: unknown[];
  questionCount: number;
}): ContinuousProgramEvaluationSummary {
  const questionCount = Number.isInteger(input.questionCount) ? Math.max(0, input.questionCount) : 0;
  const summary = createEmptyContinuousProgramEvaluationSummary(questionCount);
  summary.submissions = input.answerPayloads.length;

  if (questionCount === 0 || input.answerPayloads.length === 0) {
    return summary;
  }

  const sums = Array.from({ length: questionCount }, () => 0);
  const counts = Array.from({ length: questionCount }, () => 0);
  let overallSum = 0;
  let overallCount = 0;

  for (const payload of input.answerPayloads) {
    if (!Array.isArray(payload)) continue;
    for (let index = 0; index < questionCount; index += 1) {
      const answer = toValidAnswer(payload[index]);
      if (answer === null) continue;
      sums[index] += answer;
      counts[index] += 1;
      overallSum += answer;
      overallCount += 1;
    }
  }

  summary.averageByQuestion = counts.map((count, index) =>
    count > 0 ? round(sums[index] / count) : null,
  );
  summary.overallAverage = overallCount > 0 ? round(overallSum / overallCount) : null;
  return summary;
}
