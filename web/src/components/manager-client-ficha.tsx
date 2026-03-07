"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { ManagerHistory } from "@/components/manager-history";

type Diagnostic = {
  id: string;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  starts_at: string | null;
  closes_at: string | null;
  responses?: number;
};

type ClientSector = {
  id: string;
  key: string;
  name: string;
  isActive?: boolean;
  remoteWorkers: number;
  onsiteWorkers: number;
  hybridWorkers: number;
  functions: string | null;
  workersInRole: number;
  shifts: string | null;
  vulnerableGroups: string | null;
  mainContactName: string | null;
  mainContactEmail: string | null;
  mainContactPhone: string | null;
  possibleMentalHealthHarms: string | null;
  existingControlMeasures: string | null;
  elaborationDate: string | null;
  riskParameter: number;
};

type ClientDetail = {
  id: string;
  companyName: string;
  cnpj: string;
  status: "Active" | "Pending" | "Inactive";
  billingStatus: "up_to_date" | "pending" | "overdue" | "blocked";
  portalSlug: string;
  totalEmployees: number;
  remoteEmployees: number;
  onsiteEmployees: number;
  hybridEmployees: number;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  updatedAt: string | null;
  access: {
    hasCredentials: boolean;
    loginEmail: string | null;
    invitationStatus: "pending" | "accepted" | "expired" | "revoked" | "none" | "unavailable";
    invitationLink: string | null;
    invitationExpiresAt: string | null;
    invitationAcceptedAt: string | null;
  };
  sectors: ClientSector[];
  campaigns: Diagnostic[];
};

type Report = {
  id: string;
  report_title: string;
  status: "draft" | "processing" | "ready" | "failed";
  created_at: string;
};

type ContinuousProgramStatus = "Recommended" | "Active" | "Completed";

type ContinuousProgramOption = {
  id: string;
  title: string;
  description: string | null;
  targetRiskTopic: number;
  triggerThreshold: number;
  scheduleFrequency: string;
  scheduleAnchorDate: string | null;
};

type AvailabilitySlot = {
  startsAt: string;
  endsAt: string;
};

type AssignedContinuousProgram = {
  id: string;
  programId: string;
  programTitle: string;
  programDescription: string | null;
  targetRiskTopic: number | null;
  triggerThreshold: number | null;
  scheduleFrequency?: string;
  scheduleAnchorDate?: string | null;
  cadenceSuggestedSlots?: AvailabilitySlot[];
  calendarProvisorySlots?: AvailabilitySlot[];
  calendarCommittedSlots?: AvailabilitySlot[];
  annualPlanMonths?: string[];
  status: ContinuousProgramStatus;
  deployedAt: string | null;
};

type PortalSnapshot = {
  totals: { responses: number; topics: number };
  riskDistribution: { high: number; critical: number };
  drps: { part1_probability_score: number; part1_probability_class: string } | null;
};

type SectorLink = {
  id: string;
  key?: string;
  name: string;
  riskParameter?: number;
  accessLink: string;
  isActive: boolean;
  submissionCount: number;
  lastSubmittedAt: string | null;
};

type SectorPayload = {
  campaign: { id: string; name: string; slug: string };
  sectors: SectorLink[];
};

type ClientTab =
  | "overview"
  | "company-data"
  | "assigned-drps"
  | "assigned-continuous"
  | "contracts-invoicing"
  | "history";

type ClientProfileForm = {
  companyName: string;
  cnpj: string;
  status: "Active" | "Pending" | "Inactive";
  billingStatus: "up_to_date" | "pending" | "overdue" | "blocked";
  totalEmployees: string;
  remoteEmployees: string;
  onsiteEmployees: string;
  hybridEmployees: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contractStartDate: string;
  contractEndDate: string;
};

type SectorProfileForm = {
  id: string;
  name: string;
  isActive: boolean;
  riskParameter: string;
  mainContactName: string;
  mainContactEmail: string;
  mainContactPhone: string;
  remoteWorkers: number;
  onsiteWorkers: number;
  hybridWorkers: number;
  functions: string;
  workersInRole: number;
  shifts: string;
  vulnerableGroups: string;
  possibleMentalHealthHarms: string;
  existingControlMeasures: string;
  elaborationDate: string;
};

const TAB_ITEMS: Array<{ id: ClientTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "company-data", label: "Company data" },
  { id: "assigned-drps", label: "Assigned Diagnosticos DRPS" },
  { id: "assigned-continuous", label: "Assigned processo continuos" },
  { id: "contracts-invoicing", label: "contracts & invoicing" },
  { id: "history", label: "Historico" },
];
const ANNUAL_PLAN_COLUMNS = 12;
const annualPlanMonthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;

function fmt(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function fmtDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

function campaignCollectionStatus(status: Diagnostic["status"]) {
  if (status === "live") return "Questionario aberto (coletando respostas)";
  if (status === "closed") return "Questionario fechado";
  if (status === "draft") return "Questionario em rascunho";
  return "Questionario arquivado";
}

function accessInvitationStatusLabel(
  status: "pending" | "accepted" | "expired" | "revoked" | "none" | "unavailable",
) {
  if (status === "pending") return "Pending";
  if (status === "accepted") return "Accepted";
  if (status === "expired") return "Expired";
  if (status === "revoked") return "Revoked";
  if (status === "none") return "No invitation";
  return "Unavailable";
}

function toMonthKey(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function buildAnnualPlanColumns(start: Date, count = ANNUAL_PLAN_COLUMNS): Array<{ key: string; label: string }> {
  const columns: Array<{ key: string; label: string }> = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const formatter = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" });
  for (let index = 0; index < count; index += 1) {
    const date = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + index, 1));
    columns.push({
      key: toMonthKey(date),
      label: formatter.format(date).replace(".", ""),
    });
  }
  return columns;
}

function normalizeAnnualPlanMonths(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const raw of value) {
    const normalized = typeof raw === "string" ? raw.trim() : "";
    if (!annualPlanMonthRegex.test(normalized)) continue;
    unique.add(normalized);
  }
  return Array.from(unique.values()).sort();
}

function extractAnnualPlanMonths(assignment: AssignedContinuousProgram): string[] {
  const explicitMonths = normalizeAnnualPlanMonths(assignment.annualPlanMonths);
  if (explicitMonths.length > 0) return explicitMonths;

  const slots = assignment.calendarProvisorySlots ?? assignment.cadenceSuggestedSlots ?? [];
  const fallback = new Set<string>();
  for (const slot of slots) {
    const start = new Date(slot.startsAt);
    if (Number.isNaN(start.getTime())) continue;
    fallback.add(toMonthKey(start));
  }
  return Array.from(fallback.values()).sort();
}

function sameMonthsSelection(left: string[] | null | undefined, right: string[] | null | undefined): boolean {
  const leftNormalized = normalizeAnnualPlanMonths(left ?? []);
  const rightNormalized = normalizeAnnualPlanMonths(right ?? []);
  return leftNormalized.join("|") === rightNormalized.join("|");
}

function toDatetimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromDatetimeLocal(value: string): string | "" {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function toDateInput(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function toNonNegativeInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function buildClientProfileForm(client: ClientDetail): ClientProfileForm {
  return {
    companyName: client.companyName,
    cnpj: client.cnpj,
    status: client.status,
    billingStatus: client.billingStatus,
    totalEmployees: String(client.totalEmployees),
    remoteEmployees: String(client.remoteEmployees),
    onsiteEmployees: String(client.onsiteEmployees),
    hybridEmployees: String(client.hybridEmployees),
    contactName: client.contactName ?? "",
    contactEmail: client.contactEmail ?? "",
    contactPhone: client.contactPhone ?? "",
    contractStartDate: toDateInput(client.contractStartDate),
    contractEndDate: toDateInput(client.contractEndDate),
  };
}

function toRiskParameter(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(2, Math.max(0.5, parsed));
}

function buildSectorProfileForm(sector: ClientSector): SectorProfileForm {
  return {
    id: sector.id,
    name: sector.name,
    isActive: sector.isActive ?? true,
    riskParameter: sector.riskParameter.toFixed(2),
    mainContactName: sector.mainContactName ?? "",
    mainContactEmail: sector.mainContactEmail ?? "",
    mainContactPhone: sector.mainContactPhone ?? "",
    remoteWorkers: sector.remoteWorkers,
    onsiteWorkers: sector.onsiteWorkers,
    hybridWorkers: sector.hybridWorkers,
    functions: sector.functions ?? "",
    workersInRole: sector.workersInRole,
    shifts: sector.shifts ?? "",
    vulnerableGroups: sector.vulnerableGroups ?? "",
    possibleMentalHealthHarms: sector.possibleMentalHealthHarms ?? "",
    existingControlMeasures: sector.existingControlMeasures ?? "",
    elaborationDate: toDateInput(sector.elaborationDate),
  };
}

function createSectorProfileForm(): SectorProfileForm {
  const randomPart = Math.random().toString(36).slice(2, 9);
  return {
    id: `new-${Date.now()}-${randomPart}`,
    name: "",
    isActive: true,
    riskParameter: "1.00",
    mainContactName: "",
    mainContactEmail: "",
    mainContactPhone: "",
    remoteWorkers: 0,
    onsiteWorkers: 0,
    hybridWorkers: 0,
    functions: "",
    workersInRole: 0,
    shifts: "",
    vulnerableGroups: "",
    possibleMentalHealthHarms: "",
    existingControlMeasures: "",
    elaborationDate: "",
  };
}

function sumSectorHeadcountFromForms(sectors: SectorProfileForm[]) {
  return sectors.reduce(
    (totals, sector) => {
      const remote = Math.max(0, sector.remoteWorkers);
      const onsite = Math.max(0, sector.onsiteWorkers);
      const hybrid = Math.max(0, sector.hybridWorkers);
      return {
        totalEmployees: totals.totalEmployees + remote + onsite + hybrid,
        remoteEmployees: totals.remoteEmployees + remote,
        onsiteEmployees: totals.onsiteEmployees + onsite,
        hybridEmployees: totals.hybridEmployees + hybrid,
      };
    },
    {
      totalEmployees: 0,
      remoteEmployees: 0,
      onsiteEmployees: 0,
      hybridEmployees: 0,
    },
  );
}

function csvEscape(value: string | number | null): string {
  if (value === null) return "";
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fallback below.
    }
  }

  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        d="M3 17.25V21h3.75L18.81 8.94l-3.75-3.75L3 17.25Zm17.71-10.04a1 1 0 0 0 0-1.42l-2.5-2.5a1 1 0 0 0-1.42 0L14.94 5.17l3.75 3.75 2.02-1.71Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ManagerClientFicha({
  clientId,
  initialTab = "overview",
}: {
  clientId: string;
  initialTab?: ClientTab;
}) {
  const router = useRouter();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [snapshot, setSnapshot] = useState<PortalSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [linksPayload, setLinksPayload] = useState<SectorPayload | null>(null);
  const [isLinksModalOpen, setIsLinksModalOpen] = useState(false);
  const [copiedSectorId, setCopiedSectorId] = useState<string | null>(null);
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const [expandedCampaignSectorsById, setExpandedCampaignSectorsById] = useState<
    Record<string, SectorLink[]>
  >({});
  const [loadingExpandedCampaignId, setLoadingExpandedCampaignId] = useState<string | null>(null);
  const [accessInviteCopied, setAccessInviteCopied] = useState(false);
  const [isLoadingLinksFor, setIsLoadingLinksFor] = useState<string | null>(null);
  const [openCampaignActionsFor, setOpenCampaignActionsFor] = useState<string | null>(null);
  const [openCampaignSectorActionsFor, setOpenCampaignSectorActionsFor] = useState<string | null>(
    null,
  );
  const [drpsActionNotice, setDrpsActionNotice] = useState("");
  const [activeTab, setActiveTab] = useState<ClientTab>(initialTab);
  const [isEditingCompanyProfile, setIsEditingCompanyProfile] = useState(false);
  const [isSavingCompanyProfile, setIsSavingCompanyProfile] = useState(false);
  const [isTogglingClientAccess, setIsTogglingClientAccess] = useState(false);
  const [isDeletingClient, setIsDeletingClient] = useState(false);
  const [companyForm, setCompanyForm] = useState<ClientProfileForm>({
    companyName: "",
    cnpj: "",
    status: "Pending",
    billingStatus: "pending",
    totalEmployees: "1",
    remoteEmployees: "0",
    onsiteEmployees: "0",
    hybridEmployees: "0",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    contractStartDate: "",
    contractEndDate: "",
  });
  const [sectorForms, setSectorForms] = useState<SectorProfileForm[]>([]);
  const [isSectorModalOpen, setIsSectorModalOpen] = useState(false);
  const [sectorModalMode, setSectorModalMode] = useState<"add" | "edit">("add");
  const [sectorModalForm, setSectorModalForm] = useState<SectorProfileForm>(createSectorProfileForm());
  const [availablePrograms, setAvailablePrograms] = useState<ContinuousProgramOption[]>([]);
  const [assignedPrograms, setAssignedPrograms] = useState<AssignedContinuousProgram[]>([]);
  const [continuousError, setContinuousError] = useState("");
  const [continuousNotice, setContinuousNotice] = useState("");
  const [isSavingProgram, setIsSavingProgram] = useState(false);
  const [isSavingAnnualPlan, setIsSavingAnnualPlan] = useState(false);
  const [annualPlanBaseByAssignment, setAnnualPlanBaseByAssignment] = useState<Record<string, string[]>>({});
  const [annualPlanDraftByAssignment, setAnnualPlanDraftByAssignment] = useState<Record<string, string[]>>({});
  const [isProgramModalOpen, setIsProgramModalOpen] = useState(false);
  const [assignProgramForm, setAssignProgramForm] = useState<{
    programIds: string[];
    status: ContinuousProgramStatus;
    deployedAt: string;
    scheduleFrequency: string;
  }>({
    programIds: [],
    status: "Active",
    deployedAt: "",
    scheduleFrequency: "biweekly",
  });

  const selectedCampaign = useMemo(
    () => client?.campaigns?.find((campaign) => campaign.id === selectedCampaignId) ?? null,
    [client, selectedCampaignId],
  );
  const openCampaigns = useMemo(
    () => client?.campaigns?.filter((campaign) => campaign.status === "live") ?? [],
    [client],
  );
  const resultsCampaign = useMemo(() => {
    const campaigns = client?.campaigns ?? [];
    if (selectedCampaign && (selectedCampaign.status === "live" || selectedCampaign.status === "closed")) {
      return selectedCampaign;
    }
    return (
      campaigns.find((campaign) => campaign.status === "live") ??
      campaigns.find((campaign) => campaign.status === "closed") ??
      null
    );
  }, [client, selectedCampaign]);
  const linksActionCampaign =
    selectedCampaign?.status === "live" ? selectedCampaign : openCampaigns[0] ?? null;
  const isDrpsActionsMenuOpen =
    openCampaignActionsFor !== null || openCampaignSectorActionsFor !== null;

  const assignedProgramIds = useMemo(
    () => new Set(assignedPrograms.map((assignment) => assignment.programId)),
    [assignedPrograms],
  );
  const unassignedProgramOptions = useMemo(
    () => availablePrograms.filter((program) => !assignedProgramIds.has(program.id)),
    [availablePrograms, assignedProgramIds],
  );
  const selectedProgramsToAssign = useMemo(
    () =>
      unassignedProgramOptions.filter((program) => assignProgramForm.programIds.includes(program.id)),
    [unassignedProgramOptions, assignProgramForm.programIds],
  );
  const primaryContinuousProgram = assignedPrograms[0] ?? null;
  const annualPlanColumns = useMemo(
    () => buildAnnualPlanColumns(new Date(), ANNUAL_PLAN_COLUMNS),
    [],
  );
  const annualPlanPendingCount = useMemo(() => {
    return assignedPrograms.reduce((count, assignment) => {
      const base = annualPlanBaseByAssignment[assignment.id] ?? extractAnnualPlanMonths(assignment);
      const draft = annualPlanDraftByAssignment[assignment.id] ?? base;
      return sameMonthsSelection(base, draft) ? count : count + 1;
    }, 0);
  }, [annualPlanBaseByAssignment, annualPlanDraftByAssignment, assignedPrograms]);
  const companyHeadcountFromSectors = useMemo(
    () => sumSectorHeadcountFromForms(sectorForms),
    [sectorForms],
  );
  const isClientAccessBlocked = client?.billingStatus === "blocked";

  const loadContinuousPrograms = useCallback(async (targetClientId: string) => {
    const response = await fetch(`/api/admin/clients/${targetClientId}/programs`, { cache: "no-store" });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "Falha ao carregar programas continuos.");
    }
    const payload = (await response.json()) as {
      availablePrograms: ContinuousProgramOption[];
      assignedPrograms: AssignedContinuousProgram[];
    };
    const nextAvailable = payload.availablePrograms ?? [];
    const nextAssigned = payload.assignedPrograms ?? [];

    setAvailablePrograms(nextAvailable);
    setAssignedPrograms(nextAssigned);
    const nextAnnualPlanState: Record<string, string[]> = {};
    for (const assignment of nextAssigned) {
      nextAnnualPlanState[assignment.id] = extractAnnualPlanMonths(assignment);
    }
    setAnnualPlanBaseByAssignment(nextAnnualPlanState);
    setAnnualPlanDraftByAssignment((previous) => {
      const preserved: Record<string, string[]> = {};
      for (const assignment of nextAssigned) {
        if (previous[assignment.id] && !sameMonthsSelection(previous[assignment.id], nextAnnualPlanState[assignment.id])) {
          preserved[assignment.id] = normalizeAnnualPlanMonths(previous[assignment.id]);
        } else {
          preserved[assignment.id] = nextAnnualPlanState[assignment.id];
        }
      }
      return preserved;
    });
    setAssignProgramForm((previous) => {
      const nextAssignedIds = new Set(nextAssigned.map((assignment) => assignment.programId));
      const nextProgramIds = previous.programIds.filter(
        (programId) =>
          !nextAssignedIds.has(programId) &&
          nextAvailable.some((program) => program.id === programId),
      );
      if (nextProgramIds.length === 0) {
        const firstAvailableProgram = nextAvailable.find((program) => !nextAssignedIds.has(program.id));
        if (firstAvailableProgram) {
          nextProgramIds.push(firstAvailableProgram.id);
        }
      }
      return {
        ...previous,
        programIds: nextProgramIds,
        scheduleFrequency: "biweekly",
      };
    });
  }, []);

  const loadBase = useCallback(async () => {
    setIsLoading(true);
    setError("");
    setContinuousError("");
    setContinuousNotice("");
    try {
      const [detailRes, reportsRes] = await Promise.all([
        fetch(`/api/admin/clients/${clientId}`, { cache: "no-store" }),
        fetch(`/api/admin/clients/${clientId}/reports`, { cache: "no-store" }),
      ]);
      if (!detailRes.ok) throw new Error("Falha ao carregar ficha do cliente.");
      if (!reportsRes.ok) throw new Error("Falha ao carregar relatorios do cliente.");
      const detailPayload = (await detailRes.json()) as { client: ClientDetail };
      const reportsPayload = (await reportsRes.json()) as { reports: Report[] };
      setClient(detailPayload.client);
      setReports(reportsPayload.reports ?? []);
      setSelectedCampaignId((previous) => {
        if (previous && detailPayload.client.campaigns.some((campaign) => campaign.id === previous)) return previous;
        return (
          detailPayload.client.campaigns.find((campaign) => campaign.status === "live")?.id ??
          detailPayload.client.campaigns[0]?.id ??
          ""
        );
      });
      try {
        await loadContinuousPrograms(detailPayload.client.id);
      } catch (programError) {
        setContinuousError(
          programError instanceof Error
            ? programError.message
            : "Falha ao carregar programas continuos.",
        );
        setAvailablePrograms([]);
        setAssignedPrograms([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar ficha.");
      setClient(null);
    } finally {
      setIsLoading(false);
    }
  }, [clientId, loadContinuousPrograms]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    async function loadSnapshot() {
      if (!selectedCampaign || selectedCampaign.status !== "live") {
        setSnapshot(null);
        return;
      }
      const response = await fetch(`/api/admin/surveys/${selectedCampaign.public_slug}/portal`, { cache: "no-store" });
      if (!response.ok) {
        setSnapshot(null);
        return;
      }
      setSnapshot((await response.json()) as PortalSnapshot);
    }
    void loadSnapshot();
  }, [selectedCampaign]);

  useEffect(() => {
    if (!client || isEditingCompanyProfile) return;
    setCompanyForm(buildClientProfileForm(client));
    setSectorForms(client.sectors.map(buildSectorProfileForm));
  }, [client, isEditingCompanyProfile]);

  useEffect(() => {
    setAccessInviteCopied(false);
  }, [client?.id]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (activeTab === "assigned-drps") return;
    setIsLinksModalOpen(false);
    setExpandedCampaignId(null);
    setOpenCampaignActionsFor(null);
    setOpenCampaignSectorActionsFor(null);
    setDrpsActionNotice("");
  }, [activeTab]);

  async function generateSeriesReports() {
    if (!client) return;
    setIsBusy(true);
    const response = await fetch(`/api/admin/clients/${client.id}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generateAll: true }),
    });
    if (!response.ok && response.status !== 207) setError("Falha ao gerar serie de relatorios.");
    await loadBase();
    setIsBusy(false);
  }

  async function fetchCampaignSectorPayload(campaignId: string): Promise<SectorPayload> {
    const response = await fetch(`/api/admin/campaigns/${campaignId}/sectors`, { cache: "no-store" });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "Falha ao carregar links.");
    }
    return (await response.json()) as SectorPayload;
  }

  async function loadQuestionnaireLinks(campaign: Diagnostic) {
    setIsLoadingLinksFor(campaign.id);
    setLinksPayload(null);
    setIsLinksModalOpen(false);
    setDrpsActionNotice("");
    try {
      const payload = await fetchCampaignSectorPayload(campaign.id);
      setLinksPayload(payload);
      setCopiedSectorId(null);
      setIsLinksModalOpen(true);
    } catch {
      setError("Falha ao carregar links.");
    } finally {
      setIsLoadingLinksFor(null);
    }
  }

  async function toggleCampaignPackage(campaignId: string) {
    if (expandedCampaignId === campaignId) {
      setExpandedCampaignId(null);
      return;
    }

    setExpandedCampaignId(campaignId);
    if (expandedCampaignSectorsById[campaignId]) return;

    setLoadingExpandedCampaignId(campaignId);
    try {
      const payload = await fetchCampaignSectorPayload(campaignId);
      setExpandedCampaignSectorsById((previous) => ({
        ...previous,
        [campaignId]: payload.sectors ?? [],
      }));
    } catch {
      setError("Falha ao carregar setores do pacote DRPS.");
    } finally {
      setLoadingExpandedCampaignId((previous) => (previous === campaignId ? null : previous));
    }
  }

  async function refreshExpandedCampaignSectors(campaignId: string) {
    const payload = await fetchCampaignSectorPayload(campaignId);
    setExpandedCampaignSectorsById((previous) => ({
      ...previous,
      [campaignId]: payload.sectors ?? [],
    }));
  }

  function openCampaignResults(campaign: Diagnostic, sectorName?: string) {
    if (!client) return;
    const search = sectorName ? `?sector=${encodeURIComponent(sectorName)}` : "";
    router.push(`/manager/clients/${client.id}/diagnostic/${campaign.id}${search}`);
  }

  async function ensureSectorPresentInCompanyRecord(sectorName: string): Promise<ClientSector | null> {
    if (!client) return null;
    const normalizedTarget = sectorName.trim().toLowerCase();
    const existing = client.sectors.find((sector) => sector.name.trim().toLowerCase() === normalizedTarget);
    if (existing) return existing;

    const shouldCreate = window.confirm(
      `O setor "${sectorName}" nao existe no cadastro da empresa. Deseja adicionar este setor no registro da empresa agora?`,
    );
    if (!shouldCreate) return null;

    const sectorsPayload = [
      ...client.sectors.map((sector) => ({
        name: sector.name,
        isActive: sector.isActive ?? true,
        remoteWorkers: sector.remoteWorkers,
        onsiteWorkers: sector.onsiteWorkers,
        hybridWorkers: sector.hybridWorkers,
        functions: sector.functions ?? "",
        workersInRole: sector.workersInRole,
        shifts: sector.shifts ?? "",
        vulnerableGroups: sector.vulnerableGroups ?? "",
        mainContactName: sector.mainContactName ?? "",
        mainContactEmail: sector.mainContactEmail ?? "",
        mainContactPhone: sector.mainContactPhone ?? "",
        possibleMentalHealthHarms: sector.possibleMentalHealthHarms ?? "",
        existingControlMeasures: sector.existingControlMeasures ?? "",
        elaborationDate: sector.elaborationDate ?? "",
        riskParameter: sector.riskParameter,
      })),
      {
        name: sectorName,
        isActive: true,
        remoteWorkers: 0,
        onsiteWorkers: 0,
        hybridWorkers: 0,
        functions: "",
        workersInRole: 0,
        shifts: "",
        vulnerableGroups: "",
        mainContactName: "",
        mainContactEmail: "",
        mainContactPhone: "",
        possibleMentalHealthHarms: "",
        existingControlMeasures: "",
        elaborationDate: "",
        riskParameter: 1,
      },
    ];

    const response = await fetch(`/api/admin/clients/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectors: sectorsPayload }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      warning?: string;
      client?: ClientDetail;
    };

    if (!response.ok || !payload.client) {
      setError(payload.error ?? "Nao foi possivel adicionar o setor ao cadastro da empresa.");
      return null;
    }

    const matchedSector =
      payload.client.sectors.find((sector) => sector.name.trim().toLowerCase() === normalizedTarget) ?? null;
    await loadBase();
    if (payload.warning) {
      setError(payload.warning);
    } else {
      setError("");
    }
    return matchedSector;
  }

  async function addSectorToCampaign(campaign: Diagnostic) {
    const typedName = window.prompt("Nome do setor para adicionar ao pacote:", "");
    const sectorName = typedName?.trim() ?? "";
    if (!sectorName) return;

    const companySector = await ensureSectorPresentInCompanyRecord(sectorName);
    if (!companySector) {
      setError("Setor nao adicionado ao pacote DRPS.");
      return;
    }
    const response = await fetch(`/api/admin/campaigns/${campaign.id}/sectors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: sectorName,
        riskParameter: companySector.riskParameter ?? 1,
        isActive: true,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok && response.status !== 207) {
      setError(payload.error ?? "Falha ao adicionar setor ao pacote DRPS.");
      return;
    }

    await refreshExpandedCampaignSectors(campaign.id);
    setExpandedCampaignId(campaign.id);
  }

  async function toggleSectorSubitemActive(campaign: Diagnostic, sector: SectorLink) {
    setError("");
    setDrpsActionNotice("");
    try {
      const response = await fetch(`/api/admin/campaigns/${campaign.id}/sectors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: sector.name,
          riskParameter: sector.riskParameter ?? 1,
          isActive: !sector.isActive,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok && response.status !== 207) {
        setError(payload.error ?? "Falha ao atualizar status do sub-questionario.");
        return;
      }
      await refreshExpandedCampaignSectors(campaign.id);
      setDrpsActionNotice(
        !sector.isActive
          ? `Sub-questionario ativado: ${sector.name}.`
          : `Sub-questionario desativado: ${sector.name}.`,
      );
    } catch {
      setError("Falha ao atualizar status do sub-questionario.");
    }
  }

  async function deleteCampaign(campaign: Diagnostic) {
    if (!window.confirm(`Excluir o pacote DRPS \"${campaign.name}\"?`)) return;
    setError("");
    setDrpsActionNotice("");
    const response = await fetch(`/api/admin/campaigns/${campaign.id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
    if (!response.ok) {
      setError(payload.details ?? payload.error ?? "Falha ao excluir campanha DRPS.");
      return;
    }
    setExpandedCampaignId((previous) => (previous === campaign.id ? null : previous));
    setOpenCampaignActionsFor((previous) => (previous === campaign.id ? null : previous));
    await loadBase();
  }

  async function updateCampaignLifecycle(
    campaign: Diagnostic,
    nextStatus: "live" | "draft" | "archived",
  ) {
    setError("");
    setDrpsActionNotice("");
    const response = await fetch(`/api/admin/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
    if (!response.ok) {
      setError(payload.details ?? payload.error ?? "Falha ao atualizar status do pacote DRPS.");
      return;
    }
    await loadBase();
    setDrpsActionNotice(
      nextStatus === "live"
        ? `Pacote ativado: ${campaign.name}.`
        : nextStatus === "draft"
          ? `Pacote pausado: ${campaign.name}.`
          : `Pacote arquivado: ${campaign.name}.`,
    );
  }

  async function deleteSectorSubitem(campaign: Diagnostic, sector: SectorLink) {
    if (!window.confirm(`Remover o sub-questionario do setor \"${sector.name}\"?`)) return;
    setError("");
    setDrpsActionNotice("");
    try {
      const response = await fetch(`/api/admin/campaigns/${campaign.id}/sectors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: sector.name,
          riskParameter: sector.riskParameter ?? 1,
          isActive: false,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok && response.status !== 207) {
        setError(payload.error ?? "Falha ao remover sub-questionario.");
        return;
      }
      await refreshExpandedCampaignSectors(campaign.id);
      setError("");
      setDrpsActionNotice(`Sub-questionario removido (inativado): ${sector.name}.`);
    } catch {
      setError("Falha ao remover sub-questionario.");
    }
  }

  function openSingleSectorLinkModal(campaign: Diagnostic, sector: SectorLink) {
    setError("");
    setDrpsActionNotice("");
    setCopiedSectorId(null);
    setLinksPayload({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        slug: campaign.public_slug,
      },
      sectors: [sector],
    });
    setIsLinksModalOpen(true);
  }

  async function copySectorLink(sector: SectorLink) {
    if (!sector.isActive) {
      return;
    }
    setDrpsActionNotice("");
    const link = sector.accessLink?.trim();
    if (!link) {
      setError("Link do setor indisponivel.");
      return;
    }
    const copied = await copyTextToClipboard(link);
    if (!copied) {
      window.prompt("Copie o link do setor:", link);
    }
    setCopiedSectorId(sector.id);
    setError("");
    setDrpsActionNotice(`Link copiado para o setor ${sector.name}.`);
    window.setTimeout(() => setCopiedSectorId(null), 1200);
  }

  async function copyAllLinks() {
    if (!linksPayload) return;
    setDrpsActionNotice("");
    const lines = linksPayload.sectors.filter((sector) => sector.isActive).map((sector) => `${sector.name}: ${sector.accessLink}`);
    if (lines.length === 0) {
      setError("Nenhum setor ativo para copiar.");
      return;
    }
    const copied = await copyTextToClipboard(lines.join("\n"));
    if (!copied) {
      window.prompt("Copie os links dos setores:", lines.join("\n"));
    }
    setError("");
    setDrpsActionNotice("Links dos setores copiados.");
  }

  async function copyAccessInvitationLink() {
    if (!client?.access.invitationLink) return;
    await navigator.clipboard.writeText(client.access.invitationLink);
    setAccessInviteCopied(true);
    window.setTimeout(() => setAccessInviteCopied(false), 1200);
  }

  function updateSectorForm(id: string, patch: Partial<SectorProfileForm>) {
    setSectorForms((previous) =>
      previous.map((sector) => (sector.id === id ? { ...sector, ...patch } : sector)),
    );
  }

  function updateSectorModalForm(patch: Partial<SectorProfileForm>) {
    setSectorModalForm((previous) => ({ ...previous, ...patch }));
  }

  function openAddSectorModal() {
    setSectorModalMode("add");
    setSectorModalForm(createSectorProfileForm());
    setIsSectorModalOpen(true);
  }

  function openEditSectorModal(id: string) {
    const selected = sectorForms.find((sector) => sector.id === id);
    if (!selected) return;
    setSectorModalMode("edit");
    setSectorModalForm({ ...selected });
    setIsSectorModalOpen(true);
  }

  function saveSectorModal() {
    if (sectorModalForm.name.trim().length < 2) {
      setError("Nome do setor precisa ter pelo menos 2 caracteres.");
      return;
    }
    setError("");
    if (sectorModalMode === "add") {
      setSectorForms((previous) => [...previous, { ...sectorModalForm }]);
    } else {
      updateSectorForm(sectorModalForm.id, { ...sectorModalForm });
    }
    setIsSectorModalOpen(false);
  }

  function removeSectorForm(id: string) {
    setSectorForms((previous) => previous.filter((sector) => sector.id !== id));
  }

  async function updateCompanyProfile() {
    if (!client) return;
    if (companyForm.companyName.trim().length < 2 || companyForm.cnpj.trim().length < 8) {
      setError("Nome da empresa e CNPJ sao obrigatorios.");
      return;
    }

    const invalidSector = sectorForms.find((sector) => sector.name.trim().length < 2);
    if (invalidSector) {
      setError("Todos os setores precisam ter nome com pelo menos 2 caracteres.");
      return;
    }

    setIsSavingCompanyProfile(true);
    setError("");

    const payload = {
      companyName: companyForm.companyName.trim(),
      cnpj: companyForm.cnpj.trim(),
      status: companyForm.status,
      billingStatus: companyForm.billingStatus,
      totalEmployees: companyHeadcountFromSectors.totalEmployees,
      remoteEmployees: companyHeadcountFromSectors.remoteEmployees,
      onsiteEmployees: companyHeadcountFromSectors.onsiteEmployees,
      hybridEmployees: companyHeadcountFromSectors.hybridEmployees,
      contactName: companyForm.contactName.trim(),
      contactEmail: companyForm.contactEmail.trim(),
      contactPhone: companyForm.contactPhone.trim(),
      contractStartDate: companyForm.contractStartDate,
      contractEndDate: companyForm.contractEndDate,
      sectors: sectorForms.map((sector) => ({
        name: sector.name.trim(),
        isActive: sector.isActive,
        remoteWorkers: sector.remoteWorkers,
        onsiteWorkers: sector.onsiteWorkers,
        hybridWorkers: sector.hybridWorkers,
        functions: sector.functions.trim(),
        workersInRole: sector.workersInRole,
        shifts: sector.shifts.trim(),
        vulnerableGroups: sector.vulnerableGroups.trim(),
        mainContactName: sector.mainContactName.trim(),
        mainContactEmail: sector.mainContactEmail.trim(),
        mainContactPhone: sector.mainContactPhone.trim(),
        possibleMentalHealthHarms: sector.possibleMentalHealthHarms.trim(),
        existingControlMeasures: sector.existingControlMeasures.trim(),
        elaborationDate: sector.elaborationDate,
        riskParameter: toRiskParameter(sector.riskParameter, 1),
      })),
    };

    const response = await fetch(`/api/admin/clients/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => ({}))) as {
      client?: ClientDetail;
      error?: string;
      warning?: string;
    };
    if (!response.ok && response.status !== 207) {
      setError(data.error || "Falha ao atualizar dados da empresa.");
      setIsSavingCompanyProfile(false);
      return;
    }
    if (response.status === 207 && data.error) {
      setError(data.error);
      setIsSavingCompanyProfile(false);
      return;
    }
    if (data.warning?.toLowerCase().includes("legacy mode")) {
      setError(data.warning);
      setIsSavingCompanyProfile(false);
      return;
    }
    const postSaveWarning = data.warning ?? "";
    setIsEditingCompanyProfile(false);
    await loadBase();
    if (postSaveWarning) {
      setError(postSaveWarning);
    }
    setIsSavingCompanyProfile(false);
  }

  async function toggleClientPortalAccess() {
    if (!client) return;

    const willBlock = !isClientAccessBlocked;
    const nextBillingStatus: ClientProfileForm["billingStatus"] = willBlock ? "blocked" : "pending";
    const confirmationMessage = willBlock
      ? "Bloquear este cliente para impedir acesso ao portal?"
      : "Desbloquear este cliente para permitir acesso ao portal?";
    if (!window.confirm(confirmationMessage)) {
      return;
    }

    setIsTogglingClientAccess(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingStatus: nextBillingStatus }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok && response.status !== 207) {
        setError(payload.error ?? "Falha ao atualizar bloqueio de acesso.");
        return;
      }
      if (response.status === 207 && payload.error) {
        setError(payload.error);
        return;
      }
      await loadBase();
    } finally {
      setIsTogglingClientAccess(false);
    }
  }

  async function deleteClientRecord() {
    if (!client) return;
    if (
      !window.confirm(
        `Excluir definitivamente o cliente \"${client.companyName}\"? Esta acao remove campanhas, relatorios e dados relacionados.`,
      )
    ) {
      return;
    }

    setIsDeletingClient(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/clients/${client.id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Falha ao excluir cliente.");
        return;
      }
      router.push("/manager/clients");
      router.refresh();
    } finally {
      setIsDeletingClient(false);
    }
  }

  function exportLinksCsv() {
    if (!linksPayload) return;
    const header = ["campaign_id", "campaign_slug", "sector", "active", "submission_count", "access_link"].join(",");
    const rows = linksPayload.sectors.map((sector) =>
      [csvEscape(linksPayload.campaign.id), csvEscape(linksPayload.campaign.slug), csvEscape(sector.name), csvEscape(sector.isActive ? "true" : "false"), csvEscape(sector.submissionCount), csvEscape(sector.isActive ? sector.accessLink : null)].join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${linksPayload.campaign.slug || linksPayload.campaign.id}-links-questionario.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function focusResults(campaign: Diagnostic) {
    openCampaignResults(campaign);
  }

  function closeLinksModal() {
    setIsLinksModalOpen(false);
    setCopiedSectorId(null);
  }

  function openAssignProgramModal() {
    const firstAvailableProgram = unassignedProgramOptions[0] ?? null;
    setAssignProgramForm({
      programIds: firstAvailableProgram ? [firstAvailableProgram.id] : [],
      status: "Active",
      deployedAt: toDatetimeLocal(new Date().toISOString()),
      scheduleFrequency: "biweekly",
    });
    setContinuousError("");
    setContinuousNotice("");
    setIsProgramModalOpen(true);
  }

  async function assignContinuousProgram() {
    if (!client) return;
    if (assignProgramForm.programIds.length === 0) {
      setContinuousError("Selecione ao menos um programa para atribuir.");
      return;
    }

    setIsSavingProgram(true);
    setContinuousError("");
    setContinuousNotice("");
    const deployedAtIso = fromDatetimeLocal(assignProgramForm.deployedAt);
    try {
      for (const programId of assignProgramForm.programIds) {
        const response = await fetch(`/api/admin/clients/${client.id}/programs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            programId,
            status: assignProgramForm.status,
            ...(deployedAtIso ? { deployedAt: deployedAtIso } : {}),
            scheduleFrequency: assignProgramForm.scheduleFrequency,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          throw new Error(data.error ?? "Falha ao atribuir programa.");
        }
      }

      setIsProgramModalOpen(false);
      await loadContinuousPrograms(client.id);
      setContinuousNotice(
        assignProgramForm.programIds.length === 1
          ? "Programa atribuido com sucesso."
          : `${assignProgramForm.programIds.length} programas atribuidos com sucesso.`,
      );
    } catch (assignError) {
      setContinuousError(assignError instanceof Error ? assignError.message : "Falha ao atribuir programa.");
    } finally {
      setIsSavingProgram(false);
    }
  }

  function toggleAnnualPlanMonthDraft(assignment: AssignedContinuousProgram, monthKey: string) {
    if (assignment.status !== "Active") {
      setContinuousError("Ative o programa antes de definir o cronograma anual.");
      return;
    }

    const validMonthKeys = new Set(annualPlanColumns.map((column) => column.key));
    const currentMonths =
      annualPlanDraftByAssignment[assignment.id] ??
      annualPlanBaseByAssignment[assignment.id] ??
      extractAnnualPlanMonths(assignment);
    const nextMonthsSet = new Set(normalizeAnnualPlanMonths(currentMonths));
    for (const key of Array.from(nextMonthsSet.values())) {
      if (!validMonthKeys.has(key)) nextMonthsSet.delete(key);
    }
    if (nextMonthsSet.has(monthKey)) {
      nextMonthsSet.delete(monthKey);
    } else {
      nextMonthsSet.add(monthKey);
    }
    const nextMonths = normalizeAnnualPlanMonths(Array.from(nextMonthsSet.values()));
    setAnnualPlanDraftByAssignment((previous) => ({
      ...previous,
      [assignment.id]: nextMonths,
    }));
    setContinuousError("");
    setContinuousNotice("");
  }

  async function saveAnnualPlan() {
    if (!client) return;

    const pendingAssignments = assignedPrograms
      .map((assignment) => {
        const base = annualPlanBaseByAssignment[assignment.id] ?? extractAnnualPlanMonths(assignment);
        const draft = annualPlanDraftByAssignment[assignment.id] ?? base;
        return { assignment, base, draft: normalizeAnnualPlanMonths(draft) };
      })
      .filter((item) => !sameMonthsSelection(item.base, item.draft));

    if (pendingAssignments.length === 0) {
      setContinuousNotice("Nenhuma alteracao pendente no cronograma anual.");
      setContinuousError("");
      return;
    }

    setIsSavingAnnualPlan(true);
    setContinuousError("");
    setContinuousNotice("");
    try {
      for (const item of pendingAssignments) {
        const response = await fetch(`/api/admin/clients/${client.id}/programs/${item.assignment.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ annualPlanMonths: item.draft }),
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          throw new Error(
            data.error ??
              `Falha ao salvar cronograma anual para ${item.assignment.programTitle}.`,
          );
        }
      }
      await loadContinuousPrograms(client.id);
      setContinuousNotice("Cronograma anual salvo.");
    } catch (saveError) {
      setContinuousError(
        saveError instanceof Error ? saveError.message : "Falha ao salvar cronograma anual.",
      );
    } finally {
      setIsSavingAnnualPlan(false);
    }
  }

  async function removeAssignedProgram(assignmentId: string) {
    if (!client) return;
    if (!window.confirm("Remover este programa da empresa?")) {
      return;
    }

    setIsSavingProgram(true);
    setContinuousError("");
    setContinuousNotice("");
    const response = await fetch(`/api/admin/clients/${client.id}/programs/${assignmentId}`, {
      method: "DELETE",
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setContinuousError(data.error ?? "Falha ao remover programa atribuido.");
      setIsSavingProgram(false);
      return;
    }
    await loadContinuousPrograms(client.id);
    setContinuousNotice("Programa removido.");
    setIsSavingProgram(false);
  }

  if (isLoading) return <p className="text-sm text-[#49697a]">Carregando ficha do cliente...</p>;
  if (!client) return <p className="text-sm text-red-600">{error || "Cliente indisponivel."}</p>;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <nav className="text-xs text-[#4f6977]">
          <Link href="/manager/clients" className="text-[#0f5b73]">
            Client area
          </Link>{" "}
          / <span>{client.companyName}</span>
        </nav>
        <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold text-[#123447]">{client.companyName}</h2>
              <p className="mt-1 text-sm text-[#35515f]">
                CNPJ {client.cnpj} | Status {client.status} | Financeiro {client.billingStatus}
              </p>
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border border-[#d7d7d7] bg-[#ececec] p-2">
          <p className="px-2 pb-2 text-xs font-semibold text-[#697983]">Company profile</p>
          <nav className="space-y-1">
            {TAB_ITEMS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm ${
                  activeTab === tab.id
                    ? "bg-white font-semibold text-[#0f1720]"
                    : "text-[#202f38] hover:bg-white/70"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>
        <div className="space-y-6">

      {(activeTab === "overview" || activeTab === "assigned-drps") ? (
        <section id="drps-dashboard" className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-[#123447]">Dashboard DRPS do diagnostico selecionado</h3>
            <select className="rounded border border-[#c9dce8] px-3 py-2 text-sm" value={selectedCampaignId} onChange={(event) => setSelectedCampaignId(event.target.value)}>
              {client.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} ({campaign.status})</option>)}
            </select>
          </div>
          {snapshot ? (
            <div className="grid gap-3 md:grid-cols-4">
              <article className="rounded-xl border border-[#d8e4ee] p-3"><p className="text-xs text-[#4f6977]">Respostas</p><p className="mt-1 text-xl font-semibold text-[#133748]">{snapshot.totals.responses}</p></article>
              <article className="rounded-xl border border-[#d8e4ee] p-3"><p className="text-xs text-[#4f6977]">Topicos</p><p className="mt-1 text-xl font-semibold text-[#133748]">{snapshot.totals.topics}</p></article>
              <article className="rounded-xl border border-[#d8e4ee] p-3"><p className="text-xs text-[#4f6977]">Risco alto+critico</p><p className="mt-1 text-xl font-semibold text-[#133748]">{snapshot.riskDistribution.high + snapshot.riskDistribution.critical}</p></article>
              <article className="rounded-xl border border-[#d8e4ee] p-3"><p className="text-xs text-[#4f6977]">Ultimo DRPS</p><p className="mt-1 text-sm font-semibold text-[#133748]">{snapshot.drps ? `${snapshot.drps.part1_probability_score.toFixed(2)} (${snapshot.drps.part1_probability_class})` : "Sem DRPS"}</p></article>
            </div>
          ) : <p className="text-sm text-[#5a7383]">Selecione um diagnostico ativo para visualizar resultados.</p>}
        </section>
      ) : null}

      {activeTab === "overview" ? (
        <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#123447]">Resultados atuais</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <article className="rounded-xl border border-[#d8e4ee] p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-[#4f6977]">DRPS atual</p>
              {snapshot?.drps ? (
                <>
                  <p className="mt-1 text-sm font-semibold text-[#133748]">
                    {snapshot.drps.part1_probability_score.toFixed(2)} ({snapshot.drps.part1_probability_class})
                  </p>
                  <p className="mt-1 text-xs text-[#4f6977]">Campanha: {selectedCampaign?.name ?? "Nao selecionada"}</p>
                </>
              ) : (
                <p className="mt-1 text-sm text-[#5a7383]">Sem resultado DRPS disponivel.</p>
              )}
            </article>
            <article className="rounded-xl border border-[#d8e4ee] p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-[#4f6977]">Processo continuo atual</p>
              {primaryContinuousProgram ? (
                <>
                  <p className="mt-1 text-sm font-semibold text-[#133748]">
                    {primaryContinuousProgram.programTitle}
                  </p>
                  <p className="mt-1 text-xs text-[#4f6977]">
                    Status {primaryContinuousProgram.status} | Aplicado em{" "}
                    {fmtDate(primaryContinuousProgram.deployedAt)}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-[#5a7383]">Nenhum processo continuo atribuido.</p>
              )}
            </article>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("assigned-drps")}
              className="rounded-full border border-[#9ec8db] px-4 py-2 text-sm font-semibold text-[#0f5b73]"
            >
              Ver diagnosticos atribuidos
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("assigned-continuous")}
              className="rounded-full border border-[#9ec8db] px-4 py-2 text-sm font-semibold text-[#0f5b73]"
            >
              Ver processos continuos
            </button>
          </div>
        </section>
      ) : null}

      {activeTab === "company-data" ? (
        <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-[#123447]">Company data</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/manager/clients/${client.id}/company-risk-profile`}
                className="inline-flex items-center gap-2 rounded-full border border-[#b7dca3] px-3 py-1 text-xs font-semibold text-[#2d5f23]"
              >
                Company risk profile results
              </Link>
              <button
                type="button"
                onClick={() => void toggleClientPortalAccess()}
                disabled={isEditingCompanyProfile || isSavingCompanyProfile || isTogglingClientAccess || isDeletingClient}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
                  isClientAccessBlocked
                    ? "border-[#9ec8db] text-[#0f5b73]"
                    : "border-[#f0c9c9] text-[#8f2a2a]"
                }`}
              >
                {isTogglingClientAccess
                  ? "Atualizando..."
                  : isClientAccessBlocked
                    ? "Unblock client access"
                    : "Block client access"}
              </button>
              <button
                type="button"
                onClick={() => void deleteClientRecord()}
                disabled={isEditingCompanyProfile || isSavingCompanyProfile || isDeletingClient || isTogglingClientAccess}
                className="inline-flex items-center gap-2 rounded-full border border-[#f0c9c9] px-3 py-1 text-xs font-semibold text-[#8f2a2a] disabled:opacity-50"
              >
                {isDeletingClient ? "Deleting..." : "Delete client"}
              </button>
              {!isEditingCompanyProfile ? (
                <button
                  type="button"
                  onClick={() => {
                    setCompanyForm(buildClientProfileForm(client));
                    setSectorForms(client.sectors.map(buildSectorProfileForm));
                    setIsEditingCompanyProfile(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                >
                  <EditIcon />
                  Edit
                </button>
              ) : null}
            </div>
          </div>
          {isEditingCompanyProfile ? (
            <>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs text-[#4f6977]">
                  Company name
                  <input
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyForm.companyName}
                    onChange={(event) =>
                      setCompanyForm((previous) => ({ ...previous, companyName: event.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  CNPJ
                  <input
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyForm.cnpj}
                    onChange={(event) =>
                      setCompanyForm((previous) => ({ ...previous, cnpj: event.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Status
                  <select
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyForm.status}
                    onChange={(event) =>
                      setCompanyForm((previous) => ({
                        ...previous,
                        status: event.target.value as "Active" | "Pending" | "Inactive",
                      }))
                    }
                  >
                    <option value="Active">Active</option>
                    <option value="Pending">Pending</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </label>
                <label className="text-xs text-[#4f6977]">
                  Billing
                  <select
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyForm.billingStatus}
                    onChange={(event) =>
                      setCompanyForm((previous) => ({
                        ...previous,
                        billingStatus: event.target.value as
                          | "up_to_date"
                          | "pending"
                          | "overdue"
                          | "blocked",
                      }))
                    }
                  >
                    <option value="up_to_date">up_to_date</option>
                    <option value="pending">pending</option>
                    <option value="overdue">overdue</option>
                    <option value="blocked">blocked</option>
                  </select>
                </label>
                <label className="text-xs text-[#4f6977]">
                  Total employees
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyHeadcountFromSectors.totalEmployees}
                    readOnly
                    disabled
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Remote employees
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyHeadcountFromSectors.remoteEmployees}
                    readOnly
                    disabled
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Onsite employees
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyHeadcountFromSectors.onsiteEmployees}
                    readOnly
                    disabled
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Hybrid employees
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyHeadcountFromSectors.hybridEmployees}
                    readOnly
                    disabled
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Contact name
                  <input
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyForm.contactName}
                    onChange={(event) =>
                      setCompanyForm((previous) => ({ ...previous, contactName: event.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Contact email
                  <input
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyForm.contactEmail}
                    onChange={(event) =>
                      setCompanyForm((previous) => ({ ...previous, contactEmail: event.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Contact phone
                  <input
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyForm.contactPhone}
                    onChange={(event) =>
                      setCompanyForm((previous) => ({ ...previous, contactPhone: event.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Contract start date
                  <input
                    type="date"
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyForm.contractStartDate}
                    onChange={(event) =>
                      setCompanyForm((previous) => ({ ...previous, contractStartDate: event.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Contract end date
                  <input
                    type="date"
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyForm.contractEndDate}
                    onChange={(event) =>
                      setCompanyForm((previous) => ({ ...previous, contractEndDate: event.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="mt-5 rounded-2xl border border-[#d8e4ee] bg-[#f8fbfd] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#123447]">Setores e detalhes do levantamento</p>
                  <button
                    type="button"
                    onClick={openAddSectorModal}
                    className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                  >
                    Add setor
                  </button>
                </div>
                <div className="mt-3 overflow-x-auto rounded-xl border border-[#d8e4ee] bg-white">
                  {sectorForms.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-[#5a7383]">Nenhum setor cadastrado.</p>
                  ) : (
                    <table className="nr-table min-w-full text-sm">
                      <thead>
                        <tr className="border-b bg-[#f8fbfd]">
                          <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Setor</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Status</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Contato</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Email</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Telefone</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Risco</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Acoes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sectorForms.map((sector) => (
                          <tr key={sector.id} className="border-b last:border-b-0">
                            <td className="px-3 py-2">{sector.name || "-"}</td>
                            <td className="px-3 py-2">{sector.isActive ? "Ativo" : "Inativo"}</td>
                            <td className="px-3 py-2">{sector.mainContactName || "-"}</td>
                            <td className="px-3 py-2">{sector.mainContactEmail || "-"}</td>
                            <td className="px-3 py-2">{sector.mainContactPhone || "-"}</td>
                            <td className="px-3 py-2">{toRiskParameter(sector.riskParameter, 1).toFixed(2)}x</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEditSectorModal(sector.id)}
                                  className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeSectorForm(sector.id)}
                                  className="rounded-full border border-[#e9c0c0] px-3 py-1 text-xs font-semibold text-[#8f2a2a]"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isSavingCompanyProfile}
                  onClick={() => void updateCompanyProfile()}
                  className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Save profile
                </button>
                <button
                  type="button"
                  disabled={isSavingCompanyProfile}
                  onClick={() => {
                    setCompanyForm(buildClientProfileForm(client));
                    setSectorForms(client.sectors.map(buildSectorProfileForm));
                    setIsSectorModalOpen(false);
                    setIsEditingCompanyProfile(false);
                  }}
                  className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73] disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm">
                CNPJ: {client.cnpj} | Status: {client.status} | Financeiro: {client.billingStatus}
              </p>
              <p className="mt-1 text-sm">
                Contato: {client.contactName || "-"} | {client.contactEmail || "-"} | {client.contactPhone || "-"}
              </p>
              <p className="mt-1 text-sm">
                Colaboradores: {client.totalEmployees} (R {client.remoteEmployees} / P {client.onsiteEmployees} / H{" "}
                {client.hybridEmployees})
              </p>
              <p className="mt-1 text-sm">
                Contrato: {fmtDate(client.contractStartDate)} - {fmtDate(client.contractEndDate)}
              </p>
              <div className="mt-3 rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4f6977]">
                  Client access
                </p>
                <p className="mt-1 text-sm text-[#153748]">
                  Credentials:{" "}
                  {client.access.hasCredentials
                    ? `Configured (${client.access.loginEmail ?? "-"})`
                    : "Pending setup"}
                </p>
                <p className="mt-1 text-sm text-[#153748]">
                  Invitation status: {accessInvitationStatusLabel(client.access.invitationStatus)}
                </p>
                <p className="mt-1 text-sm text-[#153748]">
                  Portal access: {isClientAccessBlocked ? "Blocked" : "Active"}
                </p>
                {client.access.invitationExpiresAt ? (
                  <p className="mt-1 text-xs text-[#4f6977]">
                    Invitation expires: {fmt(client.access.invitationExpiresAt)}
                  </p>
                ) : null}
                {client.access.invitationAcceptedAt ? (
                  <p className="mt-1 text-xs text-[#4f6977]">
                    Invitation accepted: {fmt(client.access.invitationAcceptedAt)}
                  </p>
                ) : null}
                {client.access.invitationLink ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      readOnly
                      value={client.access.invitationLink}
                      className="w-full rounded border border-[#c9dce8] bg-white px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => void copyAccessInvitationLink()}
                      className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                    >
                      {accessInviteCopied ? "Copiado" : "Copiar"}
                    </button>
                  </div>
                ) : null}
              </div>
              <p className="mt-1 text-sm">Setores: {client.sectors.length}</p>
              <div className="mt-3 overflow-x-auto rounded-xl border border-[#d8e4ee]">
                <table className="nr-table min-w-full text-sm">
                  <thead>
                    <tr className="border-b bg-[#f8fbfd]">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Setor</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Status</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Contato</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Email</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Telefone</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[#4f6977]">Risco</th>
                    </tr>
                  </thead>
                  <tbody>
                    {client.sectors.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-3 text-xs text-[#5a7383]">
                          Nenhum setor cadastrado.
                        </td>
                      </tr>
                    ) : (
                      client.sectors.map((sector) => (
                        <tr key={sector.id} className="border-b last:border-b-0">
                          <td className="px-3 py-2">{sector.name}</td>
                          <td className="px-3 py-2">{sector.isActive ?? true ? "Ativo" : "Inativo"}</td>
                          <td className="px-3 py-2">{sector.mainContactName || "-"}</td>
                          <td className="px-3 py-2">{sector.mainContactEmail || "-"}</td>
                          <td className="px-3 py-2">{sector.mainContactPhone || "-"}</td>
                          <td className="px-3 py-2">{sector.riskParameter.toFixed(2)}x</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ) : null}

      {activeTab === "assigned-drps" ? (
        <>
          <section className="h-auto rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
            <div className="flex flex-wrap gap-2">
              <Link href={`/manager/clients/${client.id}/assign-drps`} className="rounded-full bg-[#0f5b73] px-4 py-2 text-sm font-semibold text-white">
                Atribuir diagnosticos DRPS
              </Link>
              <button type="button" disabled={isBusy} onClick={() => void generateSeriesReports()} className="rounded-full border border-[#e4c898] px-4 py-2 text-sm font-semibold text-[#7a4b00] disabled:opacity-50">Gerar serie de relatorios</button>
            </div>
          </section>
          <section
            className={`h-auto max-h-none overflow-visible rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm ${
              isDrpsActionsMenuOpen ? "pb-28" : ""
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-[#123447]">Diagnosticos DRPS atribuidos</h3>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!resultsCampaign}
                  onClick={() => {
                    if (!resultsCampaign) return;
                    focusResults(resultsCampaign);
                  }}
                  className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447] disabled:cursor-not-allowed disabled:border-[#d6dde2] disabled:text-[#95a4ae]"
                >
                  Ver resultados
                </button>
                {resultsCampaign ? (
                  <a
                    href={`/api/admin/clients/${client.id}/campaigns/${resultsCampaign.id}/responses/raw-download`}
                    className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73] hover:bg-[#f1f8fc]"
                  >
                    Download raw data
                  </a>
                ) : (
                  <span className="rounded-full border border-[#d6dde2] px-3 py-1 text-xs font-semibold text-[#95a4ae]">
                    Download raw data
                  </span>
                )}
                <button
                  type="button"
                  disabled={!linksActionCampaign || isLoadingLinksFor === linksActionCampaign.id}
                  onClick={() => {
                    if (!linksActionCampaign) return;
                    void loadQuestionnaireLinks(linksActionCampaign);
                  }}
                  className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73] disabled:cursor-not-allowed disabled:border-[#d6dde2] disabled:text-[#95a4ae]"
                >
                  {linksActionCampaign && isLoadingLinksFor === linksActionCampaign.id
                    ? "Carregando..."
                    : "Gerar link questionario"}
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-[#4f6977]">
              {selectedCampaign
                ? `Questionario atual: ${campaignCollectionStatus(selectedCampaign.status)}`
                : "Sem questionario selecionado."}
            </p>
            <div className="mt-3 max-h-none overflow-x-auto overflow-y-visible">
              <table className="nr-table min-w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left">Pacote</th>
                    <th className="px-2 py-2 text-left">Diagnostico</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-left">Inicio</th>
                    <th className="px-2 py-2 text-left">Fechamento</th>
                    <th className="px-2 py-2 text-left">Respostas</th>
                    <th className="px-2 py-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {client.campaigns.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-2 py-3 text-xs text-[#5a7383]">
                        Nenhum diagnostico atribuido.
                      </td>
                    </tr>
                  ) : (
                    client.campaigns.map((campaign) => {
                      const isExpanded = expandedCampaignId === campaign.id;
                      const expandedSectors = expandedCampaignSectorsById[campaign.id] ?? [];
                      const responseTotal = expandedSectors.reduce(
                        (total, sector) => total + (sector.submissionCount ?? 0),
                        0,
                      );
                      return (
                        <Fragment key={campaign.id}>
                          <tr className="border-b">
                            <td className="px-2 py-2">
                              <button
                                type="button"
                                onClick={() => void toggleCampaignPackage(campaign.id)}
                                className="rounded-full border border-[#c9dce8] px-2 py-0.5 text-xs font-semibold text-[#123447]"
                                title="Abrir/fechar sub-questionarios por setor"
                              >
                                {isExpanded ? "-" : "+"}
                              </button>
                            </td>
                            <td className="px-2 py-2">
                              <Link
                                href={`/manager/clients/${client.id}/diagnostic/${campaign.id}`}
                                className="font-semibold text-[#123447] hover:text-[#0f5b73] hover:underline"
                              >
                                {campaign.name}
                              </Link>
                            </td>
                            <td className="px-2 py-2">{campaignCollectionStatus(campaign.status)}</td>
                            <td className="px-2 py-2">{fmt(campaign.starts_at)}</td>
                            <td className="px-2 py-2">{fmt(campaign.closes_at)}</td>
                            <td className="px-2 py-2">{responseTotal || campaign.responses || 0}</td>
                            <td className="px-2 py-2">
                              <div className="relative inline-flex">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpenCampaignActionsFor((previous) =>
                                      previous === campaign.id ? null : campaign.id,
                                    )
                                  }
                                  className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447]"
                                >
                                  ...
                                </button>
                                {openCampaignActionsFor === campaign.id ? (
                                  <div className="absolute right-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-xl border border-[#d8e4ee] bg-white shadow-lg">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenCampaignActionsFor(null);
                                        openCampaignResults(campaign);
                                      }}
                                      className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#123447] hover:bg-[#f4f9fc]"
                                    >
                                      Ver resultados
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenCampaignActionsFor(null);
                                        void loadQuestionnaireLinks(campaign);
                                      }}
                                      className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#0f5b73] hover:bg-[#f4f9fc]"
                                    >
                                      Gerar links
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenCampaignActionsFor(null);
                                        void addSectorToCampaign(campaign);
                                      }}
                                      className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#2d5f23] hover:bg-[#f4f9fc]"
                                    >
                                      Adicionar setor
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenCampaignActionsFor(null);
                                        void updateCampaignLifecycle(campaign, "live");
                                      }}
                                      className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#0f5b73] hover:bg-[#f4f9fc]"
                                    >
                                      Ativar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenCampaignActionsFor(null);
                                        void updateCampaignLifecycle(campaign, "draft");
                                      }}
                                      className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#7a4b00] hover:bg-[#fdf8f1]"
                                    >
                                      Pausar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenCampaignActionsFor(null);
                                        void updateCampaignLifecycle(campaign, "archived");
                                      }}
                                      className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#5a3f7c] hover:bg-[#f7f1fd]"
                                    >
                                      Arquivar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenCampaignActionsFor(null);
                                        void deleteCampaign(campaign);
                                      }}
                                      className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#8a2d2d] hover:bg-[#fff4f4]"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                          {isExpanded ? (
                            loadingExpandedCampaignId === campaign.id ? (
                              <tr className="border-b bg-[#f8fbfd]">
                                <td colSpan={7} className="px-2 py-3 text-xs text-[#5a7383]">
                                  Carregando sub-questionarios...
                                </td>
                              </tr>
                            ) : expandedSectors.length === 0 ? (
                              <tr className="border-b bg-[#f8fbfd]">
                                <td colSpan={7} className="px-2 py-3 text-xs text-[#5a7383]">
                                  Nenhum sub-questionario por setor.
                                </td>
                              </tr>
                            ) : (
                              expandedSectors.map((sector) => {
                                const subItemKey = `${campaign.id}:${sector.id}`;
                                return (
                                  <tr key={subItemKey} className="border-b bg-[#f8fbfd]">
                                    <td className="px-2 py-2 text-xs text-[#5a7383]">sub</td>
                                    <td className="px-2 py-2 text-xs font-semibold text-[#123447]">
                                      {sector.name}
                                    </td>
                                    <td className="px-2 py-2 text-xs">
                                      {sector.isActive ? "Sub-questionario ativo" : "Sub-questionario inativo"}
                                    </td>
                                    <td className="px-2 py-2 text-xs">{fmt(campaign.starts_at)}</td>
                                    <td className="px-2 py-2 text-xs">{fmt(campaign.closes_at)}</td>
                                    <td className="px-2 py-2 text-xs">{sector.submissionCount}</td>
                                    <td className="px-2 py-2 text-xs">
                                      <div className="relative inline-flex">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setOpenCampaignSectorActionsFor((previous) =>
                                              previous === subItemKey ? null : subItemKey,
                                            )
                                          }
                                          className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447]"
                                        >
                                          ...
                                        </button>
                                        {openCampaignSectorActionsFor === subItemKey ? (
                                          <div className="absolute right-0 top-full z-20 mt-2 w-52 overflow-hidden rounded-xl border border-[#d8e4ee] bg-white shadow-lg">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setOpenCampaignSectorActionsFor(null);
                                                openCampaignResults(campaign, sector.name);
                                              }}
                                              className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#123447] hover:bg-[#f4f9fc]"
                                            >
                                              Ver resultados
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setOpenCampaignSectorActionsFor(null);
                                                openSingleSectorLinkModal(campaign, sector);
                                              }}
                                              className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#0f5b73] hover:bg-[#f4f9fc]"
                                            >
                                              Gerar link (singulo)
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setOpenCampaignSectorActionsFor(null);
                                                void toggleSectorSubitemActive(campaign, sector);
                                              }}
                                              className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#2d5f23] hover:bg-[#f4f9fc]"
                                            >
                                              {sector.isActive ? "Desativar" : "Ativar"}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setOpenCampaignSectorActionsFor(null);
                                                void deleteSectorSubitem(campaign, sector);
                                              }}
                                              className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#8a2d2d] hover:bg-[#fff4f4]"
                                            >
                                              Delete
                                            </button>
                                          </div>
                                        ) : null}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {drpsActionNotice ? <p className="mt-3 text-sm text-[#1f6b2f]">{drpsActionNotice}</p> : null}
          </section>
          <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-[#123447]">Relatorios gerados</h3>
            <div className="mt-3 overflow-x-auto"><table className="nr-table min-w-full text-sm"><thead><tr className="border-b"><th className="px-2 py-2 text-left">Titulo</th><th className="px-2 py-2 text-left">Status</th><th className="px-2 py-2 text-left">Criado</th></tr></thead><tbody>{reports.length === 0 ? <tr><td className="px-2 py-3 text-xs text-[#5a7383]" colSpan={3}>Sem relatorios.</td></tr> : reports.map((report) => <tr key={report.id} className="border-b"><td className="px-2 py-2">{report.report_title}</td><td className="px-2 py-2">{report.status}</td><td className="px-2 py-2">{fmt(report.created_at)}</td></tr>)}</tbody></table></div>
          </section>
        </>
      ) : null}

      {isLinksModalOpen && linksPayload ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          onClick={closeLinksModal}
        >
          <div
            className="w-full max-w-5xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-lg font-semibold text-[#123447]">
                Links do questionario: {linksPayload.campaign.name}
              </h4>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyAllLinks()}
                  className="rounded-full border border-[#b9d8a5] px-3 py-1 text-xs font-semibold text-[#2d5f23]"
                >
                  Copiar todos
                </button>
                <button
                  type="button"
                  onClick={exportLinksCsv}
                  className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                >
                  Exportar CSV
                </button>
                <button
                  type="button"
                  onClick={closeLinksModal}
                  className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447]"
                >
                  Fechar
                </button>
              </div>
            </div>
            <div className="mt-4 max-h-[65vh] overflow-auto">
              <table className="nr-table min-w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left">Setor</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-left">Respostas</th>
                    <th className="px-2 py-2 text-left">Ultimo envio</th>
                    <th className="px-2 py-2 text-left">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {linksPayload.sectors.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-2 py-3 text-xs text-[#5a7383]">
                        Nenhum setor configurado para este diagnostico.
                      </td>
                    </tr>
                  ) : (
                    linksPayload.sectors.map((sector) => (
                      <tr key={sector.id} className="border-b">
                        <td className="px-2 py-2">{sector.name}</td>
                        <td className="px-2 py-2">{sector.isActive ? "Ativo" : "Inativo"}</td>
                        <td className="px-2 py-2">{sector.submissionCount}</td>
                        <td className="px-2 py-2">{fmt(sector.lastSubmittedAt)}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <input
                              readOnly
                              value={sector.isActive ? sector.accessLink : "Setor inativo (link bloqueado)"}
                              className="w-full min-w-[280px] rounded border border-[#d5e2ea] bg-[#f7fbfe] px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              disabled={!sector.isActive}
                              onClick={() => void copySectorLink(sector)}
                              className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73] disabled:cursor-not-allowed disabled:border-[#d6dde2] disabled:text-[#95a4ae]"
                            >
                              {!sector.isActive ? "Inativo" : copiedSectorId === sector.id ? "Copiado" : "Copiar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {isSectorModalOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4"
          onClick={() => setIsSectorModalOpen(false)}
        >
          <div
            className="w-full max-w-4xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-lg font-semibold text-[#123447]">
                {sectorModalMode === "add" ? "Adicionar setor" : "Editar setor"}
              </h4>
              <button
                type="button"
                onClick={() => setIsSectorModalOpen(false)}
                className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447]"
              >
                Fechar
              </button>
            </div>
            <div className="mt-4 max-h-[65vh] overflow-y-auto pr-1">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-xs text-[#4f6977] md:col-span-2">
                  Setor
                  <input
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sectorModalForm.name}
                    onChange={(event) => updateSectorModalForm({ name: event.target.value })}
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Contact name
                  <input
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sectorModalForm.mainContactName}
                    onChange={(event) => updateSectorModalForm({ mainContactName: event.target.value })}
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Status
                  <select
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sectorModalForm.isActive ? "active" : "inactive"}
                    onChange={(event) => updateSectorModalForm({ isActive: event.target.value === "active" })}
                  >
                    <option value="active">Ativo</option>
                    <option value="inactive">Inativo</option>
                  </select>
                </label>
                <label className="text-xs text-[#4f6977]">
                  Risk parameter
                  <input
                    type="number"
                    min={0.5}
                    max={2}
                    step={0.01}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sectorModalForm.riskParameter}
                    onChange={(event) => updateSectorModalForm({ riskParameter: event.target.value })}
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Shifts
                  <input
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sectorModalForm.shifts}
                    onChange={(event) => updateSectorModalForm({ shifts: event.target.value })}
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Remote workers in this sector
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sectorModalForm.remoteWorkers}
                    onChange={(event) =>
                      updateSectorModalForm({
                        remoteWorkers: toNonNegativeInt(event.target.value, sectorModalForm.remoteWorkers),
                      })
                    }
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  On-site workers in this sector
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sectorModalForm.onsiteWorkers}
                    onChange={(event) =>
                      updateSectorModalForm({
                        onsiteWorkers: toNonNegativeInt(event.target.value, sectorModalForm.onsiteWorkers),
                      })
                    }
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Hybrid workers in this sector
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sectorModalForm.hybridWorkers}
                    onChange={(event) =>
                      updateSectorModalForm({
                        hybridWorkers: toNonNegativeInt(event.target.value, sectorModalForm.hybridWorkers),
                      })
                    }
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Workers in role
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sectorModalForm.workersInRole}
                    onChange={(event) =>
                      updateSectorModalForm({
                        workersInRole: toNonNegativeInt(event.target.value, sectorModalForm.workersInRole),
                      })
                    }
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Assessment date
                  <input
                    type="date"
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sectorModalForm.elaborationDate}
                    onChange={(event) => updateSectorModalForm({ elaborationDate: event.target.value })}
                  />
                  <span className="mt-1 block text-[11px] leading-4 text-[#5a7383]">
                    Date this sector assessment was prepared.
                  </span>
                </label>
                <label className="text-xs text-[#4f6977] md:col-span-2">
                  Contact email
                  <input
                    type="email"
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sectorModalForm.mainContactEmail}
                    onChange={(event) => updateSectorModalForm({ mainContactEmail: event.target.value })}
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Contact phone
                  <input
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sectorModalForm.mainContactPhone}
                    onChange={(event) => updateSectorModalForm({ mainContactPhone: event.target.value })}
                  />
                </label>
                <label className="text-xs text-[#4f6977] md:col-span-3">
                  Roles / functions
                  <input
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sectorModalForm.functions}
                    onChange={(event) => updateSectorModalForm({ functions: event.target.value })}
                  />
                </label>
                <label className="text-xs text-[#4f6977] md:col-span-3">
                  Vulnerable groups
                  <textarea
                    className="mt-1 min-h-20 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sectorModalForm.vulnerableGroups}
                    onChange={(event) => updateSectorModalForm({ vulnerableGroups: event.target.value })}
                  />
                </label>
                <label className="text-xs text-[#4f6977] md:col-span-3">
                  Stress, harassment, overload and other harms
                  <textarea
                    className="mt-1 min-h-20 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sectorModalForm.possibleMentalHealthHarms}
                    onChange={(event) =>
                      updateSectorModalForm({ possibleMentalHealthHarms: event.target.value })
                    }
                  />
                </label>
                <label className="text-xs text-[#4f6977] md:col-span-3">
                  Existing control measures
                  <textarea
                    className="mt-1 min-h-20 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sectorModalForm.existingControlMeasures}
                    onChange={(event) =>
                      updateSectorModalForm({ existingControlMeasures: event.target.value })
                    }
                  />
                </label>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={saveSectorModal}
                className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white"
              >
                {sectorModalMode === "add" ? "Adicionar setor" : "Salvar setor"}
              </button>
              <button
                type="button"
                onClick={() => setIsSectorModalOpen(false)}
                className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "assigned-continuous" ? (
        <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-[#123447]">Assigned processo continuos</h3>
            <button
              type="button"
              onClick={openAssignProgramModal}
              disabled={isSavingProgram || unassignedProgramOptions.length === 0}
              className="rounded-full bg-[#0f5b73] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Atribuir processo continuo
            </button>
          </div>
          {continuousError ? <p className="mt-3 text-sm text-red-600">{continuousError}</p> : null}
          {continuousNotice ? <p className="mt-3 text-sm text-[#1f6b3d]">{continuousNotice}</p> : null}
          <div className="mt-3 rounded-xl border border-[#d8e4ee] bg-[#f8fbfd]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8e4ee] px-3 py-2">
              <div>
                <p className="text-sm font-semibold text-[#123447]">Plano anual de implementacao</p>
                <p className="text-xs text-[#5a7383]">
                  Selecione os meses e salve para gerar os eventos provisorios no calendario.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-[#55707f]">
                  {annualPlanPendingCount > 0
                    ? `${annualPlanPendingCount} atribuicao(oes) com alteracoes.`
                    : "Sem alteracoes pendentes."}
                </span>
                <button
                  type="button"
                  onClick={() => void saveAnnualPlan()}
                  disabled={isSavingAnnualPlan || isSavingProgram || annualPlanPendingCount === 0}
                  className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {isSavingAnnualPlan ? "Salvando..." : "Salvar cronograma"}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="nr-table min-w-[1050px] text-xs">
                <thead>
                  <tr className="border-b border-[#d8e4ee] bg-white">
                    <th className="px-2 py-2 text-left font-semibold text-[#244354]">
                      Acao de prevencao e controle
                    </th>
                    {annualPlanColumns.map((column) => (
                      <th
                        key={`annual-col-${column.key}`}
                        className="px-1 py-2 text-center font-semibold text-[#244354]"
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {assignedPrograms.length === 0 ? (
                    <tr>
                      <td
                        colSpan={annualPlanColumns.length + 1}
                        className="px-2 py-3 text-xs text-[#5a7383]"
                      >
                        Nenhum processo continuo atribuido.
                      </td>
                    </tr>
                  ) : (
                    assignedPrograms.map((assignment) => {
                      const baseMonths =
                        annualPlanBaseByAssignment[assignment.id] ?? extractAnnualPlanMonths(assignment);
                      const selectedMonths = new Set(
                        annualPlanDraftByAssignment[assignment.id] ?? baseMonths,
                      );
                      const isDirty = !sameMonthsSelection(baseMonths, Array.from(selectedMonths.values()));
                      return (
                        <tr key={`annual-plan-${assignment.id}`} className="border-b border-[#dbe7ef]">
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/manager/clients/${client.id}/assigned-continuous/${assignment.id}`}
                                className="font-medium text-[#0f5b73] hover:underline"
                              >
                                {assignment.programTitle}
                              </Link>
                              <button
                                type="button"
                                onClick={() => void removeAssignedProgram(assignment.id)}
                                disabled={isSavingProgram}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#e1b6b6] text-[#8a2d2d] hover:bg-[#fff4f4] disabled:cursor-not-allowed disabled:opacity-50"
                                title="Remover programa"
                                aria-label={`Remover ${assignment.programTitle}`}
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
                                  <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM7 9h2v9H7V9Zm-1 12h12l1-14H5l1 14Z" />
                                </svg>
                              </button>
                            </div>
                            <p className="text-[11px] text-[#5a7383]">
                              Status {assignment.status}
                              {isDirty ? " | alteracao pendente" : ""}
                            </p>
                          </td>
                          {annualPlanColumns.map((column) => {
                            const isSelected = selectedMonths.has(column.key);
                            const isDisabled =
                              assignment.status !== "Active" || isSavingAnnualPlan || isSavingProgram;
                            return (
                              <td key={`${assignment.id}-${column.key}`} className="px-1 py-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => toggleAnnualPlanMonthDraft(assignment, column.key)}
                                  disabled={isDisabled}
                                  className={`h-7 w-9 rounded border text-[10px] font-semibold transition ${
                                    isSelected
                                      ? "border-[#87b493] bg-[#d9f0df] text-[#1f5f2c]"
                                      : "border-[#c5d8e4] bg-white text-[#4f6977]"
                                  } disabled:cursor-not-allowed disabled:opacity-50`}
                                  title={
                                    assignment.status !== "Active"
                                      ? "Disponivel apenas para programas ativos."
                                      : isSelected
                                        ? "Remover mes do plano anual."
                                        : "Adicionar mes ao plano anual."
                                  }
                                >
                                  {isSelected ? "OK" : "-"}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {isProgramModalOpen ? (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
              <div className="w-full max-w-2xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-lg font-semibold text-[#123447]">Atribuir processo continuo</h4>
                  <button
                    type="button"
                    onClick={() => setIsProgramModalOpen(false)}
                    className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                  >
                    Fechar
                  </button>
                </div>
                {unassignedProgramOptions.length === 0 ? (
                  <p className="mt-3 text-sm text-[#5a7383]">Todos os programas ja foram atribuidos para esta empresa.</p>
                ) : (
                  <>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <fieldset className="text-xs text-[#4f6977] md:col-span-2">
                        <legend className="font-medium text-[#35515f]">Programas</legend>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setAssignProgramForm((previous) => ({
                                ...previous,
                                programIds: unassignedProgramOptions.map((program) => program.id),
                              }))
                            }
                            className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                          >
                            Selecionar todos
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setAssignProgramForm((previous) => ({
                                ...previous,
                                programIds: [],
                              }))
                            }
                            className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#4f6977]"
                          >
                            Limpar
                          </button>
                        </div>
                        <div className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded border border-[#d8e4ee] p-2">
                          {unassignedProgramOptions.map((program) => {
                            const isChecked = assignProgramForm.programIds.includes(program.id);
                            return (
                              <label
                                key={`assign-multi-${program.id}`}
                                className="flex cursor-pointer items-start gap-2 rounded border border-[#edf4f8] px-2 py-2"
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(event) =>
                                    setAssignProgramForm((previous) => {
                                      const nextIds = new Set(previous.programIds);
                                      if (event.target.checked) {
                                        nextIds.add(program.id);
                                      } else {
                                        nextIds.delete(program.id);
                                      }
                                      return {
                                        ...previous,
                                        programIds: Array.from(nextIds.values()),
                                      };
                                    })
                                  }
                                  className="mt-0.5 h-4 w-4 rounded border-[#9ec8db] text-[#0f5b73]"
                                />
                                <span>
                                  <span className="block text-sm font-semibold text-[#123447]">{program.title}</span>
                                  <span className="block text-xs text-[#5a7383]">
                                    Topico {program.targetRiskTopic} | Gatilho{" "}
                                    {program.triggerThreshold.toFixed(2)}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                      <label className="text-xs text-[#4f6977]">
                        Status
                        <select
                          className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                          value={assignProgramForm.status}
                          onChange={(event) =>
                            setAssignProgramForm((previous) => ({
                              ...previous,
                              status: event.target.value as ContinuousProgramStatus,
                            }))
                          }
                        >
                          <option value="Recommended">Recommended</option>
                          <option value="Active">Active</option>
                          <option value="Completed">Completed</option>
                        </select>
                      </label>
                      <label className="text-xs text-[#4f6977]">
                        Recorrencia para este cliente
                        <select
                          className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                          value={assignProgramForm.scheduleFrequency}
                          onChange={(event) =>
                            setAssignProgramForm((previous) => ({
                              ...previous,
                              scheduleFrequency: event.target.value,
                            }))
                          }
                        >
                          <option value="weekly">weekly</option>
                          <option value="biweekly">biweekly</option>
                          <option value="monthly">monthly</option>
                          <option value="quarterly">quarterly</option>
                          <option value="semiannual">semiannual</option>
                          <option value="annual">annual</option>
                          <option value="custom">custom</option>
                        </select>
                      </label>
                      <label className="text-xs text-[#4f6977] md:col-span-2">
                        Data de aplicacao
                        <input
                          type="datetime-local"
                          className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                          value={assignProgramForm.deployedAt}
                          onChange={(event) =>
                            setAssignProgramForm((previous) => ({
                              ...previous,
                              deployedAt: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                    {selectedProgramsToAssign.length > 0 ? (
                      <div className="mt-3 rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
                        <p className="text-sm font-semibold text-[#123447]">
                          {selectedProgramsToAssign.length} programa(s) selecionado(s)
                        </p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[#4f6977]">
                          {selectedProgramsToAssign.map((program) => (
                            <li key={`selected-program-${program.id}`}>
                              {program.title} | Topico {program.targetRiskTopic}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        disabled={isSavingProgram || assignProgramForm.programIds.length === 0}
                        onClick={() => void assignContinuousProgram()}
                        className="rounded-full bg-[#0f5b73] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        Aplicar programa
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsProgramModalOpen(false)}
                        className="rounded-full border border-[#9ec8db] px-4 py-2 text-sm font-semibold text-[#0f5b73]"
                      >
                        Cancelar
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === "history" ? <ManagerHistory forcedClientId={client.id} /> : null}

      {activeTab === "contracts-invoicing" ? (
        <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[#123447]">contracts & invoicing</h3>
          <p className="mt-2 text-sm">Financeiro: {client.billingStatus}</p>
          <p className="mt-1 text-sm">Contrato: {fmtDate(client.contractStartDate)} - {fmtDate(client.contractEndDate)}</p>
          <p className="mt-1 text-sm">Ultima atualizacao: {fmt(client.updatedAt)}</p>
        </section>
      ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
