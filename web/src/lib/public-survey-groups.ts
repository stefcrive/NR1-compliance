const HIDDEN_PUBLIC_GROUP_KEYS = new Set([
  "role",
  "jobrole",
  "cargo",
  "funcao",
  "cargofuncao",
]);

function normalizeGroupKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function shouldHidePublicGroupKey(key: string): boolean {
  return HIDDEN_PUBLIC_GROUP_KEYS.has(normalizeGroupKey(key));
}

export function filterPublicSurveyGroups<T extends { key: string }>(groups: T[]): T[] {
  return groups.filter((group) => !shouldHidePublicGroupKey(group.key));
}

export function sanitizePublicGroupValues(values: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (shouldHidePublicGroupKey(key)) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}
