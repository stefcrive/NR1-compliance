import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { buildSuggestedAvailabilitySlots } from "@/lib/availability-scheduler";
import {
  buildDrpsCalendarEvents,
  loadStoredCalendarEvents,
  mergeAndSortMasterCalendarEvents,
  type MasterCalendarEvent,
} from "@/lib/master-calendar";
import { classifyScore, resolveRisk } from "@/lib/risk";
import { slugify } from "@/lib/slug";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildAccessLink, toRiskParameter } from "@/lib/survey-sectors";

type ClientRow = {
  client_id: string;
  company_name: string;
  cnpj: string;
  status: "Active" | "Pending" | "Inactive";
  billing_status: "up_to_date" | "pending" | "overdue" | "blocked";
  portal_slug: string;
  total_employees: number;
  remote_employees: number;
  onsite_employees: number;
  hybrid_employees: number;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  updated_at: string | null;
};

type LegacyClientRow = {
  client_id: string;
  company_name: string;
  cnpj: string;
  status: "Active" | "Pending" | "Inactive";
  total_employees: number;
};

type CampaignRow = {
  id: string;
  client_id: string | null;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  k_anonymity_min: number;
  starts_at: string | null;
  closes_at: string | null;
  created_at: string;
};

type TopicAggregateRow = {
  topic_id: number;
  n_responses: number;
  mean_severity: number | null;
  mean_probability: number | null;
};

type GroupCountRow = {
  group_value: string;
  n_responses: number;
};

type TimeseriesRow = {
  day: string;
  response_count: number;
};

type DrpsSnapshotRow = {
  id: string;
  sector: string;
  reference_period: string;
  part1_probability_score: number;
  part1_probability_class: "low" | "medium" | "high";
  recommended_programs: string[];
  governance_actions: string[];
  created_at: string;
};

type SectorConfigRow = {
  id: string;
  key: string;
  name: string;
  risk_parameter: number | string;
  access_token: string;
  is_active: boolean;
  submission_count: number;
  last_submitted_at: string | null;
};

type ReportRow = {
  id: string;
  survey_id: string | null;
  report_title: string;
  status: "draft" | "processing" | "ready" | "failed";
  created_at: string;
  summary: Record<string, unknown>;
};

type ClientProgramRow = {
  client_program_id: string;
  program_id: string;
  status: "Recommended" | "Active" | "Completed";
  deployed_at?: string | null;
};

type ProgramRow = {
  program_id: string;
  title: string;
  description: string | null;
  target_risk_topic: number | string;
  trigger_threshold: number | string;
  schedule_frequency?: string | null;
  schedule_anchor_date?: string | null;
};

type AvailabilityRequestRow = {
  request_id: string;
  client_program_id: string;
  status: "pending" | "submitted" | "scheduled" | "closed";
  requested_at: string;
  due_at: string | null;
  suggested_slots: unknown;
  selected_slots: unknown;
  submitted_at: string | null;
};

type AvailabilitySlot = {
  startsAt: string;
  endsAt: string;
};

function normalizeTopic(row: TopicAggregateRow) {
  const meanProbability = row.mean_probability ?? row.mean_severity;
  const severityClass = classifyScore(row.mean_severity);
  const probabilityClass = classifyScore(meanProbability);
  const risk = resolveRisk(severityClass, probabilityClass);
  return {
    topicId: row.topic_id,
    nResponses: row.n_responses,
    meanSeverity: row.mean_severity,
    meanProbability,
    severityClass,
    probabilityClass,
    risk,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseSlots(value: unknown): AvailabilitySlot[] {
  if (!Array.isArray(value)) return [];
  const slots: AvailabilitySlot[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const startsAt = "startsAt" in item ? String(item.startsAt) : "";
    const endsAt = "endsAt" in item ? String(item.endsAt) : "";
    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);
    if (
      startsAt.length > 0 &&
      endsAt.length > 0 &&
      !Number.isNaN(startDate.getTime()) &&
      !Number.isNaN(endDate.getTime()) &&
      endDate.getTime() > startDate.getTime()
    ) {
      slots.push({ startsAt, endsAt });
    }
  }
  return slots;
}

function mapAssignedProgram(
  assignment: ClientProgramRow,
  programById: Map<string, ProgramRow>,
) {
  const program = programById.get(assignment.program_id) ?? null;
  return {
    id: assignment.client_program_id,
    programId: assignment.program_id,
    status: assignment.status,
    deployedAt: assignment.deployed_at ?? null,
    programTitle: program?.title ?? assignment.program_id,
    programDescription: program?.description ?? null,
    targetRiskTopic: program ? Number(program.target_risk_topic) : null,
    triggerThreshold: program ? Number(program.trigger_threshold) : null,
    scheduleFrequency: program?.schedule_frequency ?? "monthly",
    scheduleAnchorDate: program?.schedule_anchor_date ?? null,
  };
}

function computeAdjustedSectorRisk(
  topics: Array<ReturnType<typeof normalizeTopic>>,
  riskParameter: number,
): { adjustedRiskIndex: number | null; adjustedRiskClass: "low" | "medium" | "high" | null } {
  const validValues = topics
    .map((topic) => topic.meanSeverity)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (validValues.length === 0) {
    return {
      adjustedRiskIndex: null,
      adjustedRiskClass: null,
    };
  }

  const meanSeverity = validValues.reduce((acc, value) => acc + value, 0) / validValues.length;
  const adjusted = Number(clamp(meanSeverity * riskParameter, 1, 5).toFixed(2));
  return {
    adjustedRiskIndex: adjusted,
    adjustedRiskClass: classifyScore(adjusted),
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientSlug: string }> },
) {
  const { clientSlug } = await context.params;
  const selectedCampaignId = request.nextUrl.searchParams.get("campaignId");
  const supabase = getSupabaseAdminClient();
  let client: ClientRow | null = null;
  const { data: modernClient, error: clientError } = await supabase
    .from("clients")
    .select(
      "client_id,company_name,cnpj,status,billing_status,portal_slug,total_employees,remote_employees,onsite_employees,hybrid_employees,contact_name,contact_email,contact_phone,contract_start_date,contract_end_date,updated_at",
    )
    .eq("portal_slug", clientSlug)
    .maybeSingle<ClientRow>();

  if (clientError) {
    if (isMissingColumnError(clientError, "portal_slug")) {
      const legacyResult = await supabase
        .from("clients")
        .select("client_id,company_name,cnpj,status,total_employees")
        .returns<LegacyClientRow[]>();

      if (legacyResult.error) {
        return NextResponse.json({ error: "Could not load client workspace." }, { status: 500 });
      }

      const legacyRows = Array.isArray(legacyResult.data) ? legacyResult.data : [];
      const matched = legacyRows.find((row) => slugify(row.company_name) === clientSlug);
      if (!matched) {
        return NextResponse.json({ error: "Client not found." }, { status: 404 });
      }

      client = {
        client_id: matched.client_id,
        company_name: matched.company_name,
        cnpj: matched.cnpj,
        status: matched.status,
        billing_status: "pending",
        portal_slug: slugify(matched.company_name),
        total_employees: matched.total_employees,
        remote_employees: 0,
        onsite_employees: matched.total_employees,
        hybrid_employees: 0,
        contact_name: null,
        contact_email: null,
        contact_phone: null,
        contract_start_date: null,
        contract_end_date: null,
        updated_at: null,
      };
    } else {
      return NextResponse.json({ error: "Could not load client workspace." }, { status: 500 });
    }
  } else {
    client = modernClient ?? null;
  }
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const [campaignsResult, reportsResult, assignmentsResult, availabilityResult] = await Promise.all([
    supabase
      .from("surveys")
      .select("id,client_id,name,public_slug,status,k_anonymity_min,starts_at,closes_at,created_at")
      .eq("client_id", client.client_id)
      .order("created_at", { ascending: false })
      .returns<CampaignRow[]>(),
    supabase
      .from("client_reports")
      .select("id,survey_id,report_title,status,created_at,summary")
      .eq("client_id", client.client_id)
      .order("created_at", { ascending: false })
      .returns<ReportRow[]>(),
    supabase
      .from("client_programs")
      .select("client_program_id,program_id,status,deployed_at")
      .eq("client_id", client.client_id)
      .order("deployed_at", { ascending: false })
      .returns<ClientProgramRow[]>(),
    supabase
      .from("client_program_availability_requests")
      .select(
        "request_id,client_program_id,status,requested_at,due_at,suggested_slots,selected_slots,submitted_at",
      )
      .eq("client_id", client.client_id)
      .order("requested_at", { ascending: false })
      .returns<AvailabilityRequestRow[]>(),
  ]);

  const reportsMissing = isMissingTableError(reportsResult.error, "client_reports");
  const assignmentsMissing = isMissingTableError(assignmentsResult.error, "client_programs");
  const availabilityMissing = isMissingTableError(
    availabilityResult.error,
    "client_program_availability_requests",
  );

  if (campaignsResult.error && !isMissingColumnError(campaignsResult.error, "client_id")) {
    return NextResponse.json({ error: "Could not load client campaigns." }, { status: 500 });
  }
  if (reportsResult.error && !reportsMissing) {
    return NextResponse.json({ error: "Could not load client campaigns." }, { status: 500 });
  }
  if (
    assignmentsResult.error &&
    !assignmentsMissing &&
    !isMissingColumnError(assignmentsResult.error, "deployed_at")
  ) {
    return NextResponse.json({ error: "Could not load assigned programs." }, { status: 500 });
  }
  if (availabilityResult.error && !availabilityMissing) {
    return NextResponse.json({ error: "Could not load availability requests." }, { status: 500 });
  }

  const campaigns = isMissingColumnError(campaignsResult.error, "client_id")
    ? []
    : campaignsResult.data ?? [];
  const campaignsWithLinks = campaigns.map((campaign) => ({
    ...campaign,
    employeeFormLink: `${request.nextUrl.origin}/s/${campaign.public_slug}`,
  }));
  const selectedCampaign =
    campaignsWithLinks.find((item) => item.id === selectedCampaignId) ??
    campaignsWithLinks.find((item) => item.status === "live") ??
    campaignsWithLinks[0] ??
    null;

  const assignments = assignmentsMissing ? [] : assignmentsResult.data ?? [];
  const programIds = Array.from(new Set(assignments.map((item) => item.program_id)));

  let programRows: ProgramRow[] = [];
  if (programIds.length > 0) {
    const withSchedule = await supabase
      .from("periodic_programs")
      .select(
        "program_id,title,description,target_risk_topic,trigger_threshold,schedule_frequency,schedule_anchor_date",
      )
      .in("program_id", programIds)
      .returns<ProgramRow[]>();

    if (
      withSchedule.error &&
      isMissingColumnError(withSchedule.error, "schedule_frequency")
    ) {
      const fallback = await supabase
        .from("periodic_programs")
        .select("program_id,title,description,target_risk_topic,trigger_threshold")
        .in("program_id", programIds)
        .returns<ProgramRow[]>();
      if (fallback.error && !isMissingTableError(fallback.error, "periodic_programs")) {
        return NextResponse.json({ error: "Could not load assigned programs." }, { status: 500 });
      }
      programRows = fallback.data ?? [];
    } else if (
      withSchedule.error &&
      !isMissingTableError(withSchedule.error, "periodic_programs")
    ) {
      return NextResponse.json({ error: "Could not load assigned programs." }, { status: 500 });
    } else {
      programRows = withSchedule.data ?? [];
    }
  }

  const programById = new Map(programRows.map((row) => [row.program_id, row]));
  const assignedPrograms = assignments.map((assignment) => mapAssignedProgram(assignment, programById));

  const drpsEvents = buildDrpsCalendarEvents(campaignsWithLinks);
  let storedEvents: MasterCalendarEvent[] = [];
  let calendarEventsUnavailable = false;
  try {
    const loaded = await loadStoredCalendarEvents(supabase, { clientId: client.client_id });
    storedEvents = loaded.events;
    calendarEventsUnavailable = loaded.unavailable;
  } catch {
    calendarEventsUnavailable = true;
  }
  const masterCalendarEvents = mergeAndSortMasterCalendarEvents(drpsEvents, storedEvents);

  let availabilityRows: AvailabilityRequestRow[] = availabilityMissing ? [] : availabilityResult.data ?? [];
  if (!availabilityMissing && assignments.length > 0) {
    const existingByAssignment = new Set(availabilityRows.map((row) => row.client_program_id));
    const missingAssignments = assignments.filter(
      (assignment) =>
        assignment.status !== "Completed" && !existingByAssignment.has(assignment.client_program_id),
    );

    if (missingAssignments.length > 0) {
      const nowIso = new Date().toISOString();
      const dueAtIso = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      const inserts = missingAssignments.map((assignment) => {
        const program = programById.get(assignment.program_id);
        const suggestedSlots = buildSuggestedAvailabilitySlots({
          deployedAt: assignment.deployed_at ?? nowIso,
          scheduleFrequency: program?.schedule_frequency ?? null,
          scheduleAnchorDate: program?.schedule_anchor_date ?? null,
          existingEvents: masterCalendarEvents,
        });
        return {
          request_id: randomUUID(),
          client_id: client.client_id,
          client_program_id: assignment.client_program_id,
          status: "pending",
          requested_at: nowIso,
          due_at: dueAtIso,
          suggested_slots: suggestedSlots,
          selected_slots: [],
          submitted_at: null,
          updated_at: nowIso,
        };
      });

      const insertResult = await supabase
        .from("client_program_availability_requests")
        .insert(inserts)
        .select(
          "request_id,client_program_id,status,requested_at,due_at,suggested_slots,selected_slots,submitted_at",
        )
        .returns<AvailabilityRequestRow[]>();

      if (!insertResult.error && Array.isArray(insertResult.data)) {
        availabilityRows = [...insertResult.data, ...availabilityRows];
      }
    }
  }

  availabilityRows = availabilityRows
    .slice()
    .sort(
      (a, b) =>
        new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime(),
    );

  const parsedAvailabilityRequests = availabilityMissing
    ? assignments
        .filter((assignment) => assignment.status !== "Completed")
        .map((assignment) => {
          const program = programById.get(assignment.program_id) ?? null;
          const requestedAt = assignment.deployed_at ?? new Date().toISOString();
          return {
            id: `virtual-${assignment.client_program_id}`,
            clientProgramId: assignment.client_program_id,
            programId: assignment.program_id,
            programTitle: program?.title ?? assignment.program_id ?? "Processo continuo",
            status: "pending" as const,
            requestedAt,
            dueAt: null,
            submittedAt: null,
            suggestedSlots: buildSuggestedAvailabilitySlots({
              deployedAt: requestedAt,
              scheduleFrequency: program?.schedule_frequency ?? null,
              scheduleAnchorDate: program?.schedule_anchor_date ?? null,
              existingEvents: masterCalendarEvents,
            }),
            selectedSlots: [],
          };
        })
    : availabilityRows.map((row) => {
        const assignment = assignments.find((item) => item.client_program_id === row.client_program_id) ?? null;
        const program = assignment ? programById.get(assignment.program_id) ?? null : null;
        return {
          id: row.request_id,
          clientProgramId: row.client_program_id,
          programId: assignment?.program_id ?? null,
          programTitle: program?.title ?? assignment?.program_id ?? "Processo continuo",
          status: row.status,
          requestedAt: row.requested_at,
          dueAt: row.due_at,
          submittedAt: row.submitted_at,
          suggestedSlots: parseSlots(row.suggested_slots),
          selectedSlots: parseSlots(row.selected_slots),
        };
      });

  const basePayload = {
    client: {
      id: client.client_id,
      companyName: client.company_name,
      cnpj: client.cnpj,
      status: client.status,
      billingStatus: client.billing_status,
      portalSlug: client.portal_slug,
      totalEmployees: client.total_employees,
      remoteEmployees: client.remote_employees,
      onsiteEmployees: client.onsite_employees,
      hybridEmployees: client.hybrid_employees,
      contactName: client.contact_name,
      contactEmail: client.contact_email,
      contactPhone: client.contact_phone,
      contractStartDate: client.contract_start_date,
      contractEndDate: client.contract_end_date,
      updatedAt: client.updated_at,
    },
    campaigns: campaignsWithLinks,
    selectedCampaign,
    assignedPrograms,
    availabilityRequests: parsedAvailabilityRequests,
    availabilityRequestsUnavailable: availabilityMissing,
    masterCalendar: {
      events: masterCalendarEvents,
      calendarEventsUnavailable,
    },
  };

  if (!selectedCampaign) {
    return NextResponse.json({
      ...basePayload,
      dashboard: null,
      reports: reportsResult.data ?? [],
    });
  }

  const [globalResult, sectorCountsResult, timeseriesResult, latestDrpsResult, sectorConfigResult] =
    await Promise.all([
      supabase
        .rpc("get_topic_aggregates", {
          p_survey_id: selectedCampaign.id,
          p_group_key: null,
          p_group_value: null,
        })
        .returns<TopicAggregateRow[]>(),
      supabase
        .rpc("get_group_counts", {
          p_survey_id: selectedCampaign.id,
          p_group_key: "sector",
        })
        .returns<GroupCountRow[]>(),
      supabase
        .rpc("get_response_timeseries", {
          p_survey_id: selectedCampaign.id,
          p_days: 30,
        })
        .returns<TimeseriesRow[]>(),
      supabase
        .from("drps_assessments")
        .select(
          "id,sector,reference_period,part1_probability_score,part1_probability_class,recommended_programs,governance_actions,created_at",
        )
        .eq("survey_id", selectedCampaign.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .returns<DrpsSnapshotRow[]>(),
      supabase
        .from("survey_sectors")
        .select("id,key,name,risk_parameter,access_token,is_active,submission_count,last_submitted_at")
        .eq("survey_id", selectedCampaign.id)
        .eq("is_active", true)
        .returns<SectorConfigRow[]>(),
    ]);

  if (
    globalResult.error ||
    sectorCountsResult.error ||
    timeseriesResult.error ||
    latestDrpsResult.error ||
    sectorConfigResult.error
  ) {
    return NextResponse.json({ error: "Could not load campaign dashboard." }, { status: 500 });
  }

  const globalRows = Array.isArray(globalResult.data) ? globalResult.data : [];
  const normalizedGlobal = globalRows.map(normalizeTopic);

  const riskDistribution = {
    low: normalizedGlobal.filter((item) => item.risk === "low").length,
    medium: normalizedGlobal.filter((item) => item.risk === "medium").length,
    high: normalizedGlobal.filter((item) => item.risk === "high").length,
    critical: normalizedGlobal.filter((item) => item.risk === "critical").length,
  };

  const sectorCounts = Array.isArray(sectorCountsResult.data) ? sectorCountsResult.data : [];
  const countBySectorName = new Map<string, number>();
  for (const row of sectorCounts) {
    countBySectorName.set(row.group_value, row.n_responses);
  }

  const sectorConfigs = Array.isArray(sectorConfigResult.data) ? sectorConfigResult.data : [];
  const configByName = new Map(sectorConfigs.map((item) => [item.name, item]));
  const allSectorNames = Array.from(
    new Set([
      ...sectorConfigs.map((item) => item.name),
      ...sectorCounts.map((item) => item.group_value),
    ]),
  );

  const sectors = [] as Array<{
    sector: string;
    sectorId: string | null;
    sectorKey: string | null;
    riskParameter: number;
    accessToken: string | null;
    accessLink: string | null;
    submissionCount: number;
    lastSubmittedAt: string | null;
    nResponses: number;
    suppressed: boolean;
    adjustedRiskIndex: number | null;
    adjustedRiskClass: "low" | "medium" | "high" | null;
    topics: Array<ReturnType<typeof normalizeTopic>>;
  }>;

  for (const sectorName of allSectorNames) {
    const config = configByName.get(sectorName);
    const nResponses = countBySectorName.get(sectorName) ?? 0;
    const suppressed = nResponses > 0 && nResponses < selectedCampaign.k_anonymity_min;
    const riskParameter = config ? toRiskParameter(config.risk_parameter) : 1;

    if (suppressed || nResponses === 0) {
      sectors.push({
        sector: sectorName,
        sectorId: config?.id ?? null,
        sectorKey: config?.key ?? null,
        riskParameter,
        accessToken: config?.access_token ?? null,
        accessLink: config
          ? buildAccessLink(request.nextUrl.origin, selectedCampaign.public_slug, config.access_token)
          : null,
        submissionCount: config?.submission_count ?? 0,
        lastSubmittedAt: config?.last_submitted_at ?? null,
        nResponses,
        suppressed,
        adjustedRiskIndex: null,
        adjustedRiskClass: null,
        topics: [],
      });
      continue;
    }

    const groupedResult = await supabase
      .rpc("get_topic_aggregates", {
        p_survey_id: selectedCampaign.id,
        p_group_key: "sector",
        p_group_value: sectorName,
      })
      .returns<TopicAggregateRow[]>();

    if (groupedResult.error) {
      return NextResponse.json({ error: "Could not load sector breakdown." }, { status: 500 });
    }

    const groupedRows = Array.isArray(groupedResult.data) ? groupedResult.data : [];
    const normalizedTopics = groupedRows.map(normalizeTopic);
    const adjustedRisk = computeAdjustedSectorRisk(normalizedTopics, riskParameter);

    sectors.push({
      sector: sectorName,
      sectorId: config?.id ?? null,
      sectorKey: config?.key ?? null,
      riskParameter,
      accessToken: config?.access_token ?? null,
      accessLink: config
        ? buildAccessLink(request.nextUrl.origin, selectedCampaign.public_slug, config.access_token)
        : null,
      submissionCount: config?.submission_count ?? 0,
      lastSubmittedAt: config?.last_submitted_at ?? null,
      nResponses,
      suppressed: false,
      adjustedRiskIndex: adjustedRisk.adjustedRiskIndex,
      adjustedRiskClass: adjustedRisk.adjustedRiskClass,
      topics: normalizedTopics,
    });
  }

  sectors.sort((a, b) => b.nResponses - a.nResponses);

  return NextResponse.json({
    ...basePayload,
    dashboard: {
      totals: {
        responses: globalRows[0]?.n_responses ?? 0,
        topics: normalizedGlobal.length,
        activeSectors: sectorConfigs.length,
      },
      riskDistribution,
      topics: normalizedGlobal,
      responseTimeseries: Array.isArray(timeseriesResult.data) ? timeseriesResult.data : [],
      sectors,
      latestDrps: Array.isArray(latestDrpsResult.data) ? latestDrpsResult.data[0] ?? null : null,
    },
    reports: reportsMissing ? [] : reportsResult.data ?? [],
  });
}
