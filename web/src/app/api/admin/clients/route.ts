import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildClientPortalSlug,
  coerceNullableDate,
  normalizeBillingStatus,
  normalizeClientStatus,
  normalizeHeadcount,
  type BillingStatus,
  type ClientStatus,
} from "@/lib/client-accounts";
import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { issueClientInvitation, resolveRequestOrigin } from "@/lib/client-access";
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
  absenteeism_rate?: number | null;
  turnover_rate?: number | null;
  mental_health_leave_cases?: number | null;
  organizational_climate_reports?: string | null;
  updated_at: string;
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
  shifts: string | null;
  vulnerable_groups: string | null;
  possible_mental_health_harms: string | null;
  existing_control_measures: string | null;
  elaboration_date: string | null;
  risk_parameter: number | string;
};

type SurveyRow = {
  id: string;
  client_id: string | null;
  status: "draft" | "live" | "closed" | "archived";
};

type ResponseCountRow = {
  survey_id: string;
};

type InvoiceRow = {
  client_id: string;
  status: "Paid" | "Pending" | "Overdue";
  due_date: string;
};

type ReportRow = {
  client_id: string;
  id: string;
  created_at: string;
};

type LegacyClientRow = {
  client_id: string;
  company_name: string;
  cnpj: string;
  total_employees: number;
  status: ClientStatus;
};

type LegacyDrpsCampaignRow = {
  campaign_id: string;
  client_id: string;
  status: "Draft" | "Active" | "Completed";
};

type LegacyEmployeeResponseRow = {
  campaign_id: string;
};

const createSectorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  remoteWorkers: z.number().int().min(0).optional(),
  onsiteWorkers: z.number().int().min(0).optional(),
  hybridWorkers: z.number().int().min(0).optional(),
  functions: z.string().trim().max(255).optional(),
  workersInRole: z.number().int().min(0).optional(),
  shifts: z.string().trim().max(255).optional(),
  vulnerableGroups: z.string().trim().max(1200).optional(),
  possibleMentalHealthHarms: z.string().trim().max(1200).optional(),
  existingControlMeasures: z.string().trim().max(1200).optional(),
  elaborationDate: z.string().trim().optional(),
  riskParameter: z.number().min(0.5).max(2).optional(),
});

const createClientSchema = z.object({
  companyName: z.string().trim().min(2).max(255),
  cnpj: z.string().trim().min(8).max(18),
  totalEmployees: z.number().int().min(1),
  remoteEmployees: z.number().int().min(0).optional(),
  onsiteEmployees: z.number().int().min(0).optional(),
  hybridEmployees: z.number().int().min(0).optional(),
  status: z.enum(["Active", "Pending", "Inactive"]).optional(),
  billingStatus: z.enum(["up_to_date", "pending", "overdue", "blocked"]).optional(),
  portalSlug: z.string().trim().min(3).max(140).optional(),
  contactName: z.string().trim().min(2).max(120).optional(),
  contactEmail: z.string().trim().email().max(160).optional(),
  contactPhone: z.string().trim().min(6).max(40).optional(),
  contractStartDate: z.string().trim().optional(),
  contractEndDate: z.string().trim().optional(),
  absenteeismRate: z.number().min(0).max(100).optional(),
  turnoverRate: z.number().min(0).max(100).optional(),
  mentalHealthLeaveCases: z.number().int().min(0).optional(),
  organizationalClimateReports: z.string().trim().max(3000).optional(),
  sectors: z.array(createSectorSchema).max(60).optional(),
});

function mapSector(row: ClientSectorRow) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    remoteWorkers: row.remote_workers,
    onsiteWorkers: row.onsite_workers,
    hybridWorkers: row.hybrid_workers,
    functions: row.functions,
    workersInRole: row.workers_in_role,
    shifts: row.shifts,
    vulnerableGroups: row.vulnerable_groups,
    possibleMentalHealthHarms: row.possible_mental_health_harms,
    existingControlMeasures: row.existing_control_measures,
    elaborationDate: row.elaboration_date,
    riskParameter: toRiskParameter(row.risk_parameter),
  };
}

export async function GET(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();

  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select(
      "client_id,company_name,cnpj,total_employees,remote_employees,onsite_employees,hybrid_employees,status,billing_status,portal_slug,contact_name,contact_email,contact_phone,contract_start_date,contract_end_date,updated_at",
    )
    .order("company_name", { ascending: true })
    .returns<ClientRow[]>();

  const modernSchemaMissing =
    isMissingColumnError(clientsError, "portal_slug") ||
    isMissingColumnError(clientsError, "billing_status") ||
    isMissingColumnError(clientsError, "remote_employees");

  if (clientsError && !modernSchemaMissing) {
    return NextResponse.json({ error: "Could not load clients." }, { status: 500 });
  }

  if (modernSchemaMissing) {
    const { data: legacyClients, error: legacyClientsError } = await supabase
      .from("clients")
      .select("client_id,company_name,cnpj,total_employees,status")
      .order("company_name", { ascending: true })
      .returns<LegacyClientRow[]>();

    if (legacyClientsError) {
      return NextResponse.json({ error: "Could not load clients." }, { status: 500 });
    }

    const legacyRows = Array.isArray(legacyClients) ? legacyClients : [];
    const clientIds = legacyRows.map((item) => item.client_id);
    const [campaignsResult, invoicesResult] = await Promise.all([
      clientIds.length > 0
        ? supabase
            .from("drps_campaigns")
            .select("campaign_id,client_id,status")
            .in("client_id", clientIds)
            .returns<LegacyDrpsCampaignRow[]>()
        : Promise.resolve({ data: [] as LegacyDrpsCampaignRow[], error: null }),
      clientIds.length > 0
        ? supabase
            .from("invoices")
            .select("client_id,status,due_date")
            .in("client_id", clientIds)
            .order("due_date", { ascending: false })
            .returns<InvoiceRow[]>()
        : Promise.resolve({ data: [] as InvoiceRow[], error: null }),
    ]);

    if (campaignsResult.error || invoicesResult.error) {
      return NextResponse.json({ error: "Could not load client metrics." }, { status: 500 });
    }

    const campaigns = campaignsResult.data ?? [];
    const campaignIds = campaigns.map((item) => item.campaign_id);

    const responsesResult =
      campaignIds.length > 0
        ? await supabase
            .from("employee_responses")
            .select("campaign_id")
            .in("campaign_id", campaignIds)
            .returns<LegacyEmployeeResponseRow[]>()
        : { data: [] as LegacyEmployeeResponseRow[], error: null };

    if (responsesResult.error) {
      return NextResponse.json({ error: "Could not load response counters." }, { status: 500 });
    }

    const campaignsByClient = new Map<string, LegacyDrpsCampaignRow[]>();
    for (const campaign of campaigns) {
      const list = campaignsByClient.get(campaign.client_id) ?? [];
      list.push(campaign);
      campaignsByClient.set(campaign.client_id, list);
    }

    const responseCountByCampaign = new Map<string, number>();
    for (const row of responsesResult.data ?? []) {
      responseCountByCampaign.set(
        row.campaign_id,
        (responseCountByCampaign.get(row.campaign_id) ?? 0) + 1,
      );
    }

    const invoicesByClient = new Map<string, InvoiceRow[]>();
    for (const invoice of invoicesResult.data ?? []) {
      const list = invoicesByClient.get(invoice.client_id) ?? [];
      list.push(invoice);
      invoicesByClient.set(invoice.client_id, list);
    }

    return NextResponse.json({
      clients: legacyRows.map((client) => {
        const clientCampaigns = campaignsByClient.get(client.client_id) ?? [];
        const invoices = invoicesByClient.get(client.client_id) ?? [];
        const totalResponses = clientCampaigns.reduce(
          (acc, campaign) => acc + (responseCountByCampaign.get(campaign.campaign_id) ?? 0),
          0,
        );

        const lastInvoiceStatus = invoices[0]?.status ?? null;
        const billingStatus: BillingStatus =
          lastInvoiceStatus === "Overdue"
            ? "overdue"
            : lastInvoiceStatus === "Paid"
              ? "up_to_date"
              : "pending";

        return {
          id: client.client_id,
          companyName: client.company_name,
          cnpj: client.cnpj,
          totalEmployees: client.total_employees,
          remoteEmployees: 0,
          onsiteEmployees: client.total_employees,
          hybridEmployees: 0,
          status: client.status,
          billingStatus,
          portalSlug: slugify(client.company_name),
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          contractStartDate: null,
          contractEndDate: null,
          absenteeismRate: null,
          turnoverRate: null,
          mentalHealthLeaveCases: null,
          organizationalClimateReports: null,
          updatedAt: new Date().toISOString(),
          sectors: [],
          metrics: {
            campaigns: clientCampaigns.length,
            activeCampaigns: clientCampaigns.filter((campaign) => campaign.status === "Active").length,
            completedCampaigns: clientCampaigns.filter((campaign) => campaign.status === "Completed").length,
            totalResponses,
            openInvoices: invoices.filter((invoice) => invoice.status !== "Paid").length,
            lastInvoiceStatus,
            reports: 0,
            lastReportAt: null,
          },
          schemaMode: "legacy",
          migrationHint:
            "Apply migration 20260301201000_manager_client_workspaces.sql to unlock full manager workspace features.",
        };
      }),
    });
  }

  const clientRows = Array.isArray(clients) ? clients : [];
  const clientIds = clientRows.map((item) => item.client_id);

  const [sectorsResult, surveysResult, invoicesResult, reportsResult] = await Promise.all([
    clientIds.length > 0
      ? supabase
          .from("client_sectors")
          .select(
            "id,client_id,key,name,remote_workers,onsite_workers,hybrid_workers,functions,workers_in_role,shifts,vulnerable_groups,possible_mental_health_harms,existing_control_measures,elaboration_date,risk_parameter",
          )
          .in("client_id", clientIds)
          .order("created_at", { ascending: true })
          .returns<ClientSectorRow[]>()
      : Promise.resolve({ data: [] as ClientSectorRow[], error: null }),
    clientIds.length > 0
      ? supabase
          .from("surveys")
          .select("id,client_id,status")
          .in("client_id", clientIds)
          .returns<SurveyRow[]>()
      : Promise.resolve({ data: [] as SurveyRow[], error: null }),
    clientIds.length > 0
      ? supabase
          .from("invoices")
          .select("client_id,status,due_date")
          .in("client_id", clientIds)
          .order("due_date", { ascending: false })
          .returns<InvoiceRow[]>()
      : Promise.resolve({ data: [] as InvoiceRow[], error: null }),
    clientIds.length > 0
      ? supabase
          .from("client_reports")
          .select("id,client_id,created_at")
          .in("client_id", clientIds)
          .order("created_at", { ascending: false })
          .returns<ReportRow[]>()
      : Promise.resolve({ data: [] as ReportRow[], error: null }),
  ]);

  const sectorsMissing = isMissingTableError(sectorsResult.error, "client_sectors");
  const sectorsColumnsMissing =
    isMissingColumnError(sectorsResult.error, "functions") ||
    isMissingColumnError(sectorsResult.error, "workers_in_role") ||
    isMissingColumnError(sectorsResult.error, "shifts") ||
    isMissingColumnError(sectorsResult.error, "vulnerable_groups") ||
    isMissingColumnError(sectorsResult.error, "possible_mental_health_harms") ||
    isMissingColumnError(sectorsResult.error, "existing_control_measures") ||
    isMissingColumnError(sectorsResult.error, "elaboration_date");
  const reportsMissing = isMissingTableError(reportsResult.error, "client_reports");

  if (surveysResult.error || invoicesResult.error) {
    return NextResponse.json({ error: "Could not load client metrics." }, { status: 500 });
  }
  if (sectorsResult.error && !sectorsMissing && !sectorsColumnsMissing) {
    return NextResponse.json({ error: "Could not load client metrics." }, { status: 500 });
  }
  if (reportsResult.error && !reportsMissing) {
    return NextResponse.json({ error: "Could not load client metrics." }, { status: 500 });
  }

  const surveys = surveysResult.data ?? [];
  const surveyIds = surveys.map((item) => item.id);

  const responsesResult =
    surveyIds.length > 0
      ? await supabase
          .from("responses")
          .select("survey_id")
          .in("survey_id", surveyIds)
          .returns<ResponseCountRow[]>()
      : { data: [] as ResponseCountRow[], error: null };

  if (responsesResult.error) {
    return NextResponse.json({ error: "Could not load response counters." }, { status: 500 });
  }

  const sectorsByClient = new Map<string, ReturnType<typeof mapSector>[]>();
  for (const row of sectorsMissing || sectorsColumnsMissing ? [] : sectorsResult.data ?? []) {
    const list = sectorsByClient.get(row.client_id) ?? [];
    list.push(mapSector(row));
    sectorsByClient.set(row.client_id, list);
  }

  const surveysByClient = new Map<string, SurveyRow[]>();
  for (const survey of surveys) {
    if (!survey.client_id) {
      continue;
    }
    const list = surveysByClient.get(survey.client_id) ?? [];
    list.push(survey);
    surveysByClient.set(survey.client_id, list);
  }

  const responseCountBySurvey = new Map<string, number>();
  for (const row of responsesResult.data ?? []) {
    responseCountBySurvey.set(row.survey_id, (responseCountBySurvey.get(row.survey_id) ?? 0) + 1);
  }

  const invoicesByClient = new Map<string, InvoiceRow[]>();
  for (const invoice of invoicesResult.data ?? []) {
    const list = invoicesByClient.get(invoice.client_id) ?? [];
    list.push(invoice);
    invoicesByClient.set(invoice.client_id, list);
  }

  const reportsByClient = new Map<string, ReportRow[]>();
  for (const report of reportsMissing ? [] : reportsResult.data ?? []) {
    const list = reportsByClient.get(report.client_id) ?? [];
    list.push(report);
    reportsByClient.set(report.client_id, list);
  }

  return NextResponse.json({
    clients: clientRows.map((client) => {
      const sectors = sectorsByClient.get(client.client_id) ?? [];
      const clientSurveys = surveysByClient.get(client.client_id) ?? [];
      const invoices = invoicesByClient.get(client.client_id) ?? [];
      const reports = reportsByClient.get(client.client_id) ?? [];

      const totalResponses = clientSurveys.reduce(
        (acc, survey) => acc + (responseCountBySurvey.get(survey.id) ?? 0),
        0,
      );

      return {
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
        absenteeismRate: client.absenteeism_rate ?? null,
        turnoverRate: client.turnover_rate ?? null,
        mentalHealthLeaveCases: client.mental_health_leave_cases ?? null,
        organizationalClimateReports: client.organizational_climate_reports ?? null,
        updatedAt: client.updated_at,
        sectors,
        metrics: {
          campaigns: clientSurveys.length,
          activeCampaigns: clientSurveys.filter((survey) => survey.status === "live").length,
          completedCampaigns: clientSurveys.filter((survey) => survey.status === "closed").length,
          totalResponses,
          openInvoices: invoices.filter((invoice) => invoice.status !== "Paid").length,
          lastInvoiceStatus: invoices[0]?.status ?? null,
          reports: reports.length,
          lastReportAt: reports[0]?.created_at ?? null,
        },
      };
    }),
  });
}

export async function POST(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let parsed: z.infer<typeof createClientSchema>;
  try {
    parsed = createClientSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const remoteEmployees = normalizeHeadcount(parsed.remoteEmployees);
  const onsiteEmployees = normalizeHeadcount(parsed.onsiteEmployees);
  const hybridEmployees = normalizeHeadcount(parsed.hybridEmployees);
  const totalProfiled = remoteEmployees + onsiteEmployees + hybridEmployees;

  if (totalProfiled > parsed.totalEmployees) {
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
    .select(
      "portal_slug,billing_status,remote_employees,absenteeism_rate,turnover_rate,mental_health_leave_cases,organizational_climate_reports",
    )
    .limit(1);

  const legacySchemaMissing =
    isMissingColumnError(schemaProbeError, "portal_slug") ||
    isMissingColumnError(schemaProbeError, "billing_status") ||
    isMissingColumnError(schemaProbeError, "remote_employees");
  const companyIndicatorsSchemaMissing =
    isMissingColumnError(schemaProbeError, "absenteeism_rate") ||
    isMissingColumnError(schemaProbeError, "turnover_rate") ||
    isMissingColumnError(schemaProbeError, "mental_health_leave_cases") ||
    isMissingColumnError(schemaProbeError, "organizational_climate_reports");

  if (schemaProbeError && !legacySchemaMissing && !companyIndicatorsSchemaMissing) {
    return NextResponse.json({ error: "Could not validate client schema." }, { status: 500 });
  }

  if (legacySchemaMissing) {
    const { data: insertedClient, error: insertLegacyError } = await supabase
      .from("clients")
      .insert({
        client_id: randomUUID(),
        company_name: parsed.companyName,
        cnpj: parsed.cnpj,
        total_employees: parsed.totalEmployees,
        status: normalizeClientStatus(parsed.status),
      })
      .select("client_id,company_name,cnpj,total_employees,status")
      .single<LegacyClientRow>();

    if (insertLegacyError || !insertedClient) {
      return NextResponse.json({ error: "Could not create client account." }, { status: 500 });
    }

    return NextResponse.json(
      {
        client: {
          id: insertedClient.client_id,
          companyName: insertedClient.company_name,
          cnpj: insertedClient.cnpj,
          totalEmployees: insertedClient.total_employees,
          remoteEmployees: 0,
          onsiteEmployees: insertedClient.total_employees,
          hybridEmployees: 0,
          status: insertedClient.status,
          billingStatus: "pending",
          portalSlug: slugify(insertedClient.company_name),
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          contractStartDate: null,
          contractEndDate: null,
          absenteeismRate: null,
          turnoverRate: null,
          mentalHealthLeaveCases: null,
          organizationalClimateReports: null,
          updatedAt: new Date().toISOString(),
          sectors: [],
        },
        warning:
          "Client created in legacy mode. Apply migration 20260301201000_manager_client_workspaces.sql for full account fields.",
      },
      { status: 201 },
    );
  }

  const baseSlug = buildClientPortalSlug(parsed.companyName, parsed.portalSlug);
  let finalPortalSlug = baseSlug;

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const candidate = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
    const { data: existing, error: existingError } = await supabase
      .from("clients")
      .select("client_id")
      .eq("portal_slug", candidate)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: "Could not validate portal slug." }, { status: 500 });
    }

    if (!existing) {
      finalPortalSlug = candidate;
      break;
    }
  }

  const clientId = randomUUID();
  const clientInsertPayload: Record<string, unknown> = {
    client_id: clientId,
    company_name: parsed.companyName,
    cnpj: parsed.cnpj,
    total_employees: parsed.totalEmployees,
    remote_employees: remoteEmployees,
    onsite_employees: onsiteEmployees,
    hybrid_employees: hybridEmployees,
    status: normalizeClientStatus(parsed.status),
    billing_status: normalizeBillingStatus(parsed.billingStatus),
    portal_slug: finalPortalSlug,
    contact_name: parsed.contactName?.trim() || null,
    contact_email: parsed.contactEmail?.trim() || null,
    contact_phone: parsed.contactPhone?.trim() || null,
    contract_start_date: coerceNullableDate(parsed.contractStartDate),
    contract_end_date: coerceNullableDate(parsed.contractEndDate),
    updated_at: new Date().toISOString(),
  };
  if (!companyIndicatorsSchemaMissing) {
    clientInsertPayload.absenteeism_rate = parsed.absenteeismRate ?? null;
    clientInsertPayload.turnover_rate = parsed.turnoverRate ?? null;
    clientInsertPayload.mental_health_leave_cases = parsed.mentalHealthLeaveCases ?? null;
    clientInsertPayload.organizational_climate_reports = parsed.organizationalClimateReports?.trim() || null;
  }
  const clientSelect = companyIndicatorsSchemaMissing
    ? "client_id,company_name,cnpj,total_employees,remote_employees,onsite_employees,hybrid_employees,status,billing_status,portal_slug,contact_name,contact_email,contact_phone,contract_start_date,contract_end_date,updated_at"
    : "client_id,company_name,cnpj,total_employees,remote_employees,onsite_employees,hybrid_employees,status,billing_status,portal_slug,contact_name,contact_email,contact_phone,contract_start_date,contract_end_date,absenteeism_rate,turnover_rate,mental_health_leave_cases,organizational_climate_reports,updated_at";

  const { data: insertedClient, error: insertError } = await supabase
    .from("clients")
    .insert(clientInsertPayload)
    .select(clientSelect)
    .single<ClientRow>();

  if (insertError || !insertedClient) {
    return NextResponse.json({ error: "Could not create client account." }, { status: 500 });
  }

  const invitationResult = await issueClientInvitation(
    supabase,
    insertedClient.client_id,
    resolveRequestOrigin(request),
  );
  const clientAccess = {
    invitationLink: invitationResult.invitationLink,
    invitationExpiresAt: invitationResult.invitationExpiresAt,
    invitationStatus: invitationResult.invitationStatus,
  };

  const preparedSectors = (parsed.sectors ?? []).map((sector) => ({
    id: randomUUID(),
    client_id: insertedClient.client_id,
    key: slugify(sector.name),
    name: sector.name,
    remote_workers: normalizeHeadcount(sector.remoteWorkers),
    onsite_workers: normalizeHeadcount(sector.onsiteWorkers),
    hybrid_workers: normalizeHeadcount(sector.hybridWorkers),
    workers_in_role: normalizeHeadcount(
      sector.workersInRole ??
        normalizeHeadcount(sector.remoteWorkers) +
          normalizeHeadcount(sector.onsiteWorkers) +
          normalizeHeadcount(sector.hybridWorkers),
    ),
    shifts: sector.shifts?.trim() || null,
    vulnerable_groups: sector.vulnerableGroups?.trim() || null,
    functions: sector.functions?.trim() || null,
    possible_mental_health_harms: sector.possibleMentalHealthHarms?.trim() || null,
    existing_control_measures: sector.existingControlMeasures?.trim() || null,
    elaboration_date: coerceNullableDate(sector.elaborationDate),
    risk_parameter: toRiskParameter(sector.riskParameter ?? 1),
    updated_at: new Date().toISOString(),
  }));

  if (preparedSectors.some((sector) => !sector.key)) {
    return NextResponse.json({ error: "At least one sector name is invalid." }, { status: 400 });
  }

  const { error: sectorsSchemaProbeError } = await supabase
    .from("client_sectors")
    .select(
      "functions,workers_in_role,shifts,vulnerable_groups,possible_mental_health_harms,existing_control_measures,elaboration_date",
    )
    .limit(1);
  const sectorsTableMissing = isMissingTableError(sectorsSchemaProbeError, "client_sectors");
  const hasSectorWorkersInRole = !isMissingColumnError(sectorsSchemaProbeError, "workers_in_role");
  const hasSectorShifts = !isMissingColumnError(sectorsSchemaProbeError, "shifts");
  const hasSectorVulnerableGroups = !isMissingColumnError(sectorsSchemaProbeError, "vulnerable_groups");
  const hasSectorFunctions = !isMissingColumnError(sectorsSchemaProbeError, "functions");
  const hasSectorHarms = !isMissingColumnError(sectorsSchemaProbeError, "possible_mental_health_harms");
  const hasSectorControls = !isMissingColumnError(sectorsSchemaProbeError, "existing_control_measures");
  const hasSectorElaborationDate = !isMissingColumnError(sectorsSchemaProbeError, "elaboration_date");
  if (
    sectorsSchemaProbeError &&
    !sectorsTableMissing &&
    !isMissingColumnError(sectorsSchemaProbeError, "workers_in_role") &&
    !isMissingColumnError(sectorsSchemaProbeError, "shifts") &&
    !isMissingColumnError(sectorsSchemaProbeError, "vulnerable_groups") &&
    !isMissingColumnError(sectorsSchemaProbeError, "functions") &&
    !isMissingColumnError(sectorsSchemaProbeError, "possible_mental_health_harms") &&
    !isMissingColumnError(sectorsSchemaProbeError, "existing_control_measures") &&
    !isMissingColumnError(sectorsSchemaProbeError, "elaboration_date")
  ) {
    return NextResponse.json({ error: "Could not validate sector schema." }, { status: 500 });
  }

  const sectorsPayload = preparedSectors.map((sector) => {
    const payload: Record<string, unknown> = {
      id: sector.id,
      client_id: sector.client_id,
      key: sector.key,
      name: sector.name,
      remote_workers: sector.remote_workers,
      onsite_workers: sector.onsite_workers,
      hybrid_workers: sector.hybrid_workers,
      risk_parameter: sector.risk_parameter,
      updated_at: sector.updated_at,
    };
    if (hasSectorWorkersInRole) payload.workers_in_role = sector.workers_in_role;
    if (hasSectorShifts) payload.shifts = sector.shifts;
    if (hasSectorVulnerableGroups) payload.vulnerable_groups = sector.vulnerable_groups;
    if (hasSectorFunctions) payload.functions = sector.functions;
    if (hasSectorHarms) payload.possible_mental_health_harms = sector.possible_mental_health_harms;
    if (hasSectorControls) payload.existing_control_measures = sector.existing_control_measures;
    if (hasSectorElaborationDate) payload.elaboration_date = sector.elaboration_date;
    return payload;
  });

  if (sectorsPayload.length > 0 && sectorsTableMissing) {
    return NextResponse.json(
      {
        error: "Client created, but failed to save sector profile.",
        details: "Table client_sectors does not exist.",
        client: {
          id: insertedClient.client_id,
          portalSlug: insertedClient.portal_slug,
          access: clientAccess,
        },
        warning: invitationResult.warning ?? undefined,
      },
      { status: 207 },
    );
  }

  if (sectorsPayload.length > 0) {
    const { error: sectorsError } = await supabase.from("client_sectors").insert(sectorsPayload);
    if (sectorsError) {
      return NextResponse.json(
        {
          error: "Client created, but failed to save sector profile.",
          details: sectorsError.message,
          client: {
            id: insertedClient.client_id,
            portalSlug: insertedClient.portal_slug,
            access: clientAccess,
          },
          warning: invitationResult.warning ?? undefined,
        },
        { status: 207 },
      );
    }
  }

  return NextResponse.json(
    {
      client: {
        id: insertedClient.client_id,
        companyName: insertedClient.company_name,
        cnpj: insertedClient.cnpj,
        totalEmployees: insertedClient.total_employees,
        remoteEmployees: insertedClient.remote_employees,
        onsiteEmployees: insertedClient.onsite_employees,
        hybridEmployees: insertedClient.hybrid_employees,
        status: insertedClient.status,
        billingStatus: insertedClient.billing_status,
        portalSlug: insertedClient.portal_slug,
        contactName: insertedClient.contact_name,
        contactEmail: insertedClient.contact_email,
        contactPhone: insertedClient.contact_phone,
        contractStartDate: insertedClient.contract_start_date,
        contractEndDate: insertedClient.contract_end_date,
        absenteeismRate: insertedClient.absenteeism_rate ?? null,
        turnoverRate: insertedClient.turnover_rate ?? null,
        mentalHealthLeaveCases: insertedClient.mental_health_leave_cases ?? null,
        organizationalClimateReports: insertedClient.organizational_climate_reports ?? null,
        updatedAt: insertedClient.updated_at,
        access: clientAccess,
        sectors: preparedSectors.map((item) => ({
          id: item.id,
          key: item.key,
          name: item.name,
          remoteWorkers: item.remote_workers,
          onsiteWorkers: item.onsite_workers,
          hybridWorkers: item.hybrid_workers,
          shifts: item.shifts,
          vulnerableGroups: item.vulnerable_groups,
          functions: item.functions,
          workersInRole: item.workers_in_role,
          possibleMentalHealthHarms: item.possible_mental_health_harms,
          existingControlMeasures: item.existing_control_measures,
          elaborationDate: item.elaboration_date,
          riskParameter: item.risk_parameter,
        })),
      },
      warning: invitationResult.warning ?? undefined,
    },
    { status: 201 },
  );
}
