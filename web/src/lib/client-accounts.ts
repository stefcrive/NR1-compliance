import { slugify } from "@/lib/slug";

export type ClientStatus = "Active" | "Pending" | "Inactive";
export type BillingStatus = "up_to_date" | "pending" | "overdue" | "blocked";

const STATUS_MAP: Record<string, ClientStatus> = {
  active: "Active",
  pending: "Pending",
  inactive: "Inactive",
};

const BILLING_MAP: Record<string, BillingStatus> = {
  up_to_date: "up_to_date",
  pending: "pending",
  overdue: "overdue",
  blocked: "blocked",
};

export function normalizeClientStatus(value: string | undefined): ClientStatus {
  if (!value) {
    return "Pending";
  }
  return STATUS_MAP[value.toLowerCase()] ?? "Pending";
}

export function normalizeBillingStatus(value: string | undefined): BillingStatus {
  if (!value) {
    return "pending";
  }
  return BILLING_MAP[value.toLowerCase()] ?? "pending";
}

export function buildClientPortalSlug(companyName: string, preferred?: string): string {
  const source = preferred?.trim() ? preferred : companyName;
  const slug = slugify(source);
  if (slug.length >= 3) {
    return slug;
  }
  return `client-${Date.now()}`;
}

export function normalizeHeadcount(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value ?? 0));
}

export function coerceNullableDate(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}