import { NextRequest, NextResponse } from "next/server";

import { extractCalendarEventDetails } from "@/lib/master-calendar";
import { slugify } from "@/lib/slug";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ClientRow = {
  client_id: string;
  company_name: string;
  portal_slug: string;
};

type LegacyClientRow = {
  client_id: string;
  company_name: string;
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

type ConcludedCampaign = {
  id: string;
  name: string;
  publicSlug: string | null;
  status: "closed" | "archived" | "completed";
  startsAt: string | null;
  closesAt: string | null;
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

function plusOneHour(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() + 60 * 60 * 1000).toISOString();
}

async function loadClientBySlug(clientSlug: string): Promise<ClientRow | null> {
  const supabase = getSupabaseAdminClient();
  const modernResult = await supabase
    .from("clients")
    .select("client_id,company_name,portal_slug")
    .eq("portal_slug", clientSlug)
    .maybeSingle<ClientRow>();

  if (!modernResult.error) {
    return modernResult.data ?? null;
  }

  if (!isMissingColumnError(modernResult.error, "portal_slug")) {
    throw new Error("Could not load client history.");
  }

  const legacyResult = await supabase
    .from("clients")
    .select("client_id,company_name")
    .returns<LegacyClientRow[]>();
  if (legacyResult.error) {
    throw new Error("Could not load client history.");
  }

  const rows = Array.isArray(legacyResult.data) ? legacyResult.data : [];
  const matched = rows.find((row) => slugify(row.company_name) === clientSlug);
  if (!matched) return null;

  return {
    client_id: matched.client_id,
    company_name: matched.company_name,
    portal_slug: slugify(matched.company_name),
  };
}

async function loadConcludedCampaigns(clientId: string): Promise<{
  campaigns: ConcludedCampaign[];
  usingLegacyCampaigns: boolean;
}> {
  const supabase = getSupabaseAdminClient();
  const modernResult = await supabase
    .from("surveys")
    .select("id,client_id,name,public_slug,status,starts_at,closes_at,created_at")
    .eq("client_id", clientId)
    .in("status", ["closed", "archived"])
    .order("closes_at", { ascending: false, nullsFirst: false })
    .returns<ModernCampaignRow[]>();

  if (
    modernResult.error &&
    !isMissingColumnError(modernResult.error, "client_id") &&
    !isMissingTableError(modernResult.error, "surveys")
  ) {
    throw new Error("Could not load concluded diagnostics.");
  }

  if (!modernResult.error) {
    return {
      campaigns: (modernResult.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        publicSlug: row.public_slug,
        status: row.status === "archived" ? "archived" : "closed",
        startsAt: row.starts_at,
        closesAt: row.closes_at,
        createdAt: row.created_at,
      })),
      usingLegacyCampaigns: false,
    };
  }

  const legacyResult = await supabase
    .from("drps_campaigns")
    .select("campaign_id,client_id,campaign_name,status,start_date,end_date")
    .eq("client_id", clientId)
    .eq("status", "Completed")
    .order("end_date", { ascending: false, nullsFirst: false })
    .returns<LegacyCampaignRow[]>();

  if (legacyResult.error && !isMissingTableError(legacyResult.error, "drps_campaigns")) {
    throw new Error("Could not load concluded diagnostics.");
  }

  return {
    campaigns: (legacyResult.data ?? []).map((row) => ({
      id: row.campaign_id,
      name: row.campaign_name,
      publicSlug: null,
      status: "completed",
      startsAt: row.start_date ? new Date(row.start_date).toISOString() : null,
      closesAt: row.end_date ? new Date(row.end_date).toISOString() : null,
      createdAt: row.start_date ? new Date(row.start_date).toISOString() : new Date().toISOString(),
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
      const allowed = new Set(campaignIds);
      const rows = Array.isArray(rpcResult.data) ? rpcResult.data : [];
      for (const row of rows) {
        if (!allowed.has(row.id)) continue;
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
      throw new Error("Could not load response stats.");
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
    throw new Error("Could not load response stats.");
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

async function loadLatestDrpsResults(surveyIds: string[]): Promise<{
  latestBySurveyId: Map<string, DrpsAssessmentRow>;
  unavailable: boolean;
}> {
  if (surveyIds.length === 0) return { latestBySurveyId: new Map(), unavailable: false };

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
    throw new Error("Could not load DRPS snapshots.");
  }

  const latestBySurveyId = new Map<string, DrpsAssessmentRow>();
  for (const row of drpsResult.data ?? []) {
    if (latestBySurveyId.has(row.survey_id)) continue;
    latestBySurveyId.set(row.survey_id, row);
  }
  return { latestBySurveyId, unavailable: false };
}

async function loadAssignedPrograms(clientId: string): Promise<{
  rows: ClientProgramRow[];
  unavailable: boolean;
}> {
  const supabase = getSupabaseAdminClient();
  const withAnnualResult = await supabase
    .from("client_programs")
    .select(
      "client_program_id,client_id,program_id,status,deployed_at,schedule_frequency_override,annual_plan_months",
    )
    .eq("client_id", clientId)
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
    .eq("client_id", clientId)
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
    .eq("client_id", clientId)
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
    .eq("client_id", clientId)
    .returns<ClientProgramRow[]>();
  if (noDateResult.error && !isMissingTableError(noDateResult.error, "client_programs")) {
    throw new Error("Could not load assigned programs.");
  }
  return { rows: noDateResult.data ?? [], unavailable: false };
}

async function loadProgramTitleById(programIds: string[]) {
  const result = new Map<string, string>();
  if (programIds.length === 0) return result;

  const supabase = getSupabaseAdminClient();
  const programsResult = await supabase
    .from("periodic_programs")
    .select("program_id,title")
    .in("program_id", programIds)
    .returns<PeriodicProgramRow[]>();

  if (programsResult.error && !isMissingTableError(programsResult.error, "periodic_programs")) {
    throw new Error("Could not load programs catalog.");
  }

  for (const row of programsResult.data ?? []) {
    result.set(row.program_id, row.title);
  }
  return result;
}

async function loadRealizedCalendarEvents(clientId: string, nowIso: string): Promise<{
  rows: CalendarEventRow[];
  unavailable: boolean;
}> {
  const supabase = getSupabaseAdminClient();
  const eventsResult = await supabase
    .from("calendar_events")
    .select(
      "event_id,client_id,source_client_program_id,event_type,title,starts_at,ends_at,status,metadata",
    )
    .eq("client_id", clientId)
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

async function loadReports(clientId: string): Promise<{
  rows: ClientReportRow[];
  unavailable: boolean;
}> {
  const supabase = getSupabaseAdminClient();
  const reportsResult = await supabase
    .from("client_reports")
    .select("id,client_id,survey_id,report_title,status,created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .returns<ClientReportRow[]>();

  if (reportsResult.error) {
    if (isMissingTableError(reportsResult.error, "client_reports")) {
      return { rows: [], unavailable: true };
    }
    throw new Error("Could not load reports history.");
  }

  return { rows: reportsResult.data ?? [], unavailable: false };
}

async function loadSurveyNameById(surveyIds: string[]) {
  const map = new Map<string, string>();
  if (surveyIds.length === 0) return map;
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
    map.set(row.id, row.name);
  }
  return map;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientSlug: string }> },
) {
  const { clientSlug } = await context.params;

  try {
    const client = await loadClientBySlug(clientSlug);
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    const concludedCampaignsLoaded = await loadConcludedCampaigns(client.client_id);
    const responseStatsByCampaign = await loadResponseStatsByCampaign(
      concludedCampaignsLoaded.campaigns.map((campaign) => campaign.id),
      concludedCampaignsLoaded.usingLegacyCampaigns ? "legacy" : "modern",
    );

    const latestDrpsLoaded = concludedCampaignsLoaded.usingLegacyCampaigns
      ? { latestBySurveyId: new Map<string, DrpsAssessmentRow>(), unavailable: false }
      : await loadLatestDrpsResults(concludedCampaignsLoaded.campaigns.map((campaign) => campaign.id));

    const concludedCampaigns = concludedCampaignsLoaded.campaigns.map((campaign) => {
      const responseStats = responseStatsByCampaign.get(campaign.id) ?? {
        responseCount: 0,
        latestResponseAt: null,
      };
      const latestDrps = latestDrpsLoaded.latestBySurveyId.get(campaign.id) ?? null;

      return {
        ...campaign,
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
    });

    const assignedProgramsLoaded = await loadAssignedPrograms(client.client_id);
    const programTitleById = await loadProgramTitleById(
      Array.from(new Set(assignedProgramsLoaded.rows.map((row) => row.program_id))),
    );
    const assignedPrograms = assignedProgramsLoaded.rows.map((row) => ({
      id: row.client_program_id,
      programId: row.program_id,
      programTitle: programTitleById.get(row.program_id) ?? row.program_id,
      status: row.status,
      deployedAt: row.deployed_at ?? null,
      scheduleFrequency: row.schedule_frequency_override ?? DEFAULT_SCHEDULE_FREQUENCY,
      annualPlanMonths: normalizeAnnualPlanMonths(row.annual_plan_months),
    }));

    const assignmentById = new Map(assignedPrograms.map((program) => [program.id, program]));
    const realizedCalendarLoaded = await loadRealizedCalendarEvents(client.client_id, nowIso);
    const calendarEvents = realizedCalendarLoaded.rows.map((row) => {
      const details = extractCalendarEventDetails(row.metadata);
      const assignment = row.source_client_program_id
        ? assignmentById.get(row.source_client_program_id) ?? null
        : null;
      return {
        id: row.event_id,
        recordType: "calendar" as const,
        eventType: row.event_type,
        title: row.title,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        status: row.status,
        sourceClientProgramId: row.source_client_program_id,
        sourceCampaignId: null,
        lifecycle: details.eventLifecycle,
        proposalKind: details.proposalKind,
        relatedProgramId: assignment?.programId ?? null,
      };
    });

    const drpsEvents = [] as Array<{
      id: string;
      recordType: "drps";
      eventType: "drps_start" | "drps_close";
      title: string;
      startsAt: string;
      endsAt: string;
      status: "completed";
      sourceClientProgramId: null;
      sourceCampaignId: string;
      lifecycle: "committed";
      proposalKind: null;
      relatedProgramId: null;
    }>;

    for (const campaign of concludedCampaigns) {
      if (campaign.startsAt && campaign.startsAt <= nowIso) {
        drpsEvents.push({
          id: `drps-start-${campaign.id}`,
          recordType: "drps",
          eventType: "drps_start",
          title: `Inicio DRPS: ${campaign.name}`,
          startsAt: campaign.startsAt,
          endsAt: plusOneHour(campaign.startsAt),
          status: "completed",
          sourceClientProgramId: null,
          sourceCampaignId: campaign.id,
          lifecycle: "committed",
          proposalKind: null,
          relatedProgramId: null,
        });
      }
      if (campaign.closesAt && campaign.closesAt <= nowIso) {
        drpsEvents.push({
          id: `drps-close-${campaign.id}`,
          recordType: "drps",
          eventType: "drps_close",
          title: `Fechamento DRPS: ${campaign.name}`,
          startsAt: campaign.closesAt,
          endsAt: plusOneHour(campaign.closesAt),
          status: "completed",
          sourceClientProgramId: null,
          sourceCampaignId: campaign.id,
          lifecycle: "committed",
          proposalKind: null,
          relatedProgramId: null,
        });
      }
    }

    const realizedEvents = [...calendarEvents, ...drpsEvents].sort(
      (left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime(),
    );

    const reportsLoaded = await loadReports(client.client_id);
    const surveyNameById = await loadSurveyNameById(
      Array.from(
        new Set(
          reportsLoaded.rows
            .map((report) => report.survey_id)
            .filter((value): value is string => Boolean(value)),
        ),
      ),
    );

    const reports = reportsLoaded.rows.map((report) => ({
      id: report.id,
      surveyId: report.survey_id,
      surveyName: report.survey_id ? surveyNameById.get(report.survey_id) ?? null : null,
      reportTitle: report.report_title,
      status: report.status,
      createdAt: report.created_at,
    }));

    return NextResponse.json({
      client: {
        id: client.client_id,
        companyName: client.company_name,
        portalSlug: client.portal_slug,
      },
      concludedCampaigns,
      assignedPrograms,
      realizedEvents,
      reports,
      compatibility: {
        usingLegacyCampaigns: concludedCampaignsLoaded.usingLegacyCampaigns,
        calendarEventsUnavailable: realizedCalendarLoaded.unavailable,
        reportsUnavailable: reportsLoaded.unavailable,
        drpsUnavailable: latestDrpsLoaded.unavailable,
        programsUnavailable: assignedProgramsLoaded.unavailable,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not load client history.",
      },
      { status: 500 },
    );
  }
}
