export type ClassLevel = "low" | "medium" | "high";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ThresholdBand = {
  classLevel: ClassLevel;
  min: number;
  max: number;
};

export const DEFAULT_THRESHOLD_BANDS: ThresholdBand[] = [
  { classLevel: "low", min: 1.0, max: 2.3 },
  { classLevel: "medium", min: 2.31, max: 3.6 },
  { classLevel: "high", min: 3.61, max: 5.0 },
];

export function classifyScore(
  value: number | null,
  bands: ThresholdBand[] = DEFAULT_THRESHOLD_BANDS,
): ClassLevel | null {
  if (value === null || Number.isNaN(value)) {
    return null;
  }
  for (const band of bands) {
    if (value >= band.min && value <= band.max) {
      return band.classLevel;
    }
  }
  return null;
}

export function resolveRisk(
  severityClass: ClassLevel | null,
  probabilityClass: ClassLevel | null,
): RiskLevel | null {
  if (!severityClass || !probabilityClass) {
    return null;
  }

  const key = `${severityClass}:${probabilityClass}`;
  const table: Record<string, RiskLevel> = {
    "low:low": "low",
    "low:medium": "low",
    "medium:low": "low",
    "low:high": "medium",
    "high:low": "medium",
    "medium:medium": "medium",
    "medium:high": "high",
    "high:medium": "high",
    "high:high": "critical",
  };
  return table[key];
}
