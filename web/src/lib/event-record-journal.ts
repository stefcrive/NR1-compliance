import { z } from "zod";

export type EventRecordAttachmentKind = "document" | "screenshot";

export type EventRecordAttachment = {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  storagePath: string;
  downloadUrl: string;
  kind: EventRecordAttachmentKind;
};

export type EventRecordJournal = {
  notes: string | null;
  attachments: EventRecordAttachment[];
  available: boolean;
};

export const EVENT_RECORD_STORAGE_BUCKET = "event-record-files";
export const EVENT_RECORD_MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

export const EVENT_RECORD_ALLOWED_MIME_TYPES = [
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
  "image/webp",
] as const;

export const EVENT_RECORD_FILE_ACCEPT_ATTR =
  ".pdf,.ppt,.pptx,.xls,.xlsx,.doc,.docx,.txt,.csv,.png,.jpg,.jpeg,.webp";

const eventRecordAttachmentSchema: z.ZodType<EventRecordAttachment> = z.object({
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(240),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().min(0).max(50 * 1024 * 1024),
  uploadedAt: z.string().datetime({ offset: true }),
  storagePath: z.string().trim().min(1).max(512),
  downloadUrl: z.string().url(),
  kind: z.enum(["document", "screenshot"]),
});

export function parseEventRecordAttachments(value: unknown): EventRecordAttachment[] {
  if (!Array.isArray(value)) return [];
  const parsed: EventRecordAttachment[] = [];
  for (const item of value) {
    const candidate =
      item && typeof item === "object" && !Array.isArray(item)
        ? ({ ...item } as Record<string, unknown>)
        : null;
    if (!candidate) continue;
    if (!candidate.kind) {
      const mimeType = typeof candidate.mimeType === "string" ? candidate.mimeType : "";
      candidate.kind = inferAttachmentKind(mimeType);
    }
    const validation = eventRecordAttachmentSchema.safeParse(candidate);
    if (validation.success) {
      parsed.push(validation.data);
    }
  }
  return parsed;
}

export function sanitizeFileName(fileName: string): string {
  const normalized = fileName.trim().replace(/\s+/g, "-");
  const safe = normalized.replace(/[^a-zA-Z0-9._-]/g, "");
  return safe.length > 0 ? safe : "file.bin";
}

export function sanitizeStorageSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9/_-]/g, "-");
  const squashed = normalized.replace(/\/{2,}/g, "/");
  const trimmed = squashed.replace(/^\/+|\/+$/g, "");
  return trimmed.length > 0 ? trimmed : "event";
}

export function deriveAttachmentTitle(fileName: string): string {
  const withoutExt = fileName.replace(/\.[^.]+$/, "");
  const normalized = withoutExt.replace(/[_-]+/g, " ").trim();
  return normalized.length > 0 ? normalized : "Attachment";
}

export function inferAttachmentKind(mimeType: string): EventRecordAttachmentKind {
  if (mimeType.startsWith("image/")) return "screenshot";
  return "document";
}
