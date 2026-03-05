import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import {
  deriveAttachmentTitle,
  EVENT_RECORD_ALLOWED_MIME_TYPES,
  EVENT_RECORD_MAX_FILE_SIZE_BYTES,
  EVENT_RECORD_STORAGE_BUCKET,
  inferAttachmentKind,
  parseEventRecordAttachments,
  sanitizeFileName,
  sanitizeStorageSegment,
  type EventRecordAttachment,
  type EventRecordJournal,
} from "@/lib/event-record-journal";
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

type CalendarEventLookupRow = Pick<
  CalendarEventRow,
  "event_id" | "client_id" | "source_client_program_id"
>;

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

type EventJournalRow = {
  event_id: string;
  client_id: string | null;
  notes: string | null;
  attachments: unknown;
};

const JOURNAL_NOTES_MAX_LENGTH = 8000;
const HISTORY_EVENT_RECORDS_MIGRATION = "20260304210000_history_event_records.sql";
const EVENT_DETAIL_TEXT_MAX_LENGTH = 1500;

const updateEventFieldsSchema = z
  .object({
    title: z.string().trim().min(3).max(160).optional(),
    status: z.enum(["scheduled", "completed", "cancelled"]).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    eventLifecycle: z.enum(["provisory", "committed"]).optional(),
    proposalKind: z.enum(["assignment", "reschedule"]).nullable().optional(),
    content: z.string().trim().max(EVENT_DETAIL_TEXT_MAX_LENGTH).nullable().optional(),
    preparationRequired: z
      .string()
      .trim()
      .max(EVENT_DETAIL_TEXT_MAX_LENGTH)
      .nullable()
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one editable event field must be provided.",
    path: ["title"],
  });

const updateJournalSchema = z
  .object({
    notes: z.string().trim().max(JOURNAL_NOTES_MAX_LENGTH).nullable().optional(),
    event: updateEventFieldsSchema.optional(),
  })
  .refine((value) => value.notes !== undefined || value.event !== undefined, {
    message: "At least one field must be provided.",
    path: ["notes"],
  });

const deleteAttachmentSchema = z.object({
  attachmentId: z.string().trim().min(1),
});

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

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function parseDrpsEvent(eventId: string):
  | { eventType: "drps_start" | "drps_close"; campaignId: string }
  | null {
  if (eventId.startsWith("drps-start-")) {
    return {
      eventType: "drps_start",
      campaignId: eventId.slice("drps-start-".length),
    };
  }
  if (eventId.startsWith("drps-close-")) {
    return {
      eventType: "drps_close",
      campaignId: eventId.slice("drps-close-".length),
    };
  }
  return null;
}

function historyEventRecordsMissingMessage() {
  return `Event records table unavailable. Apply migration ${HISTORY_EVENT_RECORDS_MIGRATION}.`;
}

async function loadEventJournal(eventId: string): Promise<EventRecordJournal> {
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

  return {
    notes: normalizeNotes(result.data.notes),
    attachments: parseEventRecordAttachments(result.data.attachments),
    available: true,
  };
}

async function loadEventJournalRowForWrite(eventId: string) {
  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("history_event_records")
    .select("event_id,client_id,notes,attachments")
    .eq("event_id", eventId)
    .maybeSingle<EventJournalRow>();

  if (result.error) {
    if (isMissingTableError(result.error, "history_event_records")) {
      return { row: null, unavailable: true };
    }
    throw new Error("Could not load event journal.");
  }

  return { row: result.data ?? null, unavailable: false };
}

async function resolveEventClientIdForJournal(eventId: string): Promise<{
  clientId: string | null;
  notFound: boolean;
  calendarUnavailable: boolean;
}> {
  const drps = parseDrpsEvent(eventId);
  if (drps) {
    const campaignLoaded = await loadCampaignById(drps.campaignId);
    if (!campaignLoaded.campaign) {
      return { clientId: null, notFound: true, calendarUnavailable: false };
    }
    return {
      clientId: campaignLoaded.campaign.clientId,
      notFound: false,
      calendarUnavailable: false,
    };
  }

  const supabase = getSupabaseAdminClient();
  const eventResult = await supabase
    .from("calendar_events")
    .select("event_id,client_id,source_client_program_id")
    .eq("event_id", eventId)
    .maybeSingle<CalendarEventLookupRow>();

  if (eventResult.error) {
    if (isMissingTableError(eventResult.error, "calendar_events")) {
      return { clientId: null, notFound: false, calendarUnavailable: true };
    }
    throw new Error("Could not load event record.");
  }

  if (!eventResult.data) {
    return { clientId: null, notFound: true, calendarUnavailable: false };
  }

  let clientId = eventResult.data.client_id;
  if (!clientId && eventResult.data.source_client_program_id) {
    const assignmentLoaded = await loadProgramAssignment(eventResult.data.source_client_program_id);
    clientId = assignmentLoaded.assignment?.client_id ?? null;
  }

  return {
    clientId,
    notFound: false,
    calendarUnavailable: false,
  };
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
    const drpsEvent = parseDrpsEvent(eventId);
    if (drpsEvent) {
      const campaignLoaded = await loadCampaignById(drpsEvent.campaignId);
      if (!campaignLoaded.campaign) {
        return NextResponse.json({ error: "Event record not found." }, { status: 404 });
      }

      const eventAt =
        drpsEvent.eventType === "drps_start"
          ? campaignLoaded.campaign.startsAt
          : campaignLoaded.campaign.closesAt;
      if (!eventAt) {
        return NextResponse.json({ error: "Event record has no schedule date." }, { status: 404 });
      }

      const [client, responseSummary, latestDrps, journal] = await Promise.all([
        loadClientById(campaignLoaded.campaign.clientId),
        loadCampaignResponseSummary(campaignLoaded.campaign.id, campaignLoaded.source),
        campaignLoaded.source === "modern"
          ? loadLatestDrps(campaignLoaded.campaign.id)
          : Promise.resolve({ latest: null, unavailable: false }),
        loadEventJournal(eventId),
      ]);

      return NextResponse.json({
        record: {
          id: eventId,
          recordType: "drps",
          eventType: drpsEvent.eventType,
          title:
            drpsEvent.eventType === "drps_start"
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
          journal,
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
    const [client, journal] = await Promise.all([
      loadClientById(clientId),
      loadEventJournal(eventId),
    ]);

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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { eventId } = await context.params;
  let parsed: z.infer<typeof updateJournalSchema>;
  try {
    parsed = updateJournalSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  try {
    const resolved = await resolveEventClientIdForJournal(eventId);
    if (resolved.calendarUnavailable) {
      return NextResponse.json(
        {
          error:
            "Master calendar table unavailable. Apply migration 20260302220000_master_calendar_availability.sql.",
        },
        { status: 412 },
      );
    }
    if (resolved.notFound) {
      return NextResponse.json({ error: "Event record not found." }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    const supabase = getSupabaseAdminClient();
    let responseJournal: EventRecordJournal | null = null;

    if (parsed.notes !== undefined) {
      const notes = normalizeNotes(parsed.notes);
      const updateResult = await supabase
        .from("history_event_records")
        .upsert(
          {
            event_id: eventId,
            client_id: resolved.clientId,
            notes,
            updated_at: nowIso,
            updated_by: "manager",
          },
          { onConflict: "event_id" },
        )
        .select("notes,attachments")
        .maybeSingle<Pick<EventJournalRow, "notes" | "attachments">>();

      if (updateResult.error) {
        if (isMissingTableError(updateResult.error, "history_event_records")) {
          return NextResponse.json(
            { error: historyEventRecordsMissingMessage() },
            { status: 412 },
          );
        }
        return NextResponse.json({ error: "Could not update event journal." }, { status: 500 });
      }

      if (!updateResult.data) {
        return NextResponse.json({ error: "Could not update event journal." }, { status: 500 });
      }

      responseJournal = {
        notes: normalizeNotes(updateResult.data.notes),
        attachments: parseEventRecordAttachments(updateResult.data.attachments),
        available: true,
      };
    }

    if (parsed.event) {
      if (parseDrpsEvent(eventId)) {
        return NextResponse.json(
          { error: "DRPS history records are read-only for event fields." },
          { status: 409 },
        );
      }

      const currentEventResult = await supabase
        .from("calendar_events")
        .select(
          "event_id,client_id,source_client_program_id,event_type,title,starts_at,ends_at,status,metadata",
        )
        .eq("event_id", eventId)
        .maybeSingle<CalendarEventRow>();

      if (currentEventResult.error) {
        if (isMissingTableError(currentEventResult.error, "calendar_events")) {
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
      if (!currentEventResult.data) {
        return NextResponse.json({ error: "Event record not found." }, { status: 404 });
      }

      const currentEvent = currentEventResult.data;
      const nextStartsAt = parsed.event.startsAt
        ? new Date(parsed.event.startsAt).toISOString()
        : currentEvent.starts_at;
      const nextEndsAt = parsed.event.endsAt
        ? new Date(parsed.event.endsAt).toISOString()
        : currentEvent.ends_at;
      if (new Date(nextEndsAt).getTime() <= new Date(nextStartsAt).getTime()) {
        return NextResponse.json({ error: "Invalid time range." }, { status: 400 });
      }

      const mergedMetadata = normalizeMetadata(currentEvent.metadata);
      let shouldUpdateMetadata = false;
      if (parsed.event.content !== undefined) {
        mergedMetadata.content = parsed.event.content?.trim() || null;
        shouldUpdateMetadata = true;
      }
      if (parsed.event.preparationRequired !== undefined) {
        mergedMetadata.preparationRequired = parsed.event.preparationRequired?.trim() || null;
        delete mergedMetadata.preparation_required;
        shouldUpdateMetadata = true;
      }
      if (parsed.event.eventLifecycle !== undefined) {
        mergedMetadata.eventLifecycle = parsed.event.eventLifecycle;
        shouldUpdateMetadata = true;
      }
      if (parsed.event.proposalKind !== undefined) {
        mergedMetadata.proposalKind = parsed.event.proposalKind;
        shouldUpdateMetadata = true;
      }

      const updatePayload: Record<string, unknown> = {
        updated_at: nowIso,
      };
      if (parsed.event.title !== undefined) {
        updatePayload.title = parsed.event.title;
      }
      if (parsed.event.status !== undefined) {
        updatePayload.status = parsed.event.status;
      }
      if (parsed.event.startsAt !== undefined || parsed.event.endsAt !== undefined) {
        updatePayload.starts_at = nextStartsAt;
        updatePayload.ends_at = nextEndsAt;
      }
      if (shouldUpdateMetadata) {
        updatePayload.metadata = mergedMetadata;
      }

      const updateEventResult = await supabase
        .from("calendar_events")
        .update(updatePayload)
        .eq("event_id", eventId);
      if (updateEventResult.error) {
        return NextResponse.json({ error: "Could not update event fields." }, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true,
      ...(responseJournal ? { journal: responseJournal } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not update event journal.",
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { eventId } = await context.params;

  try {
    const resolved = await resolveEventClientIdForJournal(eventId);
    if (resolved.calendarUnavailable) {
      return NextResponse.json(
        {
          error:
            "Master calendar table unavailable. Apply migration 20260302220000_master_calendar_availability.sql.",
        },
        { status: 412 },
      );
    }
    if (resolved.notFound) {
      return NextResponse.json({ error: "Event record not found." }, { status: 404 });
    }

    const form = await request.formData();
    const fileValue = form.get("file");
    if (!(fileValue instanceof File)) {
      return NextResponse.json({ error: "File is required." }, { status: 400 });
    }
    if (fileValue.size > EVENT_RECORD_MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 15 MB." },
        { status: 400 },
      );
    }

    if (
      fileValue.type &&
      !EVENT_RECORD_ALLOWED_MIME_TYPES.includes(
        fileValue.type as (typeof EVENT_RECORD_ALLOWED_MIME_TYPES)[number],
      )
    ) {
      return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });
    }

    const loadedJournal = await loadEventJournalRowForWrite(eventId);
    if (loadedJournal.unavailable) {
      return NextResponse.json(
        { error: historyEventRecordsMissingMessage() },
        { status: 412 },
      );
    }
    const currentAttachments = parseEventRecordAttachments(loadedJournal.row?.attachments);
    const currentNotes = normalizeNotes(loadedJournal.row?.notes ?? null);

    const mimeType = fileValue.type || "application/octet-stream";
    const safeName = sanitizeFileName(fileValue.name);
    const eventSegment = sanitizeStorageSegment(eventId);
    const storagePath = `${eventSegment}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
    const titleValue = String(form.get("title") ?? "")
      .trim()
      .slice(0, 240);
    const attachment: EventRecordAttachment = {
      id: randomUUID(),
      title: titleValue.length > 0 ? titleValue : deriveAttachmentTitle(fileValue.name),
      fileName: fileValue.name,
      mimeType,
      sizeBytes: fileValue.size,
      uploadedAt: new Date().toISOString(),
      storagePath,
      downloadUrl: "",
      kind: inferAttachmentKind(mimeType),
    };

    const supabase = getSupabaseAdminClient();
    const uploadResult = await supabase.storage.from(EVENT_RECORD_STORAGE_BUCKET).upload(storagePath, fileValue, {
      cacheControl: "3600",
      contentType: mimeType,
      upsert: false,
    });
    if (uploadResult.error) {
      return NextResponse.json(
        { error: `Could not upload attachment: ${uploadResult.error.message}` },
        { status: 500 },
      );
    }

    const publicUrl = supabase.storage.from(EVENT_RECORD_STORAGE_BUCKET).getPublicUrl(storagePath);
    attachment.downloadUrl = publicUrl.data.publicUrl;
    const nextAttachments = [...currentAttachments, attachment];

    const nowIso = new Date().toISOString();
    const updateResult = await supabase
      .from("history_event_records")
      .upsert(
        {
          event_id: eventId,
          client_id: resolved.clientId ?? loadedJournal.row?.client_id ?? null,
          notes: currentNotes,
          attachments: nextAttachments,
          updated_at: nowIso,
          updated_by: "manager",
        },
        { onConflict: "event_id" },
      )
      .select("notes,attachments")
      .maybeSingle<Pick<EventJournalRow, "notes" | "attachments">>();

    if (updateResult.error) {
      if (isMissingTableError(updateResult.error, "history_event_records")) {
        await supabase.storage.from(EVENT_RECORD_STORAGE_BUCKET).remove([storagePath]);
        return NextResponse.json(
          { error: historyEventRecordsMissingMessage() },
          { status: 412 },
        );
      }
      await supabase.storage.from(EVENT_RECORD_STORAGE_BUCKET).remove([storagePath]);
      return NextResponse.json({ error: "Could not save attachment metadata." }, { status: 500 });
    }

    if (!updateResult.data) {
      await supabase.storage.from(EVENT_RECORD_STORAGE_BUCKET).remove([storagePath]);
      return NextResponse.json({ error: "Could not save attachment metadata." }, { status: 500 });
    }

    return NextResponse.json(
      {
        attachment,
        journal: {
          notes: normalizeNotes(updateResult.data.notes),
          attachments: parseEventRecordAttachments(updateResult.data.attachments),
          available: true,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not upload attachment.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { eventId } = await context.params;
  let parsed: z.infer<typeof deleteAttachmentSchema>;
  try {
    parsed = deleteAttachmentSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  try {
    const resolved = await resolveEventClientIdForJournal(eventId);
    if (resolved.calendarUnavailable) {
      return NextResponse.json(
        {
          error:
            "Master calendar table unavailable. Apply migration 20260302220000_master_calendar_availability.sql.",
        },
        { status: 412 },
      );
    }
    if (resolved.notFound) {
      return NextResponse.json({ error: "Event record not found." }, { status: 404 });
    }

    const loadedJournal = await loadEventJournalRowForWrite(eventId);
    if (loadedJournal.unavailable) {
      return NextResponse.json(
        { error: historyEventRecordsMissingMessage() },
        { status: 412 },
      );
    }
    if (!loadedJournal.row) {
      return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
    }

    const currentAttachments = parseEventRecordAttachments(loadedJournal.row.attachments);
    const target = currentAttachments.find((item) => item.id === parsed.attachmentId) ?? null;
    if (!target) {
      return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
    }

    const nextAttachments = currentAttachments.filter((item) => item.id !== parsed.attachmentId);
    const supabase = getSupabaseAdminClient();
    const nowIso = new Date().toISOString();
    const updateResult = await supabase
      .from("history_event_records")
      .update({
        attachments: nextAttachments,
        updated_at: nowIso,
        updated_by: "manager",
      })
      .eq("event_id", eventId)
      .select("notes,attachments")
      .maybeSingle<Pick<EventJournalRow, "notes" | "attachments">>();

    if (updateResult.error) {
      if (isMissingTableError(updateResult.error, "history_event_records")) {
        return NextResponse.json(
          { error: historyEventRecordsMissingMessage() },
          { status: 412 },
        );
      }
      return NextResponse.json({ error: "Could not remove attachment." }, { status: 500 });
    }
    if (!updateResult.data) {
      return NextResponse.json({ error: "Could not remove attachment." }, { status: 500 });
    }

    if (target.storagePath) {
      await supabase.storage.from(EVENT_RECORD_STORAGE_BUCKET).remove([target.storagePath]);
    }

    return NextResponse.json({
      ok: true,
      journal: {
        notes: normalizeNotes(updateResult.data.notes),
        attachments: parseEventRecordAttachments(updateResult.data.attachments),
        available: true,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not remove attachment.",
      },
      { status: 500 },
    );
  }
}
