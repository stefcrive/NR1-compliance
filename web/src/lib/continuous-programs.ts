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
