export const CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCIES = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
  "custom",
] as const;

export type ContinuousProgramScheduleFrequency =
  (typeof CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCIES)[number];

export type ContinuousProgramMaterial = {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  storagePath: string;
  downloadUrl: string;
};

export type ContinuousProgramSession = {
  id: string;
  title: string;
  notes: string | null;
  preparationRequired: string | null;
  materials: ContinuousProgramMaterial[];
};

export type ContinuousProgramMetrics = {
  participationTarget: number;
  completionTarget: number;
  adherenceTarget: number;
  satisfactionTarget: number;
};

export const DEFAULT_CONTINUOUS_PROGRAM_SCHEDULE_FREQUENCY: ContinuousProgramScheduleFrequency =
  "biweekly";

export const DEFAULT_CONTINUOUS_PROGRAM_QUESTIONS = [
  "The campaign objectives were clear for participants.",
  "The content and materials were useful in day-to-day work.",
  "The campaign should continue in the next cycle.",
];

export const DEFAULT_CONTINUOUS_PROGRAM_METRICS: ContinuousProgramMetrics = {
  participationTarget: 80,
  completionTarget: 75,
  adherenceTarget: 70,
  satisfactionTarget: 4,
};

export const CONTINUOUS_PROGRAM_MAX_SESSIONS = 24;

export const CONTINUOUS_PROGRAM_MATERIAL_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
] as const;

export const CONTINUOUS_PROGRAM_MATERIAL_ACCEPT_ATTR =
  ".pdf,.ppt,.pptx,.xls,.xlsx,.doc,.docx,.txt,.csv,.png,.jpg,.jpeg";

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as RecordLike;
}

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  return normalized.slice(0, maxLength);
}

function readNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function parseMaterialCandidate(value: unknown): ContinuousProgramMaterial | null {
  const record = asRecord(value);
  if (!record) return null;

  const id = readText(record.id, 120);
  const title = readText(record.title, 240);
  const fileName = readText(record.fileName, 255);
  const mimeType = readText(record.mimeType, 160);
  const sizeBytes = readNumber(record.sizeBytes);
  const uploadedAt = readText(record.uploadedAt, 80);
  const storagePath = readText(record.storagePath, 512);
  const downloadUrl = readText(record.downloadUrl, 4096);

  if (
    !id ||
    !title ||
    !fileName ||
    !mimeType ||
    sizeBytes === null ||
    sizeBytes < 0 ||
    !uploadedAt ||
    !storagePath ||
    !downloadUrl
  ) {
    return null;
  }

  const uploadedAtDate = new Date(uploadedAt);
  if (Number.isNaN(uploadedAtDate.getTime())) return null;

  return {
    id,
    title,
    fileName,
    mimeType,
    sizeBytes: Math.round(sizeBytes),
    uploadedAt: uploadedAtDate.toISOString(),
    storagePath,
    downloadUrl,
  };
}

function defaultSessionTitle(index: number): string {
  return `Sessao ${index + 1}`;
}

function parseSessionCandidate(value: unknown, index: number): ContinuousProgramSession | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = readText(record.id, 120) ?? `session-${index + 1}`;
  const title = readText(record.title, 240) ?? defaultSessionTitle(index);
  const notes = readText(record.notes, 5000);
  const preparationRequired =
    readText(record.preparationRequired, 1500) ??
    readText(record.preparation_required, 1500);
  const materials = parseContinuousProgramMaterials(record.materials);
  return {
    id,
    title,
    notes,
    preparationRequired,
    materials,
  };
}

export function parseContinuousProgramMaterials(
  value: unknown,
): ContinuousProgramMaterial[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, ContinuousProgramMaterial>();
  for (const candidate of value) {
    const parsed = parseMaterialCandidate(candidate);
    if (!parsed) continue;
    unique.set(parsed.id, parsed);
  }
  return Array.from(unique.values());
}

export function flattenContinuousProgramSessionMaterials(
  sessions: ContinuousProgramSession[],
): ContinuousProgramMaterial[] {
  const unique = new Map<string, ContinuousProgramMaterial>();
  for (const session of sessions) {
    for (const material of session.materials) {
      if (!unique.has(material.id)) {
        unique.set(material.id, material);
      }
    }
  }
  return Array.from(unique.values());
}

export function parseContinuousProgramSessions(
  value: unknown,
  options?: { fallbackMaterials?: unknown; minCount?: number },
): ContinuousProgramSession[] {
  const minCount = Math.max(0, options?.minCount ?? 1);
  const parsed: ContinuousProgramSession[] = [];

  if (Array.isArray(value)) {
    for (const [index, candidate] of value.entries()) {
      const session = parseSessionCandidate(candidate, index);
      if (!session) continue;
      parsed.push(session);
      if (parsed.length >= CONTINUOUS_PROGRAM_MAX_SESSIONS) break;
    }
  }

  if (parsed.length === 0) {
    const fallbackMaterials = parseContinuousProgramMaterials(options?.fallbackMaterials);
    if (fallbackMaterials.length > 0) {
      parsed.push({
        id: "session-1",
        title: defaultSessionTitle(0),
        notes: null,
        preparationRequired: null,
        materials: fallbackMaterials,
      });
    }
  }

  while (parsed.length < minCount && parsed.length < CONTINUOUS_PROGRAM_MAX_SESSIONS) {
    const index = parsed.length;
    parsed.push({
      id: `session-${index + 1}`,
      title: defaultSessionTitle(index),
      notes: null,
      preparationRequired: null,
      materials: [],
    });
  }

  const uniqueIds = new Set<string>();
  return parsed.map((session, index) => {
    let sessionId = session.id.trim() || `session-${index + 1}`;
    while (uniqueIds.has(sessionId)) {
      sessionId = `${sessionId}-${index + 1}`;
    }
    uniqueIds.add(sessionId);
    return {
      ...session,
      id: sessionId,
      title: session.title.trim() || defaultSessionTitle(index),
      notes: session.notes?.trim() || null,
      preparationRequired: session.preparationRequired?.trim() || null,
      materials: parseContinuousProgramMaterials(session.materials),
    };
  });
}

export function ensureContinuousProgramSessionCount(
  sessions: ContinuousProgramSession[],
  count: number,
): ContinuousProgramSession[] {
  const safeCount = Number.isFinite(count) ? count : 1;
  const normalizedTarget = Math.max(
    1,
    Math.min(CONTINUOUS_PROGRAM_MAX_SESSIONS, Math.round(safeCount)),
  );
  const next = parseContinuousProgramSessions(sessions, { minCount: 1 }).slice(0, normalizedTarget);
  while (next.length < normalizedTarget) {
    const index = next.length;
    next.push({
      id: `session-${index + 1}`,
      title: defaultSessionTitle(index),
      notes: null,
      preparationRequired: null,
      materials: [],
    });
  }
  return next.map((session, index) => ({
    ...session,
    title: session.title.trim() || defaultSessionTitle(index),
  }));
}
