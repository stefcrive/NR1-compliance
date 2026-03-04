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

type ClientProgramRow = {
  client_program_id: string;
  client_id: string;
  program_id: string;
  status: "Recommended" | "Active" | "Completed";
  deployed_at?: string | null;
};

type ProgramRow = {
  program_id: string;
  title: string;
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

type ResponseRow = {
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

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function plusOneHour(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() + 60 * 60 * 1000).toISOString();
}

async function loadClientById(clientId: string | null) {
  if (!clientId) {
    return {
      name: null,
      portalSlug: null,
    };
  }
  const supabase = getSupabaseAdminClient();
  const withPortalSlugResult = await supabase
    .from("clients")
    .select("client_id,company_name,portal_slug")
    .eq("client_id", clientId)
    .maybeSingle<ClientRow>();

  const clientResult =
    withPortalSlugResult.error && isMissingColumnError(withPortalSlugResult.error, "portal_slug")
      ? await supabase
          .from("clients")
          .select("client_id,company_name")
          .eq("client_id", clientId)
          .maybeSingle<ClientRow>()
      : withPortalSlugResult;

  if (clientResult.error && !isMissingTableError(clientResult.error, "clients")) {
    throw new Error("Could not load client details.");
  }

  return {
    name: clientResult.data?.company_name ?? null,
    portalSlug: clientResult.data?.portal_slug ?? null,
  };
}

async function loadProgramAssignment(assignmentId: string) {
  const supabase = getSupabaseAdminClient();
  const withDateResult = await supabase
    .from("client_programs")
    .select("client_program_id,client_id,program_id,status,deployed_at")
    .eq("client_program_id", assignmentId)
    .maybeSingle<ClientProgramRow>();

  const assignmentResult =
    withDateResult.error && isMissingColumnError(withDateResult.error, "deployed_at")
      ? await supabase
          .from("client_programs")
          .select("client_program_id,client_id,program_id,status")
          .eq("client_program_id", assignmentId)
          .maybeSingle<ClientProgramRow>()
      : withDateResult;

  if (assignmentResult.error) {
    if (isMissingTableError(assignmentResult.error, "client_programs")) {
      return { assignment: null, programTitle: null };
    }
    throw new Error("Could not load program assignment.");
  }

  const assignment = assignmentResult.data ?? null;
  if (!assignment) {
    return { assignment: null, programTitle: null };
  }

  const programResult = await supabase
    .from("periodic_programs")
    .select("program_id,title")
    .eq("program_id", assignment.program_id)
    .maybeSingle<ProgramRow>();
  if (programResult.error && !isMissingTableError(programResult.error, "periodic_programs")) {
    throw new Error("Could not load assigned program title.");
  }

  return {
    assignment,
    programTitle: programResult.data?.title ?? assignment.program_id,
  };
}

async function loadCampaignById(campaignId: string): Promise<{
  campaign: {
    id: string;
    clientId: string | null;
    name: string;
    publicSlug: string | null;
    status: string;
    startsAt: string | null;
    closesAt: string | null;
    createdAt: string;
  } | null;
  source: "modern" | "legacy";
}> {
  const supabase = getSupabaseAdminClient();
  const modernResult = await supabase
    .from("surveys")
    .select("id,client_id,name,public_slug,status,starts_at,closes_at,created_at")
    .eq("id", campaignId)
    .maybeSingle<ModernCampaignRow>();

  if (
    modernResult.error &&
    !isMissingColumnError(modernResult.error, "client_id") &&
    !isMissingTableError(modernResult.error, "surveys")
  ) {
    throw new Error("Could not load DRPS campaign.");
  }

  if (modernResult.data) {
    return {
      campaign: {
        id: modernResult.data.id,
        clientId: modernResult.data.client_id,
        name: modernResult.data.name,
        publicSlug: modernResult.data.public_slug,
        status: modernResult.data.status,
        startsAt: modernResult.data.starts_at,
        closesAt: modernResult.data.closes_at,
        createdAt: modernResult.data.created_at,
      },
      source: "modern",
    };
  }

  const legacyResult = await supabase
    .from("drps_campaigns")
    .select("campaign_id,client_id,campaign_name,status,start_date,end_date")
    .eq("campaign_id", campaignId)
    .maybeSingle<LegacyCampaignRow>();

  if (legacyResult.error && !isMissingTableError(legacyResult.error, "drps_campaigns")) {
    throw new Error("Could not load DRPS campaign.");
  }

  if (!legacyResult.data) {
    return { campaign: null, source: "legacy" };
  }

  return {
    campaign: {
      id: legacyResult.data.campaign_id,
      clientId: legacyResult.data.client_id,
      name: legacyResult.data.campaign_name,
      publicSlug: null,
      status: legacyResult.data.status,
      startsAt: legacyResult.data.start_date
        ? new Date(legacyResult.data.start_date).toISOString()
        : null,
      closesAt: legacyResult.data.end_date ? new Date(legacyResult.data.end_date).toISOString() : null,
      createdAt: legacyResult.data.start_date
        ? new Date(legacyResult.data.start_date).toISOString()
        : new Date().toISOString(),
    },
    source: "legacy",
  };
}

async function loadCampaignResponseSummary(campaignId: string, mode: "modern" | "legacy") {
  const supabase = getSupabaseAdminClient();
  if (mode === "modern") {
    const responsesResult = await supabase
      .from("responses")
      .select("submitted_at")
      .eq("survey_id", campaignId)
      .returns<ResponseRow[]>();
    if (responsesResult.error && !isMissingTableError(responsesResult.error, "responses")) {
      throw new Error("Could not load campaign response summary.");
    }
    const rows = responsesResult.data ?? [];
    const latestResponseAt = rows.reduce<string | null>((latest, row) => {
      if (!latest) return row.submitted_at;
      return row.submitted_at > latest ? row.submitted_at : latest;
    }, null);
    return {
      responseCount: rows.length,
      latestResponseAt,
    };
  }

  const responsesResult = await supabase
    .from("employee_responses")
    .select("submitted_at")
    .eq("campaign_id", campaignId)
    .returns<ResponseRow[]>();
  if (responsesResult.error && !isMissingTableError(responsesResult.error, "employee_responses")) {
    throw new Error("Could not load campaign response summary.");
  }

  const rows = responsesResult.data ?? [];
  const latestResponseAt = rows.reduce<string | null>((latest, row) => {
    if (!latest) return row.submitted_at;
    return row.submitted_at > latest ? row.submitted_at : latest;
  }, null);
  return {
    responseCount: rows.length,
    latestResponseAt,
  };
}

async function loadLatestDrps(surveyId: string): Promise<{
  latest: {
    id: string;
    sector: string;
    referencePeriod: string;
    probabilityScore: number;
    probabilityClass: "low" | "medium" | "high";
    recommendedPrograms: string[];
    governanceActions: string[];
    createdAt: string;
  } | null;
  unavailable: boolean;
}> {
  const supabase = getSupabaseAdminClient();
  const drpsResult = await supabase
    .from("drps_assessments")
    .select(
      "id,survey_id,sector,reference_period,part1_probability_score,part1_probability_class,recommended_programs,governance_actions,created_at",
    )
    .eq("survey_id", surveyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<DrpsAssessmentRow>();

  if (drpsResult.error) {
    if (isMissingTableError(drpsResult.error, "drps_assessments")) {
      return { latest: null, unavailable: true };
    }
    throw new Error("Could not load DRPS result.");
  }

  if (!drpsResult.data) return { latest: null, unavailable: false };
  return {
    latest: {
      id: drpsResult.data.id,
      sector: drpsResult.data.sector,
      referencePeriod: drpsResult.data.reference_period,
      probabilityScore: drpsResult.data.part1_probability_score,
      probabilityClass: drpsResult.data.part1_probability_class,
      recommendedPrograms: normalizeTextArray(drpsResult.data.recommended_programs),
      governanceActions: normalizeTextArray(drpsResult.data.governance_actions),
      createdAt: drpsResult.data.created_at,
    },
    unavailable: false,
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { eventId } = await context.params;

  try {
    if (eventId.startsWith("drps-start-") || eventId.startsWith("drps-close-")) {
      const eventType = eventId.startsWith("drps-start-") ? "drps_start" : "drps_close";
      const campaignId =
        eventType === "drps_start"
          ? eventId.slice("drps-start-".length)
          : eventId.slice("drps-close-".length);

      const campaignLoaded = await loadCampaignById(campaignId);
      if (!campaignLoaded.campaign) {
        return NextResponse.json({ error: "Event record not found." }, { status: 404 });
      }

      const eventAt =
        eventType === "drps_start"
          ? campaignLoaded.campaign.startsAt
          : campaignLoaded.campaign.closesAt;
      if (!eventAt) {
        return NextResponse.json({ error: "Event record has no schedule date." }, { status: 404 });
      }

      const [client, responseSummary, latestDrps] = await Promise.all([
        loadClientById(campaignLoaded.campaign.clientId),
        loadCampaignResponseSummary(campaignLoaded.campaign.id, campaignLoaded.source),
        campaignLoaded.source === "modern"
          ? loadLatestDrps(campaignLoaded.campaign.id)
          : Promise.resolve({ latest: null, unavailable: false }),
      ]);

      return NextResponse.json({
        record: {
          id: eventId,
          recordType: "drps",
          eventType,
          title:
            eventType === "drps_start"
              ? `Inicio DRPS: ${campaignLoaded.campaign.name}`
              : `Fechamento DRPS: ${campaignLoaded.campaign.name}`,
          status: "completed",
          startsAt: eventAt,
          endsAt: plusOneHour(eventAt),
          clientId: campaignLoaded.campaign.clientId,
          clientName: client.name,
          clientPortalSlug: client.portalSlug,
          sourceClientProgramId: null,
          sourceCampaignId: campaignLoaded.campaign.id,
          details: {
            content: null,
            preparationRequired: null,
            eventLifecycle: "committed",
            proposalKind: null,
            availabilityRequestId: null,
          },
          related: {
            campaign: {
              id: campaignLoaded.campaign.id,
              name: campaignLoaded.campaign.name,
              publicSlug: campaignLoaded.campaign.publicSlug,
              status: campaignLoaded.campaign.status,
              startsAt: campaignLoaded.campaign.startsAt,
              closesAt: campaignLoaded.campaign.closesAt,
            },
            programAssignment: null,
          },
          diagnostics: {
            responseCount: responseSummary.responseCount,
            latestResponseAt: responseSummary.latestResponseAt,
            latestDrpsResult: latestDrps.latest,
            drpsUnavailable: latestDrps.unavailable,
          },
        },
      });
    }

    const supabase = getSupabaseAdminClient();
    const eventResult = await supabase
      .from("calendar_events")
      .select(
        "event_id,client_id,source_client_program_id,event_type,title,starts_at,ends_at,status,metadata",
      )
      .eq("event_id", eventId)
      .maybeSingle<CalendarEventRow>();

    if (eventResult.error) {
      if (isMissingTableError(eventResult.error, "calendar_events")) {
        return NextResponse.json(
          {
            error:
              "Master calendar table unavailable. Apply migration 20260302220000_master_calendar_availability.sql.",
          },
          { status: 412 },
        );
      }
      return NextResponse.json({ error: "Could not load event record." }, { status: 500 });
    }
    if (!eventResult.data) {
      return NextResponse.json({ error: "Event record not found." }, { status: 404 });
    }

    const details = extractCalendarEventDetails(eventResult.data.metadata);
    const programAssignmentLoaded = eventResult.data.source_client_program_id
      ? await loadProgramAssignment(eventResult.data.source_client_program_id)
      : { assignment: null, programTitle: null };
    const assignment = programAssignmentLoaded.assignment;

    const clientId = eventResult.data.client_id ?? assignment?.client_id ?? null;
    const client = await loadClientById(clientId);

    return NextResponse.json({
      record: {
        id: eventResult.data.event_id,
        recordType: "calendar",
        eventType: eventResult.data.event_type,
        title: eventResult.data.title,
        status: eventResult.data.status,
        startsAt: eventResult.data.starts_at,
        endsAt: eventResult.data.ends_at,
        clientId,
        clientName: client.name,
        clientPortalSlug: client.portalSlug,
        sourceClientProgramId: eventResult.data.source_client_program_id,
        sourceCampaignId: null,
        details,
        related: {
          campaign: null,
          programAssignment: assignment
            ? {
                id: assignment.client_program_id,
                clientId: assignment.client_id,
                programId: assignment.program_id,
                programTitle: programAssignmentLoaded.programTitle ?? assignment.program_id,
                status: assignment.status,
                deployedAt: assignment.deployed_at ?? null,
              }
            : null,
        },
        diagnostics: null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not load event record.",
      },
      { status: 500 },
    );
  }
}
