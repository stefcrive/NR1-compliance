import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import {
  parseContinuousProgramMaterials,
  parseContinuousProgramSessions,
} from "@/lib/continuous-programs";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type SessionLibraryRow = {
  session_library_id: string;
  title: string;
  notes: string | null;
  preparation_required: string | null;
  materials: unknown;
  module_order?: number | string | null;
  module_title?: string | null;
  topic_order?: number | string | null;
  topic_title?: string | null;
};

type ProgramSessionsRow = {
  program_id: string;
  title: string;
  sessions?: unknown;
  materials?: unknown;
};

const SESSION_LIBRARY_SELECT =
  "session_library_id,title,notes,preparation_required,materials,module_order,module_title,topic_order,topic_title";
const PROGRAM_SESSIONS_SELECT = "program_id,title,sessions,materials";

const updateSessionSchema = z
  .object({
    title: z.string().trim().min(3).max(240).optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    preparationRequired: z.string().trim().max(1500).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

function sessionLibraryTopicMigrationError() {
  return NextResponse.json(
    {
      error:
        "Session library topic/module columns are missing. Apply migration 20260307153000_session_library_topics_modules_seed.sql.",
    },
    { status: 409 },
  );
}

function sessionsMigrationError() {
  return NextResponse.json(
    {
      error:
        "Program sessions/materials columns are missing. Apply migrations 20260302190000_continuous_program_details.sql and 20260307090000_continuous_program_sessions.sql.",
    },
    { status: 409 },
  );
}

function mapSessionResponse(
  row: SessionLibraryRow,
  assignedPrograms: Array<{ programId: string; programTitle: string }>,
) {
  const moduleOrder = Number(row.module_order);
  const topicOrder = Number(row.topic_order);
  const moduleTitle = (row.module_title ?? "").trim() || "Modulo Livre";
  const topicTitle = (row.topic_title ?? "").trim() || row.title;
  const materials = parseContinuousProgramMaterials(row.materials);

  return {
    id: row.session_library_id,
    title: row.title,
    topicTitle,
    moduleTitle,
    moduleOrder: Number.isFinite(moduleOrder) ? moduleOrder : null,
    topicOrder: Number.isFinite(topicOrder) ? topicOrder : null,
    notes: row.notes,
    preparationRequired: row.preparation_required,
    materials,
    assignedPrograms,
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { sessionId } = await context.params;
  const normalizedSessionId = decodeURIComponent(sessionId).trim();
  if (!normalizedSessionId) {
    return NextResponse.json({ error: "Invalid session id." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const [libraryResult, programsResult] = await Promise.all([
    supabase
      .from("continuous_program_session_library")
      .select(SESSION_LIBRARY_SELECT)
      .eq("session_library_id", normalizedSessionId)
      .maybeSingle<SessionLibraryRow>(),
    supabase
      .from("periodic_programs")
      .select(PROGRAM_SESSIONS_SELECT)
      .order("title", { ascending: true })
      .returns<ProgramSessionsRow[]>(),
  ]);

  if (isMissingTableError(libraryResult.error, "continuous_program_session_library")) {
    return NextResponse.json(
      {
        error:
          "Session library table is missing. Apply migration 20260307110000_continuous_program_session_library.sql.",
      },
      { status: 409 },
    );
  }
  if (libraryResult.error && isMissingColumnError(libraryResult.error)) {
    return sessionLibraryTopicMigrationError();
  }
  if (libraryResult.error) {
    return NextResponse.json({ error: "Could not load session." }, { status: 500 });
  }
  if (!libraryResult.data) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  if (
    programsResult.error &&
    (isMissingColumnError(programsResult.error, "sessions") ||
      isMissingColumnError(programsResult.error, "materials"))
  ) {
    return sessionsMigrationError();
  }
  if (
    programsResult.error &&
    !isMissingTableError(programsResult.error, "periodic_programs")
  ) {
    return NextResponse.json({ error: "Could not load session." }, { status: 500 });
  }

  const assignedPrograms: Array<{ programId: string; programTitle: string }> = [];
  for (const row of programsResult.data ?? []) {
    const sessions = parseContinuousProgramSessions(row.sessions, {
      fallbackMaterials: row.materials,
      minCount: 1,
    });
    const hasSession = sessions.some(
      (session) =>
        session.id === `library-${normalizedSessionId}` || session.id === normalizedSessionId,
    );
    if (!hasSession) continue;
    assignedPrograms.push({
      programId: row.program_id,
      programTitle: row.title,
    });
  }

  return NextResponse.json({
    session: mapSessionResponse(libraryResult.data, assignedPrograms),
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { sessionId } = await context.params;
  const normalizedSessionId = decodeURIComponent(sessionId).trim();
  if (!normalizedSessionId) {
    return NextResponse.json({ error: "Invalid session id." }, { status: 400 });
  }

  let parsed: z.infer<typeof updateSessionSchema>;
  try {
    parsed = updateSessionSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const updatePayload: Record<string, unknown> = {};
  if (parsed.title !== undefined) {
    const title = parsed.title.trim();
    updatePayload.title = title;
    updatePayload.topic_title = title;
  }
  if (parsed.notes !== undefined) {
    const notes = parsed.notes?.trim() ?? "";
    updatePayload.notes = notes.length > 0 ? notes : null;
  }
  if (parsed.preparationRequired !== undefined) {
    const preparationRequired = parsed.preparationRequired?.trim() ?? "";
    updatePayload.preparation_required =
      preparationRequired.length > 0 ? preparationRequired : null;
  }

  const supabase = getSupabaseAdminClient();
  const [updateResult, programsResult] = await Promise.all([
    supabase
      .from("continuous_program_session_library")
      .update(updatePayload)
      .eq("session_library_id", normalizedSessionId)
      .select(SESSION_LIBRARY_SELECT)
      .maybeSingle<SessionLibraryRow>(),
    supabase
      .from("periodic_programs")
      .select(PROGRAM_SESSIONS_SELECT)
      .order("title", { ascending: true })
      .returns<ProgramSessionsRow[]>(),
  ]);

  if (isMissingTableError(updateResult.error, "continuous_program_session_library")) {
    return NextResponse.json(
      {
        error:
          "Session library table is missing. Apply migration 20260307110000_continuous_program_session_library.sql.",
      },
      { status: 409 },
    );
  }
  if (updateResult.error && isMissingColumnError(updateResult.error)) {
    return sessionLibraryTopicMigrationError();
  }
  if (updateResult.error) {
    return NextResponse.json({ error: "Could not update session." }, { status: 500 });
  }
  if (!updateResult.data) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  if (
    programsResult.error &&
    (isMissingColumnError(programsResult.error, "sessions") ||
      isMissingColumnError(programsResult.error, "materials"))
  ) {
    return sessionsMigrationError();
  }
  if (
    programsResult.error &&
    !isMissingTableError(programsResult.error, "periodic_programs")
  ) {
    return NextResponse.json({ error: "Could not update session." }, { status: 500 });
  }

  const assignedPrograms: Array<{ programId: string; programTitle: string }> = [];
  for (const row of programsResult.data ?? []) {
    const sessions = parseContinuousProgramSessions(row.sessions, {
      fallbackMaterials: row.materials,
      minCount: 1,
    });
    const hasSession = sessions.some(
      (session) =>
        session.id === `library-${normalizedSessionId}` || session.id === normalizedSessionId,
    );
    if (!hasSession) continue;
    assignedPrograms.push({
      programId: row.program_id,
      programTitle: row.title,
    });
  }

  return NextResponse.json({
    session: mapSessionResponse(updateResult.data, assignedPrograms),
  });
}
