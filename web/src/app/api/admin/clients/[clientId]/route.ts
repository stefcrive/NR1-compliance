import { randomUUID } from "node:crypto";

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
  functions: string | null;
  workers_in_role: number;
  possible_mental_health_harms: string | null;
  existing_control_measures: string | null;
  elaboration_date: string | null;
  risk_parameter: number | string;
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
  possibleMentalHealthHarms: z.string().trim().max(1200).optional(),
  existingControlMeasures: z.string().trim().max(1200).optional(),
  elaborationDate: z.string().trim().optional(),
  riskParameter: z.number().min(0.5).max(2).optional(),
});

const updateClientSchema = z
  .object({
    companyName: z.string().trim().min(2).max(255).optional(),
    cnpj: z.string().trim().min(8).max(18).optional(),
    totalEmployees: z.number().int().min(1).optional(),
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

function mapSector(item: ClientSectorRow) {
  return {
    id: item.id,
    key: item.key,
    name: item.name,
    remoteWorkers: item.remote_workers,
    onsiteWorkers: item.onsite_workers,
    hybridWorkers: item.hybrid_workers,
    functions: item.functions,
    workersInRole: item.workers_in_role,
    possibleMentalHealthHarms: item.possible_mental_health_harms,
    existingControlMeasures: item.existing_control_measures,
    elaborationDate: item.elaboration_date,
    riskParameter: toRiskParameter(item.risk_parameter),
  };
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
  const [sectorsResult, campaignsResult] = await Promise.all([
    supabase
      .from("client_sectors")
      .select(
        "id,client_id,key,name,remote_workers,onsite_workers,hybrid_workers,functions,workers_in_role,possible_mental_health_harms,existing_control_measures,elaboration_date,risk_parameter",
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: true })
      .returns<ClientSectorRow[]>(),
    supabase
      .from("surveys")
      .select("id,name,public_slug,status,starts_at,closes_at,created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .returns<SurveyRow[]>(),
  ]);

  if (sectorsResult.error || campaignsResult.error) {
    if (
      isMissingColumnError(campaignsResult.error, "client_id") ||
      isMissingTableError(campaignsResult.error, "surveys") ||
      isMissingTableError(sectorsResult.error, "client_sectors") ||
      isMissingColumnError(sectorsResult.error, "functions") ||
      isMissingColumnError(sectorsResult.error, "workers_in_role") ||
      isMissingColumnError(sectorsResult.error, "possible_mental_health_harms") ||
      isMissingColumnError(sectorsResult.error, "existing_control_measures") ||
      isMissingColumnError(sectorsResult.error, "elaboration_date")
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
          totalEmployees: client.total_employees,
          remoteEmployees: client.remote_employees,
          onsiteEmployees: client.onsite_employees,
          hybridEmployees: client.hybrid_employees,
          status: client.status,
          billingStatus: client.billing_status,
          portalSlug: client.portal_slug,
          contactName: client.contact_name,
          contactEmail: client.contact_email,
          contactPhone: client.contact_phone,
          contractStartDate: client.contract_start_date,
          contractEndDate: client.contract_end_date,
          updatedAt: client.updated_at,
          sectors: [],
          campaigns: fallbackCampaigns,
        },
      });
    }
    return NextResponse.json({ error: "Could not load client details." }, { status: 500 });
  }

  return NextResponse.json({
    client: {
      id: client.client_id,
      companyName: client.company_name,
      cnpj: client.cnpj,
      totalEmployees: client.total_employees,
      remoteEmployees: client.remote_employees,
      onsiteEmployees: client.onsite_employees,
      hybridEmployees: client.hybrid_employees,
      status: client.status,
      billingStatus: client.billing_status,
      portalSlug: client.portal_slug,
      contactName: client.contact_name,
      contactEmail: client.contact_email,
      contactPhone: client.contact_phone,
      contractStartDate: client.contract_start_date,
      contractEndDate: client.contract_end_date,
      updatedAt: client.updated_at,
      sectors: (sectorsResult.data ?? []).map(mapSector),
      campaigns: campaignsResult.data ?? [],
    },
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

  const totalEmployees = parsed.totalEmployees ?? client.total_employees;
  const remoteEmployees = normalizeHeadcount(parsed.remoteEmployees ?? client.remote_employees);
  const onsiteEmployees = normalizeHeadcount(parsed.onsiteEmployees ?? client.onsite_employees);
  const hybridEmployees = normalizeHeadcount(parsed.hybridEmployees ?? client.hybrid_employees);

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
    const sectorsPayload = parsed.sectors.map((sector) => ({
      id: randomUUID(),
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
      possible_mental_health_harms: sector.possibleMentalHealthHarms?.trim() || null,
      existing_control_measures: sector.existingControlMeasures?.trim() || null,
      elaboration_date: coerceNullableDate(sector.elaborationDate),
      risk_parameter: toRiskParameter(sector.riskParameter ?? 1),
      updated_at: new Date().toISOString(),
    }));

    if (sectorsPayload.some((sector) => !sector.key)) {
      return NextResponse.json({ error: "At least one sector name is invalid." }, { status: 400 });
    }

    const { error: deleteSectorsError } = await supabase
      .from("client_sectors")
      .delete()
      .eq("client_id", clientId);

    if (deleteSectorsError) {
      return NextResponse.json({ error: "Could not refresh sector profile." }, { status: 500 });
    }

    if (sectorsPayload.length > 0) {
      const { error: insertSectorsError } = await supabase
        .from("client_sectors")
        .insert(sectorsPayload);

      if (insertSectorsError) {
        return NextResponse.json({ error: "Could not save sector profile." }, { status: 500 });
      }
    }
  }

  const { data: sectors, error: sectorsError } = await supabase
    .from("client_sectors")
    .select(
      "id,client_id,key,name,remote_workers,onsite_workers,hybrid_workers,functions,workers_in_role,possible_mental_health_harms,existing_control_measures,elaboration_date,risk_parameter",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: true })
    .returns<ClientSectorRow[]>();

  if (sectorsError) {
    if (
      isMissingColumnError(sectorsError, "functions") ||
      isMissingColumnError(sectorsError, "workers_in_role") ||
      isMissingColumnError(sectorsError, "possible_mental_health_harms") ||
      isMissingColumnError(sectorsError, "existing_control_measures") ||
      isMissingColumnError(sectorsError, "elaboration_date")
    ) {
      return NextResponse.json({
        client: {
          id: updatedClient.client_id,
          companyName: updatedClient.company_name,
          cnpj: updatedClient.cnpj,
          totalEmployees: updatedClient.total_employees,
          remoteEmployees: updatedClient.remote_employees,
          onsiteEmployees: updatedClient.onsite_employees,
          hybridEmployees: updatedClient.hybrid_employees,
          status: updatedClient.status,
          billingStatus: updatedClient.billing_status,
          portalSlug: updatedClient.portal_slug,
          contactName: updatedClient.contact_name,
          contactEmail: updatedClient.contact_email,
          contactPhone: updatedClient.contact_phone,
          contractStartDate: updatedClient.contract_start_date,
          contractEndDate: updatedClient.contract_end_date,
          updatedAt: updatedClient.updated_at,
          sectors: [],
        },
        warning:
          "Client updated, but extended sector onboarding fields need migration 20260302110000_client_sector_onboarding_fields.sql.",
      });
    }
    return NextResponse.json(
      { error: "Client updated, but failed to load sectors." },
      { status: 207 },
    );
  }

  return NextResponse.json({
    client: {
      id: updatedClient.client_id,
      companyName: updatedClient.company_name,
      cnpj: updatedClient.cnpj,
      totalEmployees: updatedClient.total_employees,
      remoteEmployees: updatedClient.remote_employees,
      onsiteEmployees: updatedClient.onsite_employees,
      hybridEmployees: updatedClient.hybrid_employees,
      status: updatedClient.status,
      billingStatus: updatedClient.billing_status,
      portalSlug: updatedClient.portal_slug,
      contactName: updatedClient.contact_name,
      contactEmail: updatedClient.contact_email,
      contactPhone: updatedClient.contact_phone,
      contractStartDate: updatedClient.contract_start_date,
      contractEndDate: updatedClient.contract_end_date,
      updatedAt: updatedClient.updated_at,
      sectors: (sectors ?? []).map(mapSector),
    },
  });
}
