import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  coerceNullableDate,
  normalizeBillingStatus,
  normalizeClientStatus,
  normalizeHeadcount,
  type BillingStatus,
  type ClientStatus,
} from "@/lib/client-accounts";
import { loadClientAccessSummary, resolveRequestOrigin } from "@/lib/client-access";
import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { slugify } from "@/lib/slug";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { toRiskParameter } from "@/lib/survey-sectors";

type ClientRow = {
  client_id: string;
  company_name: string;
  cnpj: string;
  total_employees: number;
  remote_employees: number;
  onsite_employees: number;
  hybrid_employees: number;
  status: ClientStatus;
  billing_status: BillingStatus;
  portal_slug: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  updated_at: string;
};

type LegacyClientRow = {
  client_id: string;
  company_name: string;
  cnpj: string;
  total_employees: number;
  status: ClientStatus;
};

type ClientSectorRow = {
  id: string;
  client_id: string;
  key: string;
  name: string;
  remote_workers: number;
  onsite_workers: number;
  hybrid_workers: number;
  functions?: string | null;
  workers_in_role?: number | null;
  shifts?: string | null;
  vulnerable_groups?: string | null;
  main_contact_name?: string | null;
  main_contact_email?: string | null;
  main_contact_phone?: string | null;
  possible_mental_health_harms?: string | null;
  existing_control_measures?: string | null;
  elaboration_date?: string | null;
  risk_parameter: number | string | null;
  is_active?: boolean | null;
};

type SurveyRow = {
  id: string;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  starts_at: string | null;
  closes_at: string | null;
  created_at: string;
};

type LegacyDrpsCampaignRow = {
  campaign_id: string;
  campaign_name: string;
  status: "Draft" | "Active" | "Completed";
  start_date: string;
  end_date: string | null;
};

const sectorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  remoteWorkers: z.number().int().min(0).optional(),
  onsiteWorkers: z.number().int().min(0).optional(),
  hybridWorkers: z.number().int().min(0).optional(),
  functions: z.string().trim().max(255).optional(),
  workersInRole: z.number().int().min(0).optional(),
  shifts: z.string().trim().max(255).optional(),
  vulnerableGroups: z.string().trim().max(1200).optional(),
  mainContactName: z.string().trim().max(120).optional().or(z.literal("")),
  mainContactEmail: z.string().trim().email().max(160).optional().or(z.literal("")),
  mainContactPhone: z.string().trim().max(40).optional().or(z.literal("")),
  possibleMentalHealthHarms: z.string().trim().max(1200).optional(),
  existingControlMeasures: z.string().trim().max(1200).optional(),
  elaborationDate: z.string().trim().optional(),
  riskParameter: z.number().min(0.5).max(2).optional(),
  isActive: z.boolean().optional(),
});

const updateClientSchema = z
  .object({
    companyName: z.string().trim().min(2).max(255).optional(),
    cnpj: z.string().trim().min(8).max(18).optional(),
    totalEmployees: z.number().int().min(0).optional(),
    remoteEmployees: z.number().int().min(0).optional(),
    onsiteEmployees: z.number().int().min(0).optional(),
    hybridEmployees: z.number().int().min(0).optional(),
    status: z.enum(["Active", "Pending", "Inactive"]).optional(),
    billingStatus: z.enum(["up_to_date", "pending", "overdue", "blocked"]).optional(),
    contactName: z.string().trim().min(2).max(120).optional().or(z.literal("")),
    contactEmail: z.string().trim().email().max(160).optional().or(z.literal("")),
    contactPhone: z.string().trim().min(6).max(40).optional().or(z.literal("")),
    contractStartDate: z.string().trim().optional(),
    contractEndDate: z.string().trim().optional(),
    sectors: z.array(sectorSchema).max(60).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

const CLIENT_SECTOR_SELECT_FULL =
  "id,client_id,key,name,remote_workers,onsite_workers,hybrid_workers,functions,workers_in_role,shifts,vulnerable_groups,main_contact_name,main_contact_email,main_contact_phone,possible_mental_health_harms,existing_control_measures,elaboration_date,risk_parameter,is_active";
const CLIENT_SECTOR_SELECT_BASE =
  "id,client_id,key,name,remote_workers,onsite_workers,hybrid_workers,risk_parameter";
const CLIENT_SECTOR_MIGRATION_WARNING =
  "Client updated, but extended sector fields need migrations 20260302110000_client_sector_onboarding_fields.sql, 20260302113000_client_onboarding_company_indicators.sql, 20260302200000_client_sector_main_contacts.sql and 20260304193000_client_sector_active_flag.sql.";

function isClientSectorsColumnMissing(error: { code?: string | null; message?: string | null } | null | undefined) {
  return (
    isMissingColumnError(error, "functions") ||
    isMissingColumnError(error, "workers_in_role") ||
    isMissingColumnError(error, "shifts") ||
    isMissingColumnError(error, "vulnerable_groups") ||
    isMissingColumnError(error, "main_contact_name") ||
    isMissingColumnError(error, "main_contact_email") ||
    isMissingColumnError(error, "main_contact_phone") ||
    isMissingColumnError(error, "possible_mental_health_harms") ||
    isMissingColumnError(error, "existing_control_measures") ||
    isMissingColumnError(error, "elaboration_date") ||
    isMissingColumnError(error, "is_active")
  );
}

async function loadClientSectorsWithFallback(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  clientId: string,
): Promise<{ data: ClientSectorRow[]; hasCompatibilityWarning: boolean; error: string | null }> {
  const fullResult = await supabase
    .from("client_sectors")
    .select(CLIENT_SECTOR_SELECT_FULL)
    .eq("client_id", clientId)
    .order("created_at", { ascending: true })
    .returns<ClientSectorRow[]>();

  if (!fullResult.error) {
    return {
      data: fullResult.data ?? [],
      hasCompatibilityWarning: false,
      error: null,
    };
  }

  if (isMissingTableError(fullResult.error, "client_sectors")) {
    return {
      data: [],
      hasCompatibilityWarning: false,
      error: null,
    };
  }

  if (!isClientSectorsColumnMissing(fullResult.error)) {
    return {
      data: [],
      hasCompatibilityWarning: false,
      error: fullResult.error.message,
    };
  }

  const baseResult = await supabase
    .from("client_sectors")
    .select(CLIENT_SECTOR_SELECT_BASE)
    .eq("client_id", clientId)
    .order("created_at", { ascending: true })
    .returns<ClientSectorRow[]>();

  if (baseResult.error) {
    if (isMissingTableError(baseResult.error, "client_sectors")) {
      return {
        data: [],
        hasCompatibilityWarning: true,
        error: null,
      };
    }
    return {
      data: [],
      hasCompatibilityWarning: true,
      error: baseResult.error.message,
    };
  }

  return {
    data: baseResult.data ?? [],
    hasCompatibilityWarning: true,
    error: null,
  };
}

function mapSector(item: ClientSectorRow) {
  const workersInRole =
    item.workers_in_role ??
    Math.max(0, item.remote_workers) +
      Math.max(0, item.onsite_workers) +
      Math.max(0, item.hybrid_workers);
  return {
    id: item.id,
    key: item.key,
    name: item.name,
    remoteWorkers: item.remote_workers,
    onsiteWorkers: item.onsite_workers,
    hybridWorkers: item.hybrid_workers,
    functions: item.functions ?? null,
    workersInRole,
    shifts: item.shifts ?? null,
    vulnerableGroups: item.vulnerable_groups ?? null,
    mainContactName: item.main_contact_name ?? null,
    mainContactEmail: item.main_contact_email ?? null,
    mainContactPhone: item.main_contact_phone ?? null,
    possibleMentalHealthHarms: item.possible_mental_health_harms ?? null,
    existingControlMeasures: item.existing_control_measures ?? null,
    elaborationDate: item.elaboration_date ?? null,
    riskParameter: toRiskParameter(item.risk_parameter ?? 1),
    isActive: item.is_active ?? true,
  };
}

function sumSectorHeadcount(
  sectors: Array<Pick<ClientSectorRow, "remote_workers" | "onsite_workers" | "hybrid_workers">>,
) {
  return sectors.reduce(
    (totals, sector) => {
      const remote = normalizeHeadcount(sector.remote_workers);
      const onsite = normalizeHeadcount(sector.onsite_workers);
      const hybrid = normalizeHeadcount(sector.hybrid_workers);
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

function mapLegacyCampaignStatus(status: LegacyDrpsCampaignRow["status"]): SurveyRow["status"] {
  if (status === "Active") return "live";
  if (status === "Completed") return "closed";
  return "draft";
}

async function loadClientOrNull(clientId: string): Promise<ClientRow | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("clients")
    .select(
      "client_id,company_name,cnpj,total_employees,remote_employees,onsite_employees,hybrid_employees,status,billing_status,portal_slug,contact_name,contact_email,contact_phone,contract_start_date,contract_end_date,updated_at",
    )
    .eq("client_id", clientId)
    .maybeSingle<ClientRow>();

  if (error) {
    if (
      isMissingColumnError(error, "portal_slug") ||
      isMissingColumnError(error, "billing_status") ||
      isMissingColumnError(error, "remote_employees")
    ) {
      const { data: legacyClient, error: legacyError } = await supabase
        .from("clients")
        .select("client_id,company_name,cnpj,total_employees,status")
        .eq("client_id", clientId)
        .maybeSingle<LegacyClientRow>();

      if (legacyError) {
        throw new Error(legacyError.message);
      }
      if (!legacyClient) {
        return null;
      }

      return {
        client_id: legacyClient.client_id,
        company_name: legacyClient.company_name,
        cnpj: legacyClient.cnpj,
        total_employees: legacyClient.total_employees,
        remote_employees: 0,
        onsite_employees: legacyClient.total_employees,
        hybrid_employees: 0,
        status: legacyClient.status,
        billing_status: "pending",
        portal_slug: slugify(legacyClient.company_name),
        contact_name: null,
        contact_email: null,
        contact_phone: null,
        contract_start_date: null,
        contract_end_date: null,
        updated_at: new Date().toISOString(),
      };
    }
    throw new Error(error.message);
  }

  return data ?? null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { clientId } = await context.params;
  let client: ClientRow | null = null;
  try {
    client = await loadClientOrNull(clientId);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not load client.",
      },
      { status: 500 },
    );
  }

  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const supabase = getSupabaseAdminClient();
  const origin = resolveRequestOrigin(request);
  const [sectorsResult, campaignsResult, accessResult] = await Promise.all([
    loadClientSectorsWithFallback(supabase, clientId),
    supabase
      .from("surveys")
      .select("id,name,public_slug,status,starts_at,closes_at,created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .returns<SurveyRow[]>(),
    loadClientAccessSummary(supabase, clientId, origin),
  ]);
  const derivedHeadcount =
    sectorsResult.data.length > 0 ? sumSectorHeadcount(sectorsResult.data) : null;

  if (sectorsResult.error || campaignsResult.error) {
    if (
      isMissingColumnError(campaignsResult.error, "client_id") ||
      isMissingTableError(campaignsResult.error, "surveys")
    ) {
      let fallbackCampaigns: SurveyRow[] = campaignsResult.data ?? [];
      if (
        isMissingColumnError(campaignsResult.error, "client_id") ||
        isMissingTableError(campaignsResult.error, "surveys")
      ) {
        const legacyCampaignsResult = await supabase
          .from("drps_campaigns")
          .select("campaign_id,campaign_name,status,start_date,end_date")
          .eq("client_id", clientId)
          .order("start_date", { ascending: false })
          .returns<LegacyDrpsCampaignRow[]>();

        if (!legacyCampaignsResult.error) {
          fallbackCampaigns = (legacyCampaignsResult.data ?? []).map((item) => ({
            id: item.campaign_id,
            name: item.campaign_name,
            public_slug: slugify(item.campaign_name),
            status: mapLegacyCampaignStatus(item.status),
            starts_at: item.start_date ? new Date(item.start_date).toISOString() : null,
            closes_at: item.end_date ? new Date(item.end_date).toISOString() : null,
            created_at: item.start_date ? new Date(item.start_date).toISOString() : new Date().toISOString(),
          }));
        }
      }

      return NextResponse.json({
        client: {
          id: client.client_id,
          companyName: client.company_name,
          cnpj: client.cnpj,
          totalEmployees: derivedHeadcount?.totalEmployees ?? client.total_employees,
          remoteEmployees: derivedHeadcount?.remoteEmployees ?? client.remote_employees,
          onsiteEmployees: derivedHeadcount?.onsiteEmployees ?? client.onsite_employees,
          hybridEmployees: derivedHeadcount?.hybridEmployees ?? client.hybrid_employees,
          status: client.status,
          billingStatus: client.billing_status,
          portalSlug: client.portal_slug,
          contactName: client.contact_name,
          contactEmail: client.contact_email,
          contactPhone: client.contact_phone,
          contractStartDate: client.contract_start_date,
          contractEndDate: client.contract_end_date,
          updatedAt: client.updated_at,
          access: accessResult.summary,
          sectors: sectorsResult.data.map(mapSector),
          campaigns: fallbackCampaigns,
        },
        warning: accessResult.warning ?? undefined,
      });
    }
    return NextResponse.json({ error: "Could not load client details." }, { status: 500 });
  }

  return NextResponse.json({
    client: {
      id: client.client_id,
      companyName: client.company_name,
      cnpj: client.cnpj,
      totalEmployees: derivedHeadcount?.totalEmployees ?? client.total_employees,
      remoteEmployees: derivedHeadcount?.remoteEmployees ?? client.remote_employees,
      onsiteEmployees: derivedHeadcount?.onsiteEmployees ?? client.onsite_employees,
      hybridEmployees: derivedHeadcount?.hybridEmployees ?? client.hybrid_employees,
      status: client.status,
      billingStatus: client.billing_status,
      portalSlug: client.portal_slug,
      contactName: client.contact_name,
      contactEmail: client.contact_email,
      contactPhone: client.contact_phone,
      contractStartDate: client.contract_start_date,
      contractEndDate: client.contract_end_date,
      updatedAt: client.updated_at,
      access: accessResult.summary,
      sectors: sectorsResult.data.map(mapSector),
      campaigns: campaignsResult.data ?? [],
    },
    warning: accessResult.warning ?? undefined,
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { clientId } = await context.params;
  let client: ClientRow | null = null;
  try {
    client = await loadClientOrNull(clientId);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not load client.",
      },
      { status: 500 },
    );
  }

  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  let parsed: z.infer<typeof updateClientSchema>;
  try {
    parsed = updateClientSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const sectorHeadcountFromPayload = parsed.sectors
    ? parsed.sectors.reduce(
        (totals, sector) => {
          const remote = normalizeHeadcount(sector.remoteWorkers);
          const onsite = normalizeHeadcount(sector.onsiteWorkers);
          const hybrid = normalizeHeadcount(sector.hybridWorkers);
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
      )
    : null;
  const totalEmployees =
    sectorHeadcountFromPayload?.totalEmployees ??
    normalizeHeadcount(parsed.totalEmployees ?? client.total_employees);
  const remoteEmployees =
    sectorHeadcountFromPayload?.remoteEmployees ??
    normalizeHeadcount(parsed.remoteEmployees ?? client.remote_employees);
  const onsiteEmployees =
    sectorHeadcountFromPayload?.onsiteEmployees ??
    normalizeHeadcount(parsed.onsiteEmployees ?? client.onsite_employees);
  const hybridEmployees =
    sectorHeadcountFromPayload?.hybridEmployees ??
    normalizeHeadcount(parsed.hybridEmployees ?? client.hybrid_employees);

  if (remoteEmployees + onsiteEmployees + hybridEmployees > totalEmployees) {
    return NextResponse.json(
      {
        error:
          "Remote + onsite + hybrid headcount cannot exceed total employees.",
      },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdminClient();
  const { error: schemaProbeError } = await supabase
    .from("clients")
    .select("portal_slug,billing_status,remote_employees")
    .limit(1);

  if (
    schemaProbeError &&
    (isMissingColumnError(schemaProbeError, "portal_slug") ||
      isMissingColumnError(schemaProbeError, "billing_status") ||
      isMissingColumnError(schemaProbeError, "remote_employees"))
  ) {
    const { data: updatedLegacyClient, error: updateLegacyError } = await supabase
      .from("clients")
      .update({
        company_name: parsed.companyName?.trim() ?? client.company_name,
        cnpj: parsed.cnpj?.trim() ?? client.cnpj,
        total_employees: totalEmployees,
        status: normalizeClientStatus(parsed.status ?? client.status),
      })
      .eq("client_id", clientId)
      .select("client_id,company_name,cnpj,total_employees,status")
      .single<LegacyClientRow>();

    if (updateLegacyError || !updatedLegacyClient) {
      return NextResponse.json({ error: "Could not update client." }, { status: 500 });
    }

    return NextResponse.json({
      client: {
        id: updatedLegacyClient.client_id,
        companyName: updatedLegacyClient.company_name,
        cnpj: updatedLegacyClient.cnpj,
        totalEmployees: updatedLegacyClient.total_employees,
        remoteEmployees: 0,
        onsiteEmployees: updatedLegacyClient.total_employees,
        hybridEmployees: 0,
        status: updatedLegacyClient.status,
        billingStatus: "pending",
        portalSlug: slugify(updatedLegacyClient.company_name),
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        contractStartDate: null,
        contractEndDate: null,
        updatedAt: new Date().toISOString(),
        access: {
          hasCredentials: false,
          loginEmail: null,
          invitationStatus: "unavailable",
          invitationLink: null,
          invitationExpiresAt: null,
          invitationAcceptedAt: null,
        },
        sectors: [],
      },
      warning:
        "Client updated in legacy mode. Apply migration 20260301201000_manager_client_workspaces.sql for full account fields.",
    });
  }

  const { data: updatedClient, error: updateError } = await supabase
    .from("clients")
    .update({
      company_name: parsed.companyName?.trim() ?? client.company_name,
      cnpj: parsed.cnpj?.trim() ?? client.cnpj,
      total_employees: totalEmployees,
      remote_employees: remoteEmployees,
      onsite_employees: onsiteEmployees,
      hybrid_employees: hybridEmployees,
      status: normalizeClientStatus(parsed.status ?? client.status),
      billing_status: normalizeBillingStatus(parsed.billingStatus ?? client.billing_status),
      contact_name:
        parsed.contactName !== undefined ? parsed.contactName.trim() || null : client.contact_name,
      contact_email:
        parsed.contactEmail !== undefined
          ? parsed.contactEmail.trim() || null
          : client.contact_email,
      contact_phone:
        parsed.contactPhone !== undefined
          ? parsed.contactPhone.trim() || null
          : client.contact_phone,
      contract_start_date:
        parsed.contractStartDate !== undefined
          ? coerceNullableDate(parsed.contractStartDate)
          : client.contract_start_date,
      contract_end_date:
        parsed.contractEndDate !== undefined
          ? coerceNullableDate(parsed.contractEndDate)
          : client.contract_end_date,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId)
    .select(
      "client_id,company_name,cnpj,total_employees,remote_employees,onsite_employees,hybrid_employees,status,billing_status,portal_slug,contact_name,contact_email,contact_phone,contract_start_date,contract_end_date,updated_at",
    )
    .single<ClientRow>();

  if (updateError || !updatedClient) {
    return NextResponse.json({ error: "Could not update client." }, { status: 500 });
  }

  if (parsed.sectors) {
    const preparedSectors = parsed.sectors.map((sector) => ({
      client_id: clientId,
      key: slugify(sector.name),
      name: sector.name,
      remote_workers: normalizeHeadcount(sector.remoteWorkers),
      onsite_workers: normalizeHeadcount(sector.onsiteWorkers),
      hybrid_workers: normalizeHeadcount(sector.hybridWorkers),
      functions: sector.functions?.trim() || null,
      workers_in_role: normalizeHeadcount(
        sector.workersInRole ??
          normalizeHeadcount(sector.remoteWorkers) +
            normalizeHeadcount(sector.onsiteWorkers) +
            normalizeHeadcount(sector.hybridWorkers),
      ),
      shifts: sector.shifts?.trim() || null,
      vulnerable_groups: sector.vulnerableGroups?.trim() || null,
      main_contact_name: sector.mainContactName?.trim() || null,
      main_contact_email: sector.mainContactEmail?.trim() || null,
      main_contact_phone: sector.mainContactPhone?.trim() || null,
      possible_mental_health_harms: sector.possibleMentalHealthHarms?.trim() || null,
      existing_control_measures: sector.existingControlMeasures?.trim() || null,
      elaboration_date: coerceNullableDate(sector.elaborationDate),
      risk_parameter: toRiskParameter(sector.riskParameter ?? 1),
      is_active: sector.isActive ?? true,
      updated_at: new Date().toISOString(),
    }));

    if (preparedSectors.some((sector) => !sector.key)) {
      return NextResponse.json({ error: "At least one sector name is invalid." }, { status: 400 });
    }
    const keySet = new Set<string>();
    for (const sector of preparedSectors) {
      if (keySet.has(sector.key)) {
        return NextResponse.json(
          { error: "Two or more sectors resolve to the same key. Rename duplicated sector names." },
          { status: 400 },
        );
      }
      keySet.add(sector.key);
    }

    const { error: sectorsSchemaProbeError } = await supabase
      .from("client_sectors")
      .select(
        "functions,workers_in_role,shifts,vulnerable_groups,main_contact_name,main_contact_email,main_contact_phone,possible_mental_health_harms,existing_control_measures,elaboration_date,is_active",
      )
      .limit(1);

    const sectorsTableMissing = isMissingTableError(sectorsSchemaProbeError, "client_sectors");
    const hasSectorFunctions = !isMissingColumnError(sectorsSchemaProbeError, "functions");
    const hasSectorWorkersInRole = !isMissingColumnError(sectorsSchemaProbeError, "workers_in_role");
    const hasSectorShifts = !isMissingColumnError(sectorsSchemaProbeError, "shifts");
    const hasSectorVulnerableGroups = !isMissingColumnError(sectorsSchemaProbeError, "vulnerable_groups");
    const hasMainContactName = !isMissingColumnError(sectorsSchemaProbeError, "main_contact_name");
    const hasMainContactEmail = !isMissingColumnError(sectorsSchemaProbeError, "main_contact_email");
    const hasMainContactPhone = !isMissingColumnError(sectorsSchemaProbeError, "main_contact_phone");
    const hasSectorHarms = !isMissingColumnError(sectorsSchemaProbeError, "possible_mental_health_harms");
    const hasSectorControls = !isMissingColumnError(sectorsSchemaProbeError, "existing_control_measures");
    const hasSectorElaborationDate = !isMissingColumnError(sectorsSchemaProbeError, "elaboration_date");
    const hasSectorIsActive = !isMissingColumnError(sectorsSchemaProbeError, "is_active");

    if (
      sectorsSchemaProbeError &&
      !sectorsTableMissing &&
      !isMissingColumnError(sectorsSchemaProbeError, "functions") &&
      !isMissingColumnError(sectorsSchemaProbeError, "workers_in_role") &&
      !isMissingColumnError(sectorsSchemaProbeError, "shifts") &&
      !isMissingColumnError(sectorsSchemaProbeError, "vulnerable_groups") &&
      !isMissingColumnError(sectorsSchemaProbeError, "main_contact_name") &&
      !isMissingColumnError(sectorsSchemaProbeError, "main_contact_email") &&
      !isMissingColumnError(sectorsSchemaProbeError, "main_contact_phone") &&
      !isMissingColumnError(sectorsSchemaProbeError, "possible_mental_health_harms") &&
      !isMissingColumnError(sectorsSchemaProbeError, "existing_control_measures") &&
      !isMissingColumnError(sectorsSchemaProbeError, "elaboration_date") &&
      !isMissingColumnError(sectorsSchemaProbeError, "is_active")
    ) {
      return NextResponse.json({ error: "Could not validate sector schema." }, { status: 500 });
    }

    const sectorsPayload = preparedSectors.map((sector) => {
      const payload: Record<string, unknown> = {
        client_id: sector.client_id,
        key: sector.key,
        name: sector.name,
        remote_workers: sector.remote_workers,
        onsite_workers: sector.onsite_workers,
        hybrid_workers: sector.hybrid_workers,
        risk_parameter: sector.risk_parameter,
        updated_at: sector.updated_at,
      };
      if (hasSectorFunctions) payload.functions = sector.functions;
      if (hasSectorWorkersInRole) payload.workers_in_role = sector.workers_in_role;
      if (hasSectorShifts) payload.shifts = sector.shifts;
      if (hasSectorVulnerableGroups) payload.vulnerable_groups = sector.vulnerable_groups;
      if (hasMainContactName) payload.main_contact_name = sector.main_contact_name;
      if (hasMainContactEmail) payload.main_contact_email = sector.main_contact_email;
      if (hasMainContactPhone) payload.main_contact_phone = sector.main_contact_phone;
      if (hasSectorHarms) payload.possible_mental_health_harms = sector.possible_mental_health_harms;
      if (hasSectorControls) payload.existing_control_measures = sector.existing_control_measures;
      if (hasSectorElaborationDate) payload.elaboration_date = sector.elaboration_date;
      if (hasSectorIsActive) payload.is_active = sector.is_active;
      return payload;
    });

    if (sectorsPayload.length > 0) {
      const { error: upsertSectorsError } = await supabase
        .from("client_sectors")
        .upsert(sectorsPayload, { onConflict: "client_id,key" });
      if (upsertSectorsError) {
        return NextResponse.json({ error: "Could not save sector profile." }, { status: 500 });
      }
    }

    const { data: existingSectors, error: existingSectorsError } = await supabase
      .from("client_sectors")
      .select("id,key")
      .eq("client_id", clientId)
      .returns<Array<{ id: string; key: string }>>();

    if (existingSectorsError) {
      return NextResponse.json({ error: "Could not refresh sector profile." }, { status: 500 });
    }

    const staleIds = (existingSectors ?? [])
      .filter((row) => !keySet.has(row.key))
      .map((row) => row.id);

    if (staleIds.length > 0) {
      const { error: deleteStaleSectorsError } = await supabase
        .from("client_sectors")
        .delete()
        .in("id", staleIds);

      if (deleteStaleSectorsError) {
        return NextResponse.json({ error: "Could not refresh sector profile." }, { status: 500 });
      }
    }

    // Propagate template sector flags/parameters to campaign sector links.
    const { data: surveys, error: surveysError } = await supabase
      .from("surveys")
      .select("id")
      .eq("client_id", clientId)
      .returns<Array<{ id: string }>>();

    if (surveysError && !isMissingTableError(surveysError, "surveys")) {
      return NextResponse.json({ error: "Client updated, but failed to sync campaign sectors." }, { status: 207 });
    }

    const surveyIds = (surveys ?? []).map((item) => item.id);
    if (surveyIds.length > 0) {
      const campaignSectorPayload = surveyIds.flatMap((surveyId) =>
        preparedSectors.map((sector) => ({
          survey_id: surveyId,
          key: sector.key,
          name: sector.name,
          risk_parameter: sector.risk_parameter,
          is_active: sector.is_active,
          updated_at: sector.updated_at,
        })),
      );

      if (campaignSectorPayload.length > 0) {
        const { error: upsertCampaignSectorsError } = await supabase
          .from("survey_sectors")
          .upsert(campaignSectorPayload, { onConflict: "survey_id,key" });

        if (
          upsertCampaignSectorsError &&
          !isMissingTableError(upsertCampaignSectorsError, "survey_sectors")
        ) {
          return NextResponse.json(
            { error: "Client updated, but failed to sync campaign sectors." },
            { status: 207 },
          );
        }
      }

      const { data: existingCampaignSectors, error: existingCampaignSectorsError } = await supabase
        .from("survey_sectors")
        .select("id,key")
        .in("survey_id", surveyIds)
        .returns<Array<{ id: string; key: string }>>();

      if (
        existingCampaignSectorsError &&
        !isMissingTableError(existingCampaignSectorsError, "survey_sectors")
      ) {
        return NextResponse.json(
          { error: "Client updated, but failed to sync campaign sectors." },
          { status: 207 },
        );
      }

      const staleCampaignSectorIds = (existingCampaignSectors ?? [])
        .filter((row) => !keySet.has(row.key))
        .map((row) => row.id);

      if (staleCampaignSectorIds.length > 0) {
        const { error: deactivateCampaignSectorsError } = await supabase
          .from("survey_sectors")
          .update({
            is_active: false,
            updated_at: new Date().toISOString(),
          })
          .in("id", staleCampaignSectorIds);

        if (
          deactivateCampaignSectorsError &&
          !isMissingTableError(deactivateCampaignSectorsError, "survey_sectors")
        ) {
          return NextResponse.json(
            { error: "Client updated, but failed to sync campaign sectors." },
            { status: 207 },
          );
        }
      }
    }
  }

  const [sectorsResult, accessResult] = await Promise.all([
    loadClientSectorsWithFallback(supabase, clientId),
    loadClientAccessSummary(supabase, clientId, resolveRequestOrigin(request)),
  ]);
  const derivedUpdatedHeadcount =
    sectorsResult.data.length > 0 ? sumSectorHeadcount(sectorsResult.data) : null;

  if (sectorsResult.error) {
    return NextResponse.json(
      { error: "Client updated, but failed to load sectors." },
      { status: 207 },
    );
  }

  const responsePayload: {
    client: {
      id: string;
      companyName: string;
      cnpj: string;
      totalEmployees: number;
      remoteEmployees: number;
      onsiteEmployees: number;
      hybridEmployees: number;
      status: ClientStatus;
      billingStatus: BillingStatus;
      portalSlug: string;
      contactName: string | null;
      contactEmail: string | null;
      contactPhone: string | null;
      contractStartDate: string | null;
      contractEndDate: string | null;
      updatedAt: string;
      access: {
        hasCredentials: boolean;
        loginEmail: string | null;
        invitationStatus: "pending" | "accepted" | "expired" | "revoked" | "none" | "unavailable";
        invitationLink: string | null;
        invitationExpiresAt: string | null;
        invitationAcceptedAt: string | null;
      };
      sectors: ReturnType<typeof mapSector>[];
    };
    warning?: string;
  } = {
    client: {
      id: updatedClient.client_id,
      companyName: updatedClient.company_name,
      cnpj: updatedClient.cnpj,
      totalEmployees: derivedUpdatedHeadcount?.totalEmployees ?? updatedClient.total_employees,
      remoteEmployees: derivedUpdatedHeadcount?.remoteEmployees ?? updatedClient.remote_employees,
      onsiteEmployees: derivedUpdatedHeadcount?.onsiteEmployees ?? updatedClient.onsite_employees,
      hybridEmployees: derivedUpdatedHeadcount?.hybridEmployees ?? updatedClient.hybrid_employees,
      status: updatedClient.status,
      billingStatus: updatedClient.billing_status,
      portalSlug: updatedClient.portal_slug,
      contactName: updatedClient.contact_name,
      contactEmail: updatedClient.contact_email,
      contactPhone: updatedClient.contact_phone,
      contractStartDate: updatedClient.contract_start_date,
      contractEndDate: updatedClient.contract_end_date,
      updatedAt: updatedClient.updated_at,
      access: accessResult.summary,
      sectors: sectorsResult.data.map(mapSector),
    },
  };
  if (sectorsResult.hasCompatibilityWarning) {
    responsePayload.warning = CLIENT_SECTOR_MIGRATION_WARNING;
  }
  if (accessResult.warning) {
    responsePayload.warning = responsePayload.warning
      ? `${responsePayload.warning} ${accessResult.warning}`
      : accessResult.warning;
  }

  return NextResponse.json(responsePayload);
}
