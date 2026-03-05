"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useManagerLocale } from "@/components/manager-locale";

type ClientStatus = "Active" | "Pending" | "Inactive";
type BillingStatus = "up_to_date" | "pending" | "overdue" | "blocked";

type SectorDraft = {
  id: string;
  name: string;
  remoteWorkers: string;
  onsiteWorkers: string;
  hybridWorkers: string;
  workersInRole: string;
  shifts: string;
  vulnerableGroups: string;
  functions: string;
  possibleMentalHealthHarms: string;
  existingControlMeasures: string;
  elaborationDate: string;
  riskParameter: string;
};

type CreateResponse = {
  client?: {
    id: string;
    access?: {
      invitationLink?: string | null;
      invitationExpiresAt?: string | null;
      invitationStatus?: string | null;
    };
  };
  warning?: string;
  error?: string;
  details?: string;
};

const COPY = {
  en: {
    breadcrumbManager: "Manager",
    breadcrumbClients: "Clients",
    breadcrumbNew: "New client",
    title: "Create client account",
    subtitle: "Register company profile, sectors, and organizational risk context.",
    companySection: "Company data",
    companyName: "Company name",
    cnpj: "CNPJ",
    totalEmployees: "Total employees",
    remoteEmployees: "Remote employees",
    onsiteEmployees: "Onsite employees",
    hybridEmployees: "Hybrid employees",
    status: "Status",
    billingStatus: "Billing",
    statusActive: "Active",
    statusPending: "Pending",
    statusInactive: "Inactive",
    billingUpToDate: "Up to date",
    billingPending: "Pending",
    billingOverdue: "Overdue",
    billingBlocked: "Blocked",
    indicatorsSection: "Organizational indicators",
    absenteeismRate: "Absenteeism rate (%)",
    turnoverRate: "Turnover rate (%)",
    mentalHealthLeaveCases: "Mental health leave cases",
    climateReports: "Organizational climate reports",
    sectorsSection: "Sector mapping",
    addSector: "Add sector",
    removeSector: "Remove",
    sectorName: "Sector name",
    shifts: "Shifts",
    remoteWorkersInSector: "Remote workers in this sector",
    onsiteWorkersInSector: "On-site workers in this sector",
    hybridWorkersInSector: "Hybrid workers in this sector",
    vulnerableGroups: "Vulnerable groups",
    functions: "Roles / functions",
    workersInRole: "Workers in role",
    harms: "Stress, harassment, overload and other harms",
    controls: "Existing control measures",
    elaborationDate: "Assessment date",
    elaborationDateHelp: "Date this sector assessment was prepared.",
    riskParameter: "Risk parameter (0.5 to 2)",
    submit: "Create account",
    submitting: "Creating...",
    back: "Back",
    invitationModalTitle: "Invitation link generated",
    invitationModalBody:
      "Send this link to the client contact. They will create their own credentials in onboarding.",
    invitationLinkLabel: "Onboarding invitation link",
    invitationExpiresLabel: "Expires",
    invitationCopy: "Copy link",
    invitationCopied: "Copied",
    invitationOpenProfile: "Open company profile",
    invitationBackToClients: "Back to clients",
    invitationClose: "Close",
    required: "Company name, CNPJ, and total employees are required.",
    atLeastOneSector: "Add at least one sector with a valid name.",
    createError: "Failed to create client account.",
  },
  pt: {
    breadcrumbManager: "Gestor",
    breadcrumbClients: "Clientes",
    breadcrumbNew: "Novo cliente",
    title: "Criar conta do cliente",
    subtitle: "Cadastre perfil da empresa, setores e contexto de risco organizacional.",
    companySection: "Dados da empresa",
    companyName: "Nome da empresa",
    cnpj: "CNPJ",
    totalEmployees: "Total de funcionarios",
    remoteEmployees: "Funcionarios remotos",
    onsiteEmployees: "Funcionarios presenciais",
    hybridEmployees: "Funcionarios hibridos",
    status: "Status",
    billingStatus: "Financeiro",
    statusActive: "Ativo",
    statusPending: "Pendente",
    statusInactive: "Inativo",
    billingUpToDate: "Em dia",
    billingPending: "Pendente",
    billingOverdue: "Em atraso",
    billingBlocked: "Bloqueado",
    indicatorsSection: "Indicadores organizacionais",
    absenteeismRate: "Taxa de absenteismo (%)",
    turnoverRate: "Taxa de rotatividade (%)",
    mentalHealthLeaveCases: "Afastamentos por transtornos mentais",
    climateReports: "Relatos de clima organizacional",
    sectorsSection: "Mapeamento de setores",
    addSector: "Adicionar setor",
    removeSector: "Remover",
    sectorName: "Nome do setor",
    shifts: "Turnos",
    remoteWorkersInSector: "Funcionarios remotos no setor",
    onsiteWorkersInSector: "Funcionarios presenciais no setor",
    hybridWorkersInSector: "Funcionarios hibridos no setor",
    vulnerableGroups: "Grupos vulneraveis",
    functions: "Funcoes / cargos",
    workersInRole: "N. funcionarios no setor",
    harms: "Estresse, assedio, sobrecarga e outros agravos",
    controls: "Medidas de controle existentes",
    elaborationDate: "Data de levantamento",
    elaborationDateHelp: "Data em que este levantamento do setor foi feito.",
    riskParameter: "Parametro de risco (0.5 a 2)",
    submit: "Criar conta",
    submitting: "Criando...",
    back: "Voltar",
    invitationModalTitle: "Link de convite gerado",
    invitationModalBody:
      "Envie este link para o contato do cliente. Eles criam as proprias credenciais no onboarding.",
    invitationLinkLabel: "Link de convite para onboarding",
    invitationExpiresLabel: "Expira em",
    invitationCopy: "Copiar link",
    invitationCopied: "Copiado",
    invitationOpenProfile: "Abrir perfil da empresa",
    invitationBackToClients: "Voltar aos clientes",
    invitationClose: "Fechar",
    required: "Nome da empresa, CNPJ e total de funcionarios sao obrigatorios.",
    atLeastOneSector: "Inclua pelo menos um setor com nome valido.",
    createError: "Falha ao criar conta do cliente.",
  },
} as const;

function createSectorDraft(): SectorDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: "",
    remoteWorkers: "",
    onsiteWorkers: "",
    hybridWorkers: "",
    workersInRole: "",
    shifts: "",
    vulnerableGroups: "",
    functions: "",
    possibleMentalHealthHarms: "",
    existingControlMeasures: "",
    elaborationDate: "",
    riskParameter: "1",
  };
}

function toInt(value: string, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function toOptionalInt(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return toInt(trimmed, 0);
}

function toOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

export function ManagerClientCreateForm() {
  const router = useRouter();
  const { locale } = useManagerLocale();
  const t = COPY[locale];

  const [companyName, setCompanyName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [totalEmployees, setTotalEmployees] = useState("50");
  const [remoteEmployees, setRemoteEmployees] = useState("10");
  const [onsiteEmployees, setOnsiteEmployees] = useState("35");
  const [hybridEmployees, setHybridEmployees] = useState("5");
  const [status, setStatus] = useState<ClientStatus>("Pending");
  const [billingStatus, setBillingStatus] = useState<BillingStatus>("pending");
  const [absenteeismRate, setAbsenteeismRate] = useState("");
  const [turnoverRate, setTurnoverRate] = useState("");
  const [mentalHealthLeaveCases, setMentalHealthLeaveCases] = useState("");
  const [organizationalClimateReports, setOrganizationalClimateReports] = useState("");
  const [sectors, setSectors] = useState<SectorDraft[]>([createSectorDraft()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdClientId, setCreatedClientId] = useState<string | null>(null);
  const [invitationLink, setInvitationLink] = useState<string | null>(null);
  const [invitationExpiresAt, setInvitationExpiresAt] = useState<string | null>(null);
  const [isInvitationModalOpen, setIsInvitationModalOpen] = useState(false);
  const [copiedInvitation, setCopiedInvitation] = useState(false);

  const validSectors = useMemo(() => sectors.filter((sector) => sector.name.trim().length >= 2), [sectors]);

  const invitationExpiresLabel = useMemo(() => {
    if (!invitationExpiresAt) return null;
    const parsed = new Date(invitationExpiresAt);
    if (Number.isNaN(parsed.getTime())) return invitationExpiresAt;
    return new Intl.DateTimeFormat(locale === "pt" ? "pt-BR" : "en-US", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(parsed);
  }, [invitationExpiresAt, locale]);

  function updateSector(id: string, patch: Partial<SectorDraft>) {
    setSectors((prev) => prev.map((sector) => (sector.id === id ? { ...sector, ...patch } : sector)));
  }

  function removeSector(id: string) {
    setSectors((prev) => {
      if (prev.length === 1) return prev;
      return prev.filter((sector) => sector.id !== id);
    });
  }

  async function copyInvitation() {
    if (!invitationLink) return;
    await navigator.clipboard.writeText(invitationLink);
    setCopiedInvitation(true);
    window.setTimeout(() => setCopiedInvitation(false), 1500);
  }

  async function submit() {
    if (companyName.trim().length < 2 || cnpj.trim().length < 8 || toInt(totalEmployees, 0) < 1) {
      setError(t.required);
      return;
    }
    if (validSectors.length === 0) {
      setError(t.atLeastOneSector);
      return;
    }

    setSubmitting(true);
    setError("");

    const payload = {
      companyName: companyName.trim(),
      cnpj: cnpj.trim(),
      totalEmployees: toInt(totalEmployees, 1),
      remoteEmployees: toInt(remoteEmployees, 0),
      onsiteEmployees: toInt(onsiteEmployees, 0),
      hybridEmployees: toInt(hybridEmployees, 0),
      status,
      billingStatus,
      absenteeismRate: toOptionalNumber(absenteeismRate),
      turnoverRate: toOptionalNumber(turnoverRate),
      mentalHealthLeaveCases: toOptionalInt(mentalHealthLeaveCases),
      organizationalClimateReports: organizationalClimateReports.trim() || undefined,
      sectors: validSectors.map((sector) => ({
        name: sector.name.trim(),
        remoteWorkers: toInt(sector.remoteWorkers, 0),
        onsiteWorkers: toInt(sector.onsiteWorkers, 0),
        hybridWorkers: toInt(sector.hybridWorkers, 0),
        workersInRole: toOptionalInt(sector.workersInRole),
        shifts: sector.shifts.trim() || undefined,
        vulnerableGroups: sector.vulnerableGroups.trim() || undefined,
        functions: sector.functions.trim() || undefined,
        possibleMentalHealthHarms: sector.possibleMentalHealthHarms.trim() || undefined,
        existingControlMeasures: sector.existingControlMeasures.trim() || undefined,
        elaborationDate: sector.elaborationDate.trim() || undefined,
        riskParameter: toOptionalNumber(sector.riskParameter),
      })),
    };

    try {
      const response = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => ({}))) as CreateResponse;
      if (!response.ok && response.status !== 207) {
        throw new Error(result.error || result.details || t.createError);
      }
      if (response.status === 207 && result.error) {
        const detailsText = result.details ? ` ${result.details}` : "";
        setError(`${result.error}${detailsText}`);
      }
      if (result.warning) {
        setError(result.warning);
      }
      const targetId = result.client?.id;
      if (targetId) {
        const generatedInvitation = result.client.access?.invitationLink ?? null;
        setCreatedClientId(targetId);
        setInvitationLink(generatedInvitation);
        setInvitationExpiresAt(result.client.access?.invitationExpiresAt ?? null);
        setCopiedInvitation(false);
        if (generatedInvitation) {
          setIsInvitationModalOpen(true);
          return;
        }
        router.push(`/manager/clients/${targetId}`);
        return;
      }
      router.push("/manager/clients");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t.createError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <nav className="text-xs text-[#4f6977]">
        <Link href="/manager/clients" className="text-[#0f5b73]">
          {t.breadcrumbManager}
        </Link>{" "}
        / <span>{t.breadcrumbClients}</span> / <span>{t.breadcrumbNew}</span>
      </nav>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-[#123447]">{t.title}</h2>
        <p className="mt-1 text-sm text-[#35515f]">{t.subtitle}</p>
      </section>

      <section className="space-y-4 rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">{t.companySection}</h3>
        <div className="grid gap-2 md:grid-cols-3">
          <input
            className="rounded border border-[#c9dce8] px-3 py-2 text-sm md:col-span-2"
            placeholder={t.companyName}
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
          />
          <input
            className="rounded border border-[#c9dce8] px-3 py-2 text-sm"
            placeholder={t.cnpj}
            value={cnpj}
            onChange={(event) => setCnpj(event.target.value)}
          />
          <input
            type="number"
            min={1}
            className="rounded border border-[#c9dce8] px-3 py-2 text-sm"
            placeholder={t.totalEmployees}
            value={totalEmployees}
            onChange={(event) => setTotalEmployees(event.target.value)}
          />
          <input
            type="number"
            min={0}
            className="rounded border border-[#c9dce8] px-3 py-2 text-sm"
            placeholder={t.remoteEmployees}
            value={remoteEmployees}
            onChange={(event) => setRemoteEmployees(event.target.value)}
          />
          <input
            type="number"
            min={0}
            className="rounded border border-[#c9dce8] px-3 py-2 text-sm"
            placeholder={t.onsiteEmployees}
            value={onsiteEmployees}
            onChange={(event) => setOnsiteEmployees(event.target.value)}
          />
          <input
            type="number"
            min={0}
            className="rounded border border-[#c9dce8] px-3 py-2 text-sm"
            placeholder={t.hybridEmployees}
            value={hybridEmployees}
            onChange={(event) => setHybridEmployees(event.target.value)}
          />
          <select
            className="rounded border border-[#c9dce8] px-3 py-2 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value as ClientStatus)}
          >
            <option value="Active">{t.statusActive}</option>
            <option value="Pending">{t.statusPending}</option>
            <option value="Inactive">{t.statusInactive}</option>
          </select>
          <select
            className="rounded border border-[#c9dce8] px-3 py-2 text-sm"
            value={billingStatus}
            onChange={(event) => setBillingStatus(event.target.value as BillingStatus)}
          >
            <option value="up_to_date">{t.billingUpToDate}</option>
            <option value="pending">{t.billingPending}</option>
            <option value="overdue">{t.billingOverdue}</option>
            <option value="blocked">{t.billingBlocked}</option>
          </select>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-[#123447]">{t.indicatorsSection}</h3>
        <div className="grid gap-2 md:grid-cols-3">
          <input
            type="number"
            min={0}
            step="0.1"
            className="rounded border border-[#c9dce8] px-3 py-2 text-sm"
            placeholder={t.absenteeismRate}
            value={absenteeismRate}
            onChange={(event) => setAbsenteeismRate(event.target.value)}
          />
          <input
            type="number"
            min={0}
            step="0.1"
            className="rounded border border-[#c9dce8] px-3 py-2 text-sm"
            placeholder={t.turnoverRate}
            value={turnoverRate}
            onChange={(event) => setTurnoverRate(event.target.value)}
          />
          <input
            type="number"
            min={0}
            className="rounded border border-[#c9dce8] px-3 py-2 text-sm"
            placeholder={t.mentalHealthLeaveCases}
            value={mentalHealthLeaveCases}
            onChange={(event) => setMentalHealthLeaveCases(event.target.value)}
          />
          <textarea
            className="min-h-24 rounded border border-[#c9dce8] px-3 py-2 text-sm md:col-span-3"
            placeholder={t.climateReports}
            value={organizationalClimateReports}
            onChange={(event) => setOrganizationalClimateReports(event.target.value)}
          />
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[#123447]">{t.sectorsSection}</h3>
          <button
            type="button"
            onClick={() => setSectors((prev) => [...prev, createSectorDraft()])}
            className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
          >
            {t.addSector}
          </button>
        </div>
        <div className="space-y-4">
          {sectors.map((sector, index) => (
            <article key={sector.id} className="rounded-xl border border-[#d7e6ee] p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-[#123447]">
                  {t.sectorName} #{index + 1}
                </p>
                <button
                  type="button"
                  onClick={() => removeSector(sector.id)}
                  className="rounded-full border border-[#e4c898] px-3 py-1 text-xs font-semibold text-[#7a4b00]"
                >
                  {t.removeSector}
                </button>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <input
                  className="rounded border border-[#c9dce8] px-3 py-2 text-sm md:col-span-2"
                  placeholder={t.sectorName}
                  value={sector.name}
                  onChange={(event) => updateSector(sector.id, { name: event.target.value })}
                />
                <input
                  className="rounded border border-[#c9dce8] px-3 py-2 text-sm"
                  placeholder={t.shifts}
                  value={sector.shifts}
                  onChange={(event) => updateSector(sector.id, { shifts: event.target.value })}
                />
                <label className="space-y-1">
                  <span className="text-xs font-medium text-[#214759]">{t.remoteWorkersInSector}</span>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    placeholder="0"
                    value={sector.remoteWorkers}
                    onChange={(event) => updateSector(sector.id, { remoteWorkers: event.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-[#214759]">{t.onsiteWorkersInSector}</span>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    placeholder="0"
                    value={sector.onsiteWorkers}
                    onChange={(event) => updateSector(sector.id, { onsiteWorkers: event.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-[#214759]">{t.hybridWorkersInSector}</span>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    placeholder="0"
                    value={sector.hybridWorkers}
                    onChange={(event) => updateSector(sector.id, { hybridWorkers: event.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-[#214759]">{t.workersInRole}</span>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    placeholder="0"
                    value={sector.workersInRole}
                    onChange={(event) => updateSector(sector.id, { workersInRole: event.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-[#214759]">{t.riskParameter}</span>
                  <input
                    type="number"
                    min={0.5}
                    max={2}
                    step="0.01"
                    className="w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    placeholder="1.0"
                    value={sector.riskParameter}
                    onChange={(event) => updateSector(sector.id, { riskParameter: event.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-[#214759]">{t.elaborationDate}</span>
                  <input
                    type="date"
                    className="w-full rounded border border-[#c9dce8] px-3 py-2 text-sm"
                    value={sector.elaborationDate}
                    onChange={(event) => updateSector(sector.id, { elaborationDate: event.target.value })}
                  />
                  <span className="block text-[11px] leading-4 text-[#57717e]">{t.elaborationDateHelp}</span>
                </label>
                <input
                  className="rounded border border-[#c9dce8] px-3 py-2 text-sm md:col-span-3"
                  placeholder={t.functions}
                  value={sector.functions}
                  onChange={(event) => updateSector(sector.id, { functions: event.target.value })}
                />
                <textarea
                  className="min-h-20 rounded border border-[#c9dce8] px-3 py-2 text-sm md:col-span-3"
                  placeholder={t.vulnerableGroups}
                  value={sector.vulnerableGroups}
                  onChange={(event) => updateSector(sector.id, { vulnerableGroups: event.target.value })}
                />
                <textarea
                  className="min-h-20 rounded border border-[#c9dce8] px-3 py-2 text-sm md:col-span-3"
                  placeholder={t.harms}
                  value={sector.possibleMentalHealthHarms}
                  onChange={(event) => updateSector(sector.id, { possibleMentalHealthHarms: event.target.value })}
                />
                <textarea
                  className="min-h-20 rounded border border-[#c9dce8] px-3 py-2 text-sm md:col-span-3"
                  placeholder={t.controls}
                  value={sector.existingControlMeasures}
                  onChange={(event) => updateSector(sector.id, { existingControlMeasures: event.target.value })}
                />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="rounded-full bg-[#0f5b73] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? t.submitting : t.submit}
          </button>
          <Link
            href="/manager/clients"
            className="rounded-full border border-[#9ec8db] px-4 py-2 text-sm font-semibold text-[#0f5b73]"
          >
            {t.back}
          </Link>
        </div>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </section>

      {isInvitationModalOpen && invitationLink && createdClientId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
          onClick={() => setIsInvitationModalOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border border-[#d8e4ee] bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-[#123447]">{t.invitationModalTitle}</h3>
              <button
                type="button"
                onClick={() => setIsInvitationModalOpen(false)}
                className="rounded-full border border-[#c9dce8] px-3 py-1 text-xs font-semibold text-[#123447]"
              >
                {t.invitationClose}
              </button>
            </div>
            <p className="mt-2 text-sm text-[#3d5a69]">{t.invitationModalBody}</p>
            <label className="mt-4 block space-y-1">
              <span className="text-xs font-medium text-[#214759]">{t.invitationLinkLabel}</span>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={invitationLink}
                  className="w-full rounded border border-[#c9dce8] bg-[#f8fbfd] px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void copyInvitation()}
                  className="rounded-full border border-[#9ec8db] px-3 py-1 text-xs font-semibold text-[#0f5b73]"
                >
                  {copiedInvitation ? t.invitationCopied : t.invitationCopy}
                </button>
              </div>
            </label>
            {invitationExpiresLabel ? (
              <p className="mt-2 text-xs text-[#5a7383]">
                {t.invitationExpiresLabel}: {invitationExpiresLabel}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => router.push(`/manager/clients/${createdClientId}?tab=company-data`)}
                className="rounded-full bg-[#0f5b73] px-4 py-2 text-xs font-semibold text-white"
              >
                {t.invitationOpenProfile}
              </button>
              <button
                type="button"
                onClick={() => router.push("/manager/clients")}
                className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73]"
              >
                {t.invitationBackToClients}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
