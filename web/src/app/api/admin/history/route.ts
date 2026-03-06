import { NextRequest, NextResponse } from "next/server";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { extractCalendarEventDetails } from "@/lib/master-calendar";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ClientRow = {
  client_id: string;
  company_name: string;
  portal_slug?: string | null;
};

type ModernCampaignRow = {
  id: string;
  client_id: string | null;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  starts_at: string | null;
  closes_at: string | null;
  created_at: string;
};

type LegacyCampaignRow = {
  campaign_id: string;
  client_id: string;
  campaign_name: string;
  status: "Draft" | "Active" | "Completed";
  start_date: string;
  end_date: string | null;
};

type CampaignStatsRow = {
  id: string;
  response_count: number;
  latest_response_at: string | null;
};

type ResponseRow = {
  survey_id: string;
  submitted_at: string;
};

type LegacyResponseRow = {
  campaign_id: string;
  submitted_at: string;
};

type DrpsAssessmentRow = {
  id: string;
  survey_id: string;
  sector: string;
  reference_period: string;
  part1_probability_score: number;
  part1_probability_class: "low" | "medium" | "high";
  recommended_programs: string[];
  governance_actions: string[];
  created_at: string;
};

type ClientProgramRow = {
  client_program_id: string;
  client_id: string;
  program_id: string;
  status: "Recommended" | "Active" | "Completed";
  deployed_at?: string | null;
  schedule_frequency_override?: string | null;
  annual_plan_months?: unknown;
};

type PeriodicProgramRow = {
  program_id: string;
  title: string;
};

type CalendarEventRow = {
  event_id: string;
  client_id: string | null;
  source_client_program_id: string | null;
  event_type: "continuous_meeting" | "blocked";
  title: string;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "completed" | "cancelled";
  metadata: unknown;
};

type ClientReportRow = {
  id: string;
  client_id: string;
  survey_id: string | null;
  report_title: string;
  status: "draft" | "processing" | "ready" | "failed";
  created_at: string;
};

type SurveyNameRow = {
  id: string;
  name: string;
};

type CompanyRiskProfileReportRow = {
  id: string;
  client_id: string;
  questionnaire_version: string;
  sector: string | null;
  overall_score: number | string;
  overall_class: string;
  created_by_role: string;
  created_at: string;
};

type HistoryConcludedCampaign = {
  id: string;
  clientId: string | null;
  clientName: string | null;
  name: string;
  publicSlug: string | null;
  status: "closed" | "archived" | "completed";
  startsAt: string | null;
  closesAt: string | null;
  createdAt: string;
  responseCount: number;
  latestResponseAt: string | null;
  latestDrpsResult: {
    id: string;
    sector: string;
    referencePeriod: string;
    probabilityScore: number;
    probabilityClass: "low" | "medium" | "high";
    recommendedPrograms: string[];
    governanceActions: string[];
    createdAt: string;
  } | null;
};

type HistoryAssignedProgram = {
  id: string;
  clientId: string;
  clientName: string | null;
  programId: string;
  programTitle: string;
  status: "Recommended" | "Active" | "Completed";
  deployedAt: string | null;
  scheduleFrequency: string;
  annualPlanMonths: string[];
};

type HistoryEvent = {
  id: string;
  recordType: "calendar" | "drps";
  eventType: "drps_start" | "drps_close" | "continuous_meeting" | "blocked";
  title: string;
  clientId: string | null;
  clientName: string | null;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "completed" | "cancelled";
  sourceClientProgramId: string | null;
  sourceCampaignId: string | null;
  lifecycle: "provisory" | "committed";
  proposalKind: "assignment" | "reschedule" | null;
};

type HistoryReport = {
  id: string;
  clientId: string;
  clientName: string | null;
  surveyId: string | null;
  surveyName: string | null;
  reportTitle: string;
  status: "draft" | "processing" | "ready" | "failed";
  createdAt: string;
};

type HistoryCompanyRiskProfileResult = {
  id: string;
  clientId: string;
  clientName: string | null;
  questionnaireVersion: string;
  sector: string | null;
  overallScore: number;
  overallClass: "baixa" | "media" | "alta";
  createdAt: string;
};

const DEFAULT_SCHEDULE_FREQUENCY = "biweekly";

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeAnnualPlanMonths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(normalized)) continue;
    unique.add(normalized);
  }
  return Array.from(unique.values()).sort();
}

function parseOverallScore(value: number | string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(2));
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(2));
}

function normalizeOverallClass(value: string): "baixa" | "media" | "alta" {
  if (value === "baixa") return "baixa";
  if (value === "alta") return "alta";
  return "media";
}

function plusOneHour(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() + 60 * 60 * 1000).toISOString();
}

async function loadClientNames() {
  const supabase = getSupabaseAdminClient();
  const withPortalSlugResult = await supabase
    .from("clients")
    .select("client_id,company_name,portal_slug")
    .order("company_name", { ascending: true })
    .returns<ClientRow[]>();

  const clientsResult =
    withPortalSlugResult.error && isMissingColumnError(withPortalSlugResult.error, "portal_slug")
      ? await supabase
          .from("clients")
          .select("client_id,company_name")
          .order("company_name", { ascending: true })
          .returns<ClientRow[]>()
      : withPortalSlugResult;

  if (clientsResult.error && !isMissingTableError(clientsResult.error, "clients")) {
    throw new Error("Could not load clients.");
  }

  const rows = clientsResult.data ?? [];
  const clientNameById = new Map(rows.map((row) => [row.client_id, row.company_name]));
  const companies = rows.map((row) => ({
    id: row.client_id,
    name: row.company_name,
    portalSlug: row.portal_slug ?? null,
  }));
  return { clientNameById, companies };
}

async function loadConcludedCampaigns(): Promise<{
  campaigns: Array<{
    id: string;
    clientId: string | null;
    name: string;
    publicSlug: string | null;
    status: "closed" | "archived" | "completed";
    startsAt: string | null;
    closesAt: string | null;
    createdAt: string;
    source: "modern" | "legacy";
  }>;
  usingLegacyCampaigns: boolean;
}> {
  const supabase = getSupabaseAdminClient();
  const modernResult = await supabase
    .from("surveys")
    .select("id,client_id,name,public_slug,status,starts_at,closes_at,created_at")
    .in("status", ["closed", "archived"])
    .order("closes_at", { ascending: false, nullsFirst: false })
    .returns<ModernCampaignRow[]>();

  if (
    modernResult.error &&
    !isMissingColumnError(modernResult.error, "client_id") &&
    !isMissingTableError(modernResult.error, "surveys")
  ) {
    throw new Error("Could not load concluded DRPS diagnostics.");
  }

  if (!modernResult.error) {
    return {
      campaigns: (modernResult.data ?? []).map((row) => ({
        id: row.id,
        clientId: row.client_id,
        name: row.name,
        publicSlug: row.public_slug,
        status: row.status === "archived" ? "archived" : "closed",
        startsAt: row.starts_at,
        closesAt: row.closes_at,
        createdAt: row.created_at,
        source: "modern",
      })),
      usingLegacyCampaigns: false,
    };
  }

  const legacyResult = await supabase
    .from("drps_campaigns")
    .select("campaign_id,client_id,campaign_name,status,start_date,end_date")
    .eq("status", "Completed")
    .order("end_date", { ascending: false, nullsFirst: false })
    .returns<LegacyCampaignRow[]>();

  if (legacyResult.error && !isMissingTableError(legacyResult.error, "drps_campaigns")) {
    throw new Error("Could not load concluded DRPS diagnostics.");
  }

  return {
    campaigns: (legacyResult.data ?? []).map((row) => ({
      id: row.campaign_id,
      clientId: row.client_id,
      name: row.campaign_name,
      publicSlug: null,
      status: "completed",
      startsAt: row.start_date ? new Date(row.start_date).toISOString() : null,
      closesAt: row.end_date ? new Date(row.end_date).toISOString() : null,
      createdAt: row.start_date ? new Date(row.start_date).toISOString() : new Date().toISOString(),
      source: "legacy",
    })),
    usingLegacyCampaigns: true,
  };
}

async function loadResponseStatsByCampaign(
  campaignIds: string[],
  mode: "modern" | "legacy",
): Promise<Map<string, { responseCount: number; latestResponseAt: string | null }>> {
  const result = new Map<string, { responseCount: number; latestResponseAt: string | null }>();
  if (campaignIds.length === 0) return result;

  const supabase = getSupabaseAdminClient();
  if (mode === "modern") {
    const rpcResult = await supabase.rpc("get_campaign_stats").returns<CampaignStatsRow[]>();
    if (!rpcResult.error) {
      const set = new Set(campaignIds);
      const rpcRows = Array.isArray(rpcResult.data) ? rpcResult.data : [];
      for (const row of rpcRows) {
        if (!set.has(row.id)) continue;
        result.set(row.id, {
          responseCount: row.response_count ?? 0,
          latestResponseAt: row.latest_response_at ?? null,
        });
      }
      return result;
    }

    const responsesResult = await supabase
      .from("responses")
      .select("survey_id,submitted_at")
      .in("survey_id", campaignIds)
      .returns<ResponseRow[]>();

    if (responsesResult.error && !isMissingTableError(responsesResult.error, "responses")) {
      throw new Error("Could not load campaign response counters.");
    }

    for (const row of responsesResult.data ?? []) {
      const current = result.get(row.survey_id) ?? { responseCount: 0, latestResponseAt: null };
      current.responseCount += 1;
      if (!current.latestResponseAt || current.latestResponseAt < row.submitted_at) {
        current.latestResponseAt = row.submitted_at;
      }
      result.set(row.survey_id, current);
    }
    return result;
  }

  const legacyResponsesResult = await supabase
    .from("employee_responses")
    .select("campaign_id,submitted_at")
    .in("campaign_id", campaignIds)
    .returns<LegacyResponseRow[]>();

  if (legacyResponsesResult.error && !isMissingTableError(legacyResponsesResult.error, "employee_responses")) {
    throw new Error("Could not load campaign response counters.");
  }

  for (const row of legacyResponsesResult.data ?? []) {
    const current = result.get(row.campaign_id) ?? { responseCount: 0, latestResponseAt: null };
    current.responseCount += 1;
    if (!current.latestResponseAt || current.latestResponseAt < row.submitted_at) {
      current.latestResponseAt = row.submitted_at;
    }
    result.set(row.campaign_id, current);
  }

  return result;
}

async function loadLatestDrpsResults(
  surveyIds: string[],
): Promise<{
  latestBySurveyId: Map<string, DrpsAssessmentRow>;
  unavailable: boolean;
}> {
  if (surveyIds.length === 0) {
    return { latestBySurveyId: new Map(), unavailable: false };
  }

  const supabase = getSupabaseAdminClient();
  const drpsResult = await supabase
    .from("drps_assessments")
    .select(
      "id,survey_id,sector,reference_period,part1_probability_score,part1_probability_class,recommended_programs,governance_actions,created_at",
    )
    .in("survey_id", surveyIds)
    .order("created_at", { ascending: false })
    .returns<DrpsAssessmentRow[]>();

  if (drpsResult.error) {
    if (isMissingTableError(drpsResult.error, "drps_assessments")) {
      return { latestBySurveyId: new Map(), unavailable: true };
    }
    throw new Error("Could not load DRPS results.");
  }

  const latestBySurveyId = new Map<string, DrpsAssessmentRow>();
  for (const row of drpsResult.data ?? []) {
    if (latestBySurveyId.has(row.survey_id)) continue;
    latestBySurveyId.set(row.survey_id, row);
  }

  return { latestBySurveyId, unavailable: false };
}

async function loadAssignedPrograms(): Promise<{
  rows: ClientProgramRow[];
  unavailable: boolean;
}> {
  const supabase = getSupabaseAdminClient();
  const withAnnualResult = await supabase
    .from("client_programs")
    .select(
      "client_program_id,client_id,program_id,status,deployed_at,schedule_frequency_override,annual_plan_months",
    )
    .order("deployed_at", { ascending: false, nullsFirst: false })
    .returns<ClientProgramRow[]>();

  if (!withAnnualResult.error) {
    return { rows: withAnnualResult.data ?? [], unavailable: false };
  }
  if (isMissingTableError(withAnnualResult.error, "client_programs")) {
    return { rows: [], unavailable: true };
  }
  if (!isMissingColumnError(withAnnualResult.error, "annual_plan_months")) {
    throw new Error("Could not load assigned programs.");
  }

  const withCadenceResult = await supabase
    .from("client_programs")
    .select("client_program_id,client_id,program_id,status,deployed_at,schedule_frequency_override")
    .order("deployed_at", { ascending: false, nullsFirst: false })
    .returns<ClientProgramRow[]>();
  if (!withCadenceResult.error) {
    return { rows: withCadenceResult.data ?? [], unavailable: false };
  }
  if (isMissingTableError(withCadenceResult.error, "client_programs")) {
    return { rows: [], unavailable: true };
  }
  if (!isMissingColumnError(withCadenceResult.error, "schedule_frequency_override")) {
    throw new Error("Could not load assigned programs.");
  }

  const minimalResult = await supabase
    .from("client_programs")
    .select("client_program_id,client_id,program_id,status,deployed_at")
    .order("deployed_at", { ascending: false, nullsFirst: false })
    .returns<ClientProgramRow[]>();
  if (!minimalResult.error) {
    return { rows: minimalResult.data ?? [], unavailable: false };
  }
  if (isMissingTableError(minimalResult.error, "client_programs")) {
    return { rows: [], unavailable: true };
  }
  if (!isMissingColumnError(minimalResult.error, "deployed_at")) {
    throw new Error("Could not load assigned programs.");
  }

  const noDateResult = await supabase
    .from("client_programs")
    .select("client_program_id,client_id,program_id,status")
    .returns<ClientProgramRow[]>();
  if (noDateResult.error && !isMissingTableError(noDateResult.error, "client_programs")) {
    throw new Error("Could not load assigned programs.");
  }
  return { rows: noDateResult.data ?? [], unavailable: false };
}

async function loadProgramTitleById(programIds: string[]) {
  const supabase = getSupabaseAdminClient();
  if (programIds.length === 0) return new Map<string, string>();

  const programsResult = await supabase
    .from("periodic_programs")
    .select("program_id,title")
    .in("program_id", programIds)
    .returns<PeriodicProgramRow[]>();

  if (programsResult.error && !isMissingTableError(programsResult.error, "periodic_programs")) {
    throw new Error("Could not load program titles.");
  }

  return new Map((programsResult.data ?? []).map((row) => [row.program_id, row.title]));
}

async function loadRealizedCalendarEvents(nowIso: string): Promise<{
  rows: CalendarEventRow[];
  unavailable: boolean;
}> {
  const supabase = getSupabaseAdminClient();
  const eventsResult = await supabase
    .from("calendar_events")
    .select(
      "event_id,client_id,source_client_program_id,event_type,title,starts_at,ends_at,status,metadata",
    )
    .lte("starts_at", nowIso)
    .neq("status", "cancelled")
    .order("starts_at", { ascending: false })
    .returns<CalendarEventRow[]>();

  if (eventsResult.error) {
    if (isMissingTableError(eventsResult.error, "calendar_events")) {
      return { rows: [], unavailable: true };
    }
    throw new Error("Could not load realized events.");
  }

  return { rows: eventsResult.data ?? [], unavailable: false };
}

async function loadReports(): Promise<{
  rows: ClientReportRow[];
  unavailable: boolean;
}> {
  const supabase = getSupabaseAdminClient();
  const reportsResult = await supabase
    .from("client_reports")
    .select("id,client_id,survey_id,report_title,status,created_at")
    .order("created_at", { ascending: false })
    .returns<ClientReportRow[]>();

  if (reportsResult.error) {
    if (isMissingTableError(reportsResult.error, "client_reports")) {
      return { rows: [], unavailable: true };
    }
    throw new Error("Could not load realized reports.");
  }

  return { rows: reportsResult.data ?? [], unavailable: false };
}

async function loadCompanyRiskProfileResults(): Promise<{
  rows: CompanyRiskProfileReportRow[];
  unavailable: boolean;
}> {
  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("client_company_risk_profile_reports")
    .select(
      "id,client_id,questionnaire_version,sector,overall_score,overall_class,created_by_role,created_at",
    )
    .eq("created_by_role", "client")
    .order("created_at", { ascending: false })
    .returns<CompanyRiskProfileReportRow[]>();

  if (result.error) {
    if (isMissingTableError(result.error, "client_company_risk_profile_reports")) {
      return { rows: [], unavailable: true };
    }
    throw new Error("Could not load company risk profile history.");
  }

  return { rows: result.data ?? [], unavailable: false };
}

async function loadSurveyNameById(surveyIds: string[]) {
  const result = new Map<string, string>();
  if (surveyIds.length === 0) return result;

  const supabase = getSupabaseAdminClient();
  const surveysResult = await supabase
    .from("surveys")
    .select("id,name")
    .in("id", surveyIds)
    .returns<SurveyNameRow[]>();

  if (surveysResult.error && !isMissingTableError(surveysResult.error, "surveys")) {
    throw new Error("Could not load survey names.");
  }

  for (const row of surveysResult.data ?? []) {
    result.set(row.id, row.name);
  }
  return result;
}

export async function GET(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const nowIso = new Date().toISOString();
    const { clientNameById, companies } = await loadClientNames();
    const concludedCampaignsLoaded = await loadConcludedCampaigns();

    const responseStatsByCampaign = await loadResponseStatsByCampaign(
      concludedCampaignsLoaded.campaigns.map((campaign) => campaign.id),
      concludedCampaignsLoaded.usingLegacyCampaigns ? "legacy" : "modern",
    );

    const drpsResultsLoaded = concludedCampaignsLoaded.usingLegacyCampaigns
      ? { latestBySurveyId: new Map<string, DrpsAssessmentRow>(), unavailable: false }
      : await loadLatestDrpsResults(concludedCampaignsLoaded.campaigns.map((campaign) => campaign.id));

    const concludedCampaigns: HistoryConcludedCampaign[] = concludedCampaignsLoaded.campaigns.map(
      (campaign) => {
        const responseStats = responseStatsByCampaign.get(campaign.id) ?? {
          responseCount: 0,
          latestResponseAt: null,
        };
        const latestDrps = drpsResultsLoaded.latestBySurveyId.get(campaign.id) ?? null;
        return {
          id: campaign.id,
          clientId: campaign.clientId,
          clientName: campaign.clientId ? clientNameById.get(campaign.clientId) ?? null : null,
          name: campaign.name,
          publicSlug: campaign.publicSlug,
          status: campaign.status,
          startsAt: campaign.startsAt,
          closesAt: campaign.closesAt,
          createdAt: campaign.createdAt,
          responseCount: responseStats.responseCount,
          latestResponseAt: responseStats.latestResponseAt,
          latestDrpsResult: latestDrps
            ? {
                id: latestDrps.id,
                sector: latestDrps.sector,
                referencePeriod: latestDrps.reference_period,
                probabilityScore: latestDrps.part1_probability_score,
                probabilityClass: latestDrps.part1_probability_class,
                recommendedPrograms: normalizeTextArray(latestDrps.recommended_programs),
                governanceActions: normalizeTextArray(latestDrps.governance_actions),
                createdAt: latestDrps.created_at,
              }
            : null,
        };
      },
    );

    const assignedProgramsLoaded = await loadAssignedPrograms();
    const programTitleById = await loadProgramTitleById(
      Array.from(new Set(assignedProgramsLoaded.rows.map((row) => row.program_id))),
    );
    const assignedPrograms: HistoryAssignedProgram[] = assignedProgramsLoaded.rows.map((row) => ({
      id: row.client_program_id,
      clientId: row.client_id,
      clientName: clientNameById.get(row.client_id) ?? null,
      programId: row.program_id,
      programTitle: programTitleById.get(row.program_id) ?? row.program_id,
      status: row.status,
      deployedAt: row.deployed_at ?? null,
      scheduleFrequency: row.schedule_frequency_override ?? DEFAULT_SCHEDULE_FREQUENCY,
      annualPlanMonths: normalizeAnnualPlanMonths(row.annual_plan_months),
    }));

    const assignmentById = new Map(assignedPrograms.map((program) => [program.id, program]));
    const realizedCalendarLoaded = await loadRealizedCalendarEvents(nowIso);
    const calendarEvents: HistoryEvent[] = realizedCalendarLoaded.rows.map((row) => {
      const details = extractCalendarEventDetails(row.metadata);
      const assignment = row.source_client_program_id
        ? assignmentById.get(row.source_client_program_id) ?? null
        : null;
      const clientId = row.client_id ?? assignment?.clientId ?? null;
      return {
        id: row.event_id,
        recordType: "calendar",
        eventType: row.event_type,
        title: row.title,
        clientId,
        clientName: clientId ? clientNameById.get(clientId) ?? assignment?.clientName ?? null : null,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        status: row.status,
        sourceClientProgramId: row.source_client_program_id,
        sourceCampaignId: null,
        lifecycle: details.eventLifecycle,
        proposalKind: details.proposalKind,
      };
    });

    const drpsEvents: HistoryEvent[] = [];
    for (const campaign of concludedCampaigns) {
      if (campaign.startsAt && campaign.startsAt <= nowIso) {
        drpsEvents.push({
          id: `drps-start-${campaign.id}`,
          recordType: "drps",
          eventType: "drps_start",
          title: `Inicio DRPS: ${campaign.name}`,
          clientId: campaign.clientId,
          clientName: campaign.clientName,
          startsAt: campaign.startsAt,
          endsAt: plusOneHour(campaign.startsAt),
          status: "completed",
          sourceClientProgramId: null,
          sourceCampaignId: campaign.id,
          lifecycle: "committed",
          proposalKind: null,
        });
      }

      if (campaign.closesAt && campaign.closesAt <= nowIso) {
        drpsEvents.push({
          id: `drps-close-${campaign.id}`,
          recordType: "drps",
          eventType: "drps_close",
          title: `Fechamento DRPS: ${campaign.name}`,
          clientId: campaign.clientId,
          clientName: campaign.clientName,
          startsAt: campaign.closesAt,
          endsAt: plusOneHour(campaign.closesAt),
          status: "completed",
          sourceClientProgramId: null,
          sourceCampaignId: campaign.id,
          lifecycle: "committed",
          proposalKind: null,
        });
      }
    }

    const realizedEvents = [...calendarEvents, ...drpsEvents].sort(
      (left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime(),
    );

    const [reportsLoaded, companyRiskProfileLoaded] = await Promise.all([
      loadReports(),
      loadCompanyRiskProfileResults(),
    ]);
    const surveyNameById = await loadSurveyNameById(
      Array.from(
        new Set(
          reportsLoaded.rows
            .map((row) => row.survey_id)
            .filter((value): value is string => Boolean(value)),
        ),
      ),
    );

    const reports: HistoryReport[] = reportsLoaded.rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      clientName: clientNameById.get(row.client_id) ?? null,
      surveyId: row.survey_id,
      surveyName: row.survey_id ? surveyNameById.get(row.survey_id) ?? null : null,
      reportTitle: row.report_title,
      status: row.status,
      createdAt: row.created_at,
    }));

    const companyRiskProfileResults: HistoryCompanyRiskProfileResult[] = companyRiskProfileLoaded.rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      clientName: clientNameById.get(row.client_id) ?? null,
      questionnaireVersion: row.questionnaire_version,
      sector: row.sector,
      overallScore: parseOverallScore(row.overall_score),
      overallClass: normalizeOverallClass(row.overall_class),
      createdAt: row.created_at,
    }));

    return NextResponse.json({
      companies,
      concludedCampaigns,
      assignedPrograms,
      realizedEvents,
      reports,
      companyRiskProfileResults,
      compatibility: {
        usingLegacyCampaigns: concludedCampaignsLoaded.usingLegacyCampaigns,
        calendarEventsUnavailable: realizedCalendarLoaded.unavailable,
        reportsUnavailable: reportsLoaded.unavailable,
        drpsUnavailable: drpsResultsLoaded.unavailable,
        programsUnavailable: assignedProgramsLoaded.unavailable,
        companyRiskProfileUnavailable: companyRiskProfileLoaded.unavailable,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load manager history.",
      },
      { status: 500 },
    );
  }
}
