"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  name: string;
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

function csvEscape(value: string | number | null): string {
  if (value === null) return "";
  return `"${String(value).replace(/"/g, '""')}"`;
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
  const [accessInviteCopied, setAccessInviteCopied] = useState(false);
  const [isLoadingLinksFor, setIsLoadingLinksFor] = useState<string | null>(null);
  const [openAssignedProgramActionsFor, setOpenAssignedProgramActionsFor] = useState<string | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<ClientTab>(initialTab);
  const [isEditingCompanyProfile, setIsEditingCompanyProfile] = useState(false);
  const [isSavingCompanyProfile, setIsSavingCompanyProfile] = useState(false);
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
    programId: string;
    status: ContinuousProgramStatus;
    deployedAt: string;
    scheduleFrequency: string;
  }>({
    programId: "",
    status: "Active",
    deployedAt: "",
    scheduleFrequency: "biweekly",
  });

  const selectedCampaign = useMemo(
    () => client?.campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null,
    [client, selectedCampaignId],
  );
  const openCampaigns = useMemo(
    () => client?.campaigns.filter((campaign) => campaign.status === "live") ?? [],
    [client],
  );
  const resultsCampaign = useMemo(() => {
    if (!client) return null;
    if (selectedCampaign && (selectedCampaign.status === "live" || selectedCampaign.status === "closed")) {
      return selectedCampaign;
    }
    return (
      client.campaigns.find((campaign) => campaign.status === "live") ??
      client.campaigns.find((campaign) => campaign.status === "closed") ??
      null
    );
  }, [client, selectedCampaign]);
  const linksActionCampaign =
    selectedCampaign?.status === "live" ? selectedCampaign : openCampaigns[0] ?? null;

  const assignedProgramIds = useMemo(
    () => new Set(assignedPrograms.map((assignment) => assignment.programId)),
    [assignedPrograms],
  );
  const unassignedProgramOptions = useMemo(
    () => availablePrograms.filter((program) => !assignedProgramIds.has(program.id)),
    [availablePrograms, assignedProgramIds],
  );
  const selectedProgramToAssign = useMemo(
    () =>
      unassignedProgramOptions.find((program) => program.id === assignProgramForm.programId) ?? null,
    [unassignedProgramOptions, assignProgramForm.programId],
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
      const nextProgramId =
        previous.programId &&
        nextAvailable.some(
          (program) => program.id === previous.programId && !nextAssignedIds.has(previous.programId),
        )
          ? previous.programId
          : nextAvailable.find((program) => !nextAssignedIds.has(program.id))?.id ?? "";
      return {
        ...previous,
        programId: nextProgramId,
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
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "assigned-continuous") return;
    setOpenAssignedProgramActionsFor(null);
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

  async function loadQuestionnaireLinks(campaign: Diagnostic) {
    setIsLoadingLinksFor(campaign.id);
    setLinksPayload(null);
    setIsLinksModalOpen(false);
    try {
      const response = await fetch(`/api/admin/campaigns/${campaign.id}/sectors`, { cache: "no-store" });
      if (!response.ok) {
        setError("Falha ao carregar links.");
        return;
      }
      setLinksPayload((await response.json()) as SectorPayload);
      setCopiedSectorId(null);
      setIsLinksModalOpen(true);
    } catch {
      setError("Falha ao carregar links.");
    } finally {
      setIsLoadingLinksFor(null);
    }
  }

  async function copySectorLink(sector: SectorLink) {
    if (!sector.isActive) {
      return;
    }
    await navigator.clipboard.writeText(sector.accessLink);
    setCopiedSectorId(sector.id);
    window.setTimeout(() => setCopiedSectorId(null), 1200);
  }

  async function copyAllLinks() {
    if (!linksPayload) return;
    const lines = linksPayload.sectors.filter((sector) => sector.isActive).map((sector) => `${sector.name}: ${sector.accessLink}`);
    if (lines.length === 0) {
      setError("Nenhum setor ativo para copiar.");
      return;
    }
    await navigator.clipboard.writeText(lines.join("\n"));
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

  function addSectorForm() {
    setSectorForms((previous) => [...previous, createSectorProfileForm()]);
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

    const totalEmployees = toNonNegativeInt(companyForm.totalEmployees, client.totalEmployees);
    if (totalEmployees < 1) {
      setError("Total de colaboradores precisa ser maior que zero.");
      return;
    }

    setIsSavingCompanyProfile(true);
    setError("");

    const payload = {
      companyName: companyForm.companyName.trim(),
      cnpj: companyForm.cnpj.trim(),
      status: companyForm.status,
      billingStatus: companyForm.billingStatus,
      totalEmployees,
      remoteEmployees: toNonNegativeInt(companyForm.remoteEmployees, client.remoteEmployees),
      onsiteEmployees: toNonNegativeInt(companyForm.onsiteEmployees, client.onsiteEmployees),
      hybridEmployees: toNonNegativeInt(companyForm.hybridEmployees, client.hybridEmployees),
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
    if (!client) return;
    router.push(`/manager/clients/${client.id}/diagnostic/${campaign.id}`);
  }

  function openAssignedProgramDetails(assignment: AssignedContinuousProgram) {
    if (!client) return;
    router.push(`/manager/clients/${client.id}/assigned-continuous/${assignment.id}`);
  }

  function closeLinksModal() {
    setIsLinksModalOpen(false);
    setCopiedSectorId(null);
  }

  function openAssignProgramModal() {
    const firstAvailableProgram = unassignedProgramOptions[0] ?? null;
    setAssignProgramForm({
      programId: firstAvailableProgram?.id ?? "",
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
    if (!assignProgramForm.programId) {
      setContinuousError("Selecione um programa para atribuir.");
      return;
    }

    setIsSavingProgram(true);
    setContinuousError("");
    setContinuousNotice("");
    const deployedAtIso = fromDatetimeLocal(assignProgramForm.deployedAt);
    const response = await fetch(`/api/admin/clients/${client.id}/programs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        programId: assignProgramForm.programId,
        status: assignProgramForm.status,
        ...(deployedAtIso ? { deployedAt: deployedAtIso } : {}),
        scheduleFrequency: assignProgramForm.scheduleFrequency,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setContinuousError(data.error ?? "Falha ao atribuir programa.");
      setIsSavingProgram(false);
      return;
    }

    setIsProgramModalOpen(false);
    await loadContinuousPrograms(client.id);
    setContinuousNotice("Programa atribuido com sucesso.");
    setIsSavingProgram(false);
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
                    min={1}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyForm.totalEmployees}
                    onChange={(event) =>
                      setCompanyForm((previous) => ({ ...previous, totalEmployees: event.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Remote employees
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyForm.remoteEmployees}
                    onChange={(event) =>
                      setCompanyForm((previous) => ({ ...previous, remoteEmployees: event.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Onsite employees
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyForm.onsiteEmployees}
                    onChange={(event) =>
                      setCompanyForm((previous) => ({ ...previous, onsiteEmployees: event.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-[#4f6977]">
                  Hybrid employees
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={companyForm.hybridEmployees}
                    onChange={(event) =>
                      setCompanyForm((previous) => ({ ...previous, hybridEmployees: event.target.value }))
                    }
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
                    onClick={addSectorForm}
                    className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                  >
                    Add setor
                  </button>
                </div>
                <div className="mt-3 space-y-3">
                  {sectorForms.length === 0 ? (
                    <p className="text-xs text-[#5a7383]">Nenhum setor cadastrado.</p>
                  ) : (
                    sectorForms.map((sector) => (
                      <article key={sector.id} className="rounded-xl border border-[#d8e4ee] bg-white p-3">
                        <div className="grid gap-3 md:grid-cols-3">
                          <label className="text-xs text-[#4f6977] md:col-span-2">
                            Setor
                            <input
                              className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                              value={sector.name}
                              onChange={(event) => updateSectorForm(sector.id, { name: event.target.value })}
                            />
                          </label>
                          <label className="text-xs text-[#4f6977]">
                            Contact name
                            <input
                              className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                              value={sector.mainContactName}
                              onChange={(event) =>
                                updateSectorForm(sector.id, { mainContactName: event.target.value })
                              }
                            />
                          </label>
                          <label className="text-xs text-[#4f6977]">
                            Status
                            <select
                              className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                              value={sector.isActive ? "active" : "inactive"}
                              onChange={(event) =>
                                updateSectorForm(sector.id, { isActive: event.target.value === "active" })
                              }
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
                              value={sector.riskParameter}
                              onChange={(event) =>
                                updateSectorForm(sector.id, { riskParameter: event.target.value })
                              }
                            />
                          </label>
                          <label className="text-xs text-[#4f6977]">
                            Shifts
                            <input
                              className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                              value={sector.shifts}
                              onChange={(event) => updateSectorForm(sector.id, { shifts: event.target.value })}
                            />
                          </label>
                          <label className="text-xs text-[#4f6977]">
                            Remote workers in this sector
                            <input
                              type="number"
                              min={0}
                              className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                              value={sector.remoteWorkers}
                              onChange={(event) =>
                                updateSectorForm(sector.id, {
                                  remoteWorkers: toNonNegativeInt(event.target.value, sector.remoteWorkers),
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
                              value={sector.onsiteWorkers}
                              onChange={(event) =>
                                updateSectorForm(sector.id, {
                                  onsiteWorkers: toNonNegativeInt(event.target.value, sector.onsiteWorkers),
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
                              value={sector.hybridWorkers}
                              onChange={(event) =>
                                updateSectorForm(sector.id, {
                                  hybridWorkers: toNonNegativeInt(event.target.value, sector.hybridWorkers),
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
                              value={sector.workersInRole}
                              onChange={(event) =>
                                updateSectorForm(sector.id, {
                                  workersInRole: toNonNegativeInt(event.target.value, sector.workersInRole),
                                })
                              }
                            />
                          </label>
                          <label className="text-xs text-[#4f6977]">
                            Assessment date
                            <input
                              type="date"
                              className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                              value={sector.elaborationDate}
                              onChange={(event) =>
                                updateSectorForm(sector.id, { elaborationDate: event.target.value })
                              }
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
                              value={sector.mainContactEmail}
                              onChange={(event) =>
                                updateSectorForm(sector.id, { mainContactEmail: event.target.value })
                              }
                            />
                          </label>
                          <label className="text-xs text-[#4f6977]">
                            Contact phone
                            <input
                              className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                              value={sector.mainContactPhone}
                              onChange={(event) =>
                                updateSectorForm(sector.id, { mainContactPhone: event.target.value })
                              }
                            />
                          </label>
                          <div className="flex items-end justify-end">
                            <button
                              type="button"
                              onClick={() => removeSectorForm(sector.id)}
                              className="rounded-full border border-[#e9c0c0] px-3 py-1 text-xs font-semibold text-[#8f2a2a]"
                            >
                              Delete
                            </button>
                          </div>
                          <label className="text-xs text-[#4f6977] md:col-span-3">
                            Roles / functions
                            <input
                              className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                              value={sector.functions}
                              onChange={(event) => updateSectorForm(sector.id, { functions: event.target.value })}
                            />
                          </label>
                          <label className="text-xs text-[#4f6977] md:col-span-3">
                            Vulnerable groups
                            <textarea
                              className="mt-1 min-h-20 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                              value={sector.vulnerableGroups}
                              onChange={(event) =>
                                updateSectorForm(sector.id, { vulnerableGroups: event.target.value })
                              }
                            />
                          </label>
                          <label className="text-xs text-[#4f6977] md:col-span-3">
                            Stress, harassment, overload and other harms
                            <textarea
                              className="mt-1 min-h-20 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                              value={sector.possibleMentalHealthHarms}
                              onChange={(event) =>
                                updateSectorForm(sector.id, {
                                  possibleMentalHealthHarms: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label className="text-xs text-[#4f6977] md:col-span-3">
                            Existing control measures
                            <textarea
                              className="mt-1 min-h-20 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                              value={sector.existingControlMeasures}
                              onChange={(event) =>
                                updateSectorForm(sector.id, {
                                  existingControlMeasures: event.target.value,
                                })
                              }
                            />
                          </label>
                        </div>
                      </article>
                    ))
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
                <table className="min-w-full text-sm">
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
          <section className="h-auto max-h-none overflow-visible rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
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
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left">Diagnostico</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-left">Inicio</th>
                    <th className="px-2 py-2 text-left">Fechamento</th>
                    <th className="px-2 py-2 text-left">Respostas</th>
                  </tr>
                </thead>
                <tbody>
                  {client.campaigns.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-2 py-3 text-xs text-[#5a7383]">
                        Nenhum diagnostico atribuido.
                      </td>
                    </tr>
                  ) : (
                    client.campaigns.map((campaign) => (
                      <tr key={campaign.id} className="border-b">
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
                        <td className="px-2 py-2">{campaign.responses ?? "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-[#123447]">Relatorios gerados</h3>
            <div className="mt-3 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b"><th className="px-2 py-2 text-left">Titulo</th><th className="px-2 py-2 text-left">Status</th><th className="px-2 py-2 text-left">Criado</th></tr></thead><tbody>{reports.length === 0 ? <tr><td className="px-2 py-3 text-xs text-[#5a7383]" colSpan={3}>Sem relatorios.</td></tr> : reports.map((report) => <tr key={report.id} className="border-b"><td className="px-2 py-2">{report.report_title}</td><td className="px-2 py-2">{report.status}</td><td className="px-2 py-2">{fmt(report.created_at)}</td></tr>)}</tbody></table></div>
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
              <table className="min-w-full text-sm">
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
              <table className="min-w-[1050px] text-xs">
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
                            <Link
                              href={`/manager/clients/${client.id}/assigned-continuous/${assignment.id}`}
                              className="font-medium text-[#0f5b73] hover:underline"
                            >
                              {assignment.programTitle}
                            </Link>
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
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-2 text-left">Programa</th>
                  <th className="px-2 py-2 text-left">Topico alvo</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-left">Aplicado em</th>
                  <th className="px-2 py-2 text-left">Cadencia</th>
                  <th className="px-2 py-2 text-left">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {assignedPrograms.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-3 text-xs text-[#5a7383]">
                      Nenhum processo continuo atribuido.
                    </td>
                  </tr>
                ) : (
                  assignedPrograms.map((assignment) => (
                    <tr key={assignment.id} className="border-b">
                        <td className="px-2 py-2">
                          <p className="font-medium text-[#123447]">{assignment.programTitle}</p>
                          <p className="text-xs text-[#5a7383]">{assignment.programDescription ?? assignment.programId}</p>
                        </td>
                        <td className="px-2 py-2">{assignment.targetRiskTopic ?? "-"}</td>
                        <td className="px-2 py-2">{assignment.status}</td>
                        <td className="px-2 py-2">{fmt(assignment.deployedAt)}</td>
                        <td className="px-2 py-2">{assignment.scheduleFrequency ?? "-"}</td>
                        <td className="px-2 py-2">
                          <div className="relative inline-flex">
                            <button
                              type="button"
                              onClick={() =>
                                setOpenAssignedProgramActionsFor((previous) =>
                                  previous === assignment.id ? null : assignment.id,
                                )
                              }
                              className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447]"
                            >
                              ...
                            </button>
                            {openAssignedProgramActionsFor === assignment.id ? (
                              <div className="absolute right-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-xl border border-[#d8e4ee] bg-white shadow-lg">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenAssignedProgramActionsFor(null);
                                    openAssignedProgramDetails(assignment);
                                  }}
                                  className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#123447] hover:bg-[#f4f9fc]"
                                >
                                  Open
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenAssignedProgramActionsFor(null);
                                    openAssignedProgramDetails(assignment);
                                  }}
                                  className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#2d5f23] hover:bg-[#f4f9fc]"
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenAssignedProgramActionsFor(null);
                                    void removeAssignedProgram(assignment.id);
                                  }}
                                  disabled={isSavingProgram}
                                  className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#8a2d2d] hover:bg-[#fff4f4] disabled:cursor-not-allowed disabled:text-[#a8b7c0]"
                                >
                                  Remover
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                  ))
                )}
              </tbody>
            </table>
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
                      <label className="text-xs text-[#4f6977]">
                        Programa
                        <select
                          className="mt-1 w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                          value={assignProgramForm.programId}
                          onChange={(event) =>
                            setAssignProgramForm((previous) => {
                              return {
                                ...previous,
                                programId: event.target.value,
                                scheduleFrequency: "biweekly",
                              };
                            })
                          }
                        >
                          {unassignedProgramOptions.map((program) => (
                            <option key={program.id} value={program.id}>
                              {program.title}
                            </option>
                          ))}
                        </select>
                      </label>
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
                    {selectedProgramToAssign ? (
                      <div className="mt-3 rounded-xl border border-[#d8e4ee] bg-[#f8fbfd] p-3">
                        <p className="text-sm font-semibold text-[#123447]">{selectedProgramToAssign.title}</p>
                        <p className="mt-1 text-xs text-[#4f6977]">
                          Topico alvo {selectedProgramToAssign.targetRiskTopic} | Gatilho{" "}
                          {selectedProgramToAssign.triggerThreshold.toFixed(2)}
                        </p>
                        <p className="mt-1 text-xs text-[#4f6977]">
                          Recorrencia padrao: {selectedProgramToAssign.scheduleFrequency}
                        </p>
                        <p className="mt-1 text-xs text-[#5a7383]">{selectedProgramToAssign.description ?? "-"}</p>
                      </div>
                    ) : null}
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        disabled={isSavingProgram || !assignProgramForm.programId}
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
