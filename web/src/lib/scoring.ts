export type ScoringRule = "direct" | "inverted";

export function correctedScore(params: {
  raw: number;
  scoringRule: ScoringRule;
  likertMin: number;
  likertMax: number;
}): number {
  if (params.scoringRule === "direct") {
    return params.raw;
  }
  return params.likertMin + params.likertMax - params.raw;
}
