import { NextRequest, NextResponse } from "next/server";

import {
  parseContinuousProgramMaterials,
  parseContinuousProgramSessions,
  type ContinuousProgramMaterial,
} from "@/lib/continuous-programs";
import { parseEventRecordAttachments, type EventRecordJournal } from "@/lib/event-record-journal";
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

type ProgramSessionsRow = {
  program_id: string;
  sessions?: unknown;
  materials?: unknown;
};

type SessionLibraryRow = {
  session_library_id: string;
  title: string;
  notes: string | null;
  preparation_required: string | null;
  materials: unknown;
};

type InheritedSessionRecord = {
  id: string;
  title: string;
  notes: string | null;
  preparationRequired: string | null;
  materials: ContinuousProgramMaterial[];
};

type ModernCampaignRow = {
  id: string;
  client_id: string | null;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  starts_at: string | null;
  closes_at: string | null;
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

type EventJournalRow = {
  event_id: string;
  client_id: string | null;
  notes: string | null;
  attachments: unknown;
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

function normalizeNotes(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

async function loadEventJournalForClient(eventId: string, clientId: string): Promise<EventRecordJournal> {
  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("history_event_records")
    .select("event_id,client_id,notes,attachments")
    .eq("event_id", eventId)
    .maybeSingle<EventJournalRow>();

  if (result.error) {
    if (isMissingTableError(result.error, "history_event_records")) {
      return {
        notes: null,
        attachments: [],
        available: false,
      };
    }
    throw new Error("Could not load event journal.");
  }

  if (!result.data) {
    return {
      notes: null,
      attachments: [],
      available: true,
    };
  }

  if (result.data.client_id && result.data.client_id !== clientId) {
    return {
      notes: null,
      attachments: [],
      available: true,
    };
  }

  return {
    notes: normalizeNotes(result.data.notes),
    attachments: parseEventRecordAttachments(result.data.attachments),
    available: true,
  };
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
    throw new Error("Could not load client history record.");
  }

  const legacyResult = await supabase
    .from("clients")
    .select("client_id,company_name")
    .returns<LegacyClientRow[]>();
  if (legacyResult.error) {
    throw new Error("Could not load client history record.");
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

async function loadProgramAssignment(clientId: string, assignmentId: string) {
  const supabase = getSupabaseAdminClient();
  const withDateResult = await supabase
    .from("client_programs")
    .select("client_program_id,client_id,program_id,status,deployed_at")
    .eq("client_id", clientId)
    .eq("client_program_id", assignmentId)
    .maybeSingle<ClientProgramRow>();

  const assignmentResult =
    withDateResult.error && isMissingColumnError(withDateResult.error, "deployed_at")
      ? await supabase
          .from("client_programs")
          .select("client_program_id,client_id,program_id,status")
          .eq("client_id", clientId)
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
  if (!assignment) return { assignment: null, programTitle: null };

  const programResult = await supabase
    .from("periodic_programs")
    .select("program_id,title")
    .eq("program_id", assignment.program_id)
    .maybeSingle<ProgramRow>();
  if (programResult.error && !isMissingTableError(programResult.error, "periodic_programs")) {
    throw new Error("Could not load assigned program.");
  }

  return {
    assignment,
    programTitle: programResult.data?.title ?? assignment.program_id,
  };
}

async function loadCampaignById(clientId: string, campaignId: string): Promise<{
  campaign: {
    id: string;
    name: string;
    publicSlug: string | null;
    status: string;
    startsAt: string | null;
    closesAt: string | null;
  } | null;
  source: "modern" | "legacy";
}> {
  const supabase = getSupabaseAdminClient();
  const modernResult = await supabase
    .from("surveys")
    .select("id,client_id,name,public_slug,status,starts_at,closes_at")
    .eq("client_id", clientId)
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
        name: modernResult.data.name,
        publicSlug: modernResult.data.public_slug,
        status: modernResult.data.status,
        startsAt: modernResult.data.starts_at,
        closesAt: modernResult.data.closes_at,
      },
      source: "modern",
    };
  }

  const legacyResult = await supabase
    .from("drps_campaigns")
    .select("campaign_id,client_id,campaign_name,status,start_date,end_date")
    .eq("client_id", clientId)
    .eq("campaign_id", campaignId)
    .maybeSingle<LegacyCampaignRow>();
  if (legacyResult.error && !isMissingTableError(legacyResult.error, "drps_campaigns")) {
    throw new Error("Could not load DRPS campaign.");
  }
  if (!legacyResult.data) return { campaign: null, source: "legacy" };

  return {
    campaign: {
      id: legacyResult.data.campaign_id,
      name: legacyResult.data.campaign_name,
      publicSlug: null,
      status: legacyResult.data.status,
      startsAt: legacyResult.data.start_date ? new Date(legacyResult.data.start_date).toISOString() : null,
      closesAt: legacyResult.data.end_date ? new Date(legacyResult.data.end_date).toISOString() : null,
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
      throw new Error("Could not load campaign summary.");
    }
    const rows = responsesResult.data ?? [];
    const latestResponseAt = rows.reduce<string | null>((latest, row) => {
      if (!latest) return row.submitted_at;
      return row.submitted_at > latest ? row.submitted_at : latest;
    }, null);
    return { responseCount: rows.length, latestResponseAt };
  }

  const legacyResponsesResult = await supabase
    .from("employee_responses")
    .select("submitted_at")
    .eq("campaign_id", campaignId)
    .returns<ResponseRow[]>();
  if (legacyResponsesResult.error && !isMissingTableError(legacyResponsesResult.error, "employee_responses")) {
    throw new Error("Could not load campaign summary.");
  }
  const rows = legacyResponsesResult.data ?? [];
  const latestResponseAt = rows.reduce<string | null>((latest, row) => {
    if (!latest) return row.submitted_at;
    return row.submitted_at > latest ? row.submitted_at : latest;
  }, null);
  return { responseCount: rows.length, latestResponseAt };
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

async function loadLibrarySessionRecord(
  sessionLibraryId: string,
): Promise<InheritedSessionRecord | null> {
  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("continuous_program_session_library")
    .select("session_library_id,title,notes,preparation_required,materials")
    .eq("session_library_id", sessionLibraryId)
    .maybeSingle<SessionLibraryRow>();

  if (result.error) {
    if (isMissingTableError(result.error, "continuous_program_session_library")) {
      return null;
    }
    throw new Error("Could not load inherited session record.");
  }
  if (!result.data) return null;

  return {
    id: `library-${result.data.session_library_id}`,
    title: result.data.title?.trim() || "Sessao",
    notes: normalizeNotes(result.data.notes),
    preparationRequired: normalizeNotes(result.data.preparation_required),
    materials: parseContinuousProgramMaterials(result.data.materials),
  };
}

async function loadInheritedSessionRecord(params: {
  sessionId: string | null | undefined;
  programId: string | null | undefined;
}): Promise<InheritedSessionRecord | null> {
  const sessionId = params.sessionId?.trim() ?? "";
  if (!sessionId) return null;

  if (sessionId.startsWith("library-")) {
    const libraryId = sessionId.slice("library-".length).trim();
    if (!libraryId) return null;
    return loadLibrarySessionRecord(libraryId);
  }

  const programId = params.programId?.trim() ?? "";
  if (programId) {
    const supabase = getSupabaseAdminClient();
    const programResult = await supabase
      .from("periodic_programs")
      .select("program_id,sessions,materials")
      .eq("program_id", programId)
      .maybeSingle<ProgramSessionsRow>();

    if (programResult.error) {
      if (
        isMissingTableError(programResult.error, "periodic_programs") ||
        isMissingColumnError(programResult.error, "sessions") ||
        isMissingColumnError(programResult.error, "materials")
      ) {
        return null;
      }
      throw new Error("Could not load inherited session record.");
    }

    if (programResult.data) {
      const sessions = parseContinuousProgramSessions(programResult.data.sessions, {
        fallbackMaterials: programResult.data.materials,
      });
      const matched = sessions.find((session) => session.id === sessionId);
      if (matched) {
        return {
          id: matched.id,
          title: matched.title,
          notes: matched.notes,
          preparationRequired: matched.preparationRequired,
          materials: matched.materials,
        };
      }
    }
  }

  const libraryFallback = await loadLibrarySessionRecord(sessionId);
  if (!libraryFallback) return null;
  return {
    ...libraryFallback,
    id: sessionId,
  };
}

function mergeInheritedSessionDetails(
  details: ReturnType<typeof extractCalendarEventDetails>,
  inheritedSession: InheritedSessionRecord | null,
) {
  if (!inheritedSession) return details;
  return {
    ...details,
    sessionId: inheritedSession.id,
    sessionTitle: inheritedSession.title,
    content: inheritedSession.notes,
    preparationRequired: inheritedSession.preparationRequired,
    sessionMaterials: inheritedSession.materials,
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientSlug: string; eventId: string }> },
) {
  const { clientSlug, eventId } = await context.params;

  try {
    const client = await loadClientBySlug(clientSlug);
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    if (eventId.startsWith("drps-start-") || eventId.startsWith("drps-close-")) {
      const eventType = eventId.startsWith("drps-start-") ? "drps_start" : "drps_close";
      const campaignId =
        eventType === "drps_start"
          ? eventId.slice("drps-start-".length)
          : eventId.slice("drps-close-".length);

      const campaignLoaded = await loadCampaignById(client.client_id, campaignId);
      if (!campaignLoaded.campaign) {
        return NextResponse.json({ error: "Event record not found." }, { status: 404 });
      }

      const eventAt =
        eventType === "drps_start"
          ? campaignLoaded.campaign.startsAt
          : campaignLoaded.campaign.closesAt;
      if (!eventAt) {
        return NextResponse.json({ error: "Event record has no date." }, { status: 404 });
      }

      const [summary, latestDrps, journal] = await Promise.all([
        loadCampaignResponseSummary(campaignLoaded.campaign.id, campaignLoaded.source),
        campaignLoaded.source === "modern"
          ? loadLatestDrps(campaignLoaded.campaign.id)
          : Promise.resolve({ latest: null, unavailable: false }),
        loadEventJournalForClient(eventId, client.client_id),
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
          details: {
            content: null,
            preparationRequired: null,
            eventLifecycle: "committed",
            proposalKind: null,
            availabilityRequestId: null,
          },
          journal,
          related: {
            campaign: campaignLoaded.campaign,
            programAssignment: null,
          },
          diagnostics: {
            responseCount: summary.responseCount,
            latestResponseAt: summary.latestResponseAt,
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
      .eq("client_id", client.client_id)
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
      ? await loadProgramAssignment(client.client_id, eventResult.data.source_client_program_id)
      : { assignment: null, programTitle: null };
    const assignment = programAssignmentLoaded.assignment;
    const [journal, inheritedSession] = await Promise.all([
      loadEventJournalForClient(eventId, client.client_id),
      loadInheritedSessionRecord({
        sessionId: details.sessionId ?? null,
        programId: assignment?.program_id ?? null,
      }),
    ]);
    const mergedDetails = mergeInheritedSessionDetails(details, inheritedSession);

    return NextResponse.json({
      record: {
        id: eventResult.data.event_id,
        recordType: "calendar",
        eventType: eventResult.data.event_type,
        title: eventResult.data.title,
        status: eventResult.data.status,
        startsAt: eventResult.data.starts_at,
        endsAt: eventResult.data.ends_at,
        details: mergedDetails,
        journal,
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
