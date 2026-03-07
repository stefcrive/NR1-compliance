import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import {
  CONTINUOUS_PROGRAM_MAX_SESSIONS,
  flattenContinuousProgramSessionMaterials,
  parseContinuousProgramMaterials,
  parseContinuousProgramSessions,
} from "@/lib/continuous-programs";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ProgramSessionsRow = {
  program_id: string;
  title: string;
  target_risk_topic: number | string;
  trigger_threshold: number | string;
  sessions?: unknown;
  materials?: unknown;
};

type ProgramSessionAssignmentRow = {
  program_id: string;
  title: string;
  sessions?: unknown;
  materials?: unknown;
};

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
  created_at: string;
  updated_at: string;
};

const PROGRAM_SESSIONS_SELECT =
  "program_id,title,target_risk_topic,trigger_threshold,sessions,materials";
const PROGRAM_SESSION_ASSIGNMENT_SELECT = "program_id,title,sessions,materials";
const SESSION_LIBRARY_BASE_SELECT =
  "session_library_id,title,notes,preparation_required,materials,created_at,updated_at";
const SESSION_LIBRARY_SELECT = `${SESSION_LIBRARY_BASE_SELECT},module_order,module_title,topic_order,topic_title`;

const assignSessionsSchema = z.object({
  action: z.literal("assign").optional(),
  targetProgramId: z.string().trim().min(1).max(120),
  sessions: z
    .array(
      z.object({
        catalogId: z.string().trim().min(1).max(260),
      }),
    )
    .min(1)
    .max(CONTINUOUS_PROGRAM_MAX_SESSIONS),
});

const createLibrarySessionSchema = z.object({
  action: z.literal("create").optional(),
  title: z.string().trim().min(3).max(240),
  notes: z.string().trim().max(5000).nullable().optional(),
  preparationRequired: z.string().trim().max(1500).nullable().optional(),
  moduleTitle: z.string().trim().min(1).max(240).optional(),
});

function migrationError() {
  return NextResponse.json(
    {
      error:
        "Program sessions/materials columns are missing. Apply migrations 20260302190000_continuous_program_details.sql, 20260307090000_continuous_program_sessions.sql and 20260307110000_continuous_program_session_library.sql.",
    },
    { status: 409 },
  );
}

function sessionLibraryTopicMigrationError() {
  return NextResponse.json(
    {
      error:
        "Session library topic/module columns are missing. Apply migration 20260307153000_session_library_topics_modules_seed.sql.",
    },
    { status: 409 },
  );
}

function programCatalogId(programId: string, sessionId: string) {
  return `program:${programId}::${sessionId}`;
}

function libraryCatalogId(librarySessionId: string) {
  return `library:${librarySessionId}`;
}

type DecodedCatalogRef =
  | { sourceType: "program"; programId: string; sessionId: string }
  | { sourceType: "library"; librarySessionId: string };

function decodeCatalogId(value: string): DecodedCatalogRef | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.startsWith("library:")) {
    const librarySessionId = normalized.slice("library:".length).trim();
    if (!librarySessionId) return null;
    return { sourceType: "library", librarySessionId };
  }
  if (normalized.startsWith("program:")) {
    const rest = normalized.slice("program:".length);
    const delimiterIndex = rest.indexOf("::");
    if (delimiterIndex <= 0) return null;
    const programId = rest.slice(0, delimiterIndex).trim();
    const sessionId = rest.slice(delimiterIndex + 2).trim();
    if (!programId || !sessionId) return null;
    return { sourceType: "program", programId, sessionId };
  }

  const legacyDelimiterIndex = normalized.indexOf("::");
  if (legacyDelimiterIndex <= 0) return null;
  const programId = normalized.slice(0, legacyDelimiterIndex).trim();
  const sessionId = normalized.slice(legacyDelimiterIndex + 2).trim();
  if (!programId || !sessionId) return null;
  return { sourceType: "program", programId, sessionId };
}

async function loadLibrarySessions() {
  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("continuous_program_session_library")
    .select(SESSION_LIBRARY_SELECT)
    .order("module_order", { ascending: true })
    .order("topic_order", { ascending: true })
    .order("created_at", { ascending: false })
    .returns<SessionLibraryRow[]>();
  return result;
}

export async function GET(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  const [libraryResult, assignmentProgramsResult] = await Promise.all([
    loadLibrarySessions(),
    supabase
      .from("periodic_programs")
      .select(PROGRAM_SESSION_ASSIGNMENT_SELECT)
      .order("title", { ascending: true })
      .returns<ProgramSessionAssignmentRow[]>(),
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
    return NextResponse.json({ error: "Could not load session catalog." }, { status: 500 });
  }

  if (
    assignmentProgramsResult.error &&
    (isMissingColumnError(assignmentProgramsResult.error, "sessions") ||
      isMissingColumnError(assignmentProgramsResult.error, "materials"))
  ) {
    return migrationError();
  }
  if (
    assignmentProgramsResult.error &&
    !isMissingTableError(assignmentProgramsResult.error, "periodic_programs")
  ) {
    return NextResponse.json({ error: "Could not load session catalog." }, { status: 500 });
  }

  const assignedProgramsByLibrarySessionId = new Map<
    string,
    Array<{ programId: string; programTitle: string }>
  >();
  const assignedProgramIdsByLibrarySessionId = new Map<string, Set<string>>();

  for (const row of assignmentProgramsResult.data ?? []) {
    const sessions = parseContinuousProgramSessions(row.sessions, {
      fallbackMaterials: row.materials,
      minCount: 1,
    });
    for (const session of sessions) {
      if (!session.id.startsWith("library-")) continue;
      const librarySessionId = session.id.slice("library-".length).trim();
      if (!librarySessionId) continue;

      const consumedProgramIds =
        assignedProgramIdsByLibrarySessionId.get(librarySessionId) ?? new Set<string>();
      if (consumedProgramIds.has(row.program_id)) continue;
      consumedProgramIds.add(row.program_id);
      assignedProgramIdsByLibrarySessionId.set(librarySessionId, consumedProgramIds);

      const current = assignedProgramsByLibrarySessionId.get(librarySessionId) ?? [];
      current.push({
        programId: row.program_id,
        programTitle: row.title,
      });
      assignedProgramsByLibrarySessionId.set(librarySessionId, current);
    }
  }

  const libraryCatalog = (libraryResult.data ?? []).map((session) => {
    const materials = parseContinuousProgramMaterials(session.materials);
    const moduleOrder = Number(session.module_order);
    const topicOrder = Number(session.topic_order);
    const moduleTitle = (session.module_title ?? "").trim() || "Modulo Livre";
    const topicTitle = (session.topic_title ?? "").trim() || session.title;
    const assignedPrograms = assignedProgramsByLibrarySessionId.get(session.session_library_id) ?? [];
    return {
      catalogId: libraryCatalogId(session.session_library_id),
      sourceType: "library" as const,
      sourceProgramId: null,
      sourceProgramTitle: moduleTitle,
      sourceTargetRiskTopic: null,
      sourceTriggerThreshold: null,
      sessionId: session.session_library_id,
      sessionIndex: null,
      sessionTitle: topicTitle,
      notes: session.notes,
      preparationRequired: session.preparation_required,
      materials,
      materialCount: materials.length,
      moduleOrder: Number.isFinite(moduleOrder) ? moduleOrder : null,
      moduleTitle,
      topicOrder: Number.isFinite(topicOrder) ? topicOrder : null,
      topicTitle,
      assignedPrograms,
      assignedProgramCount: assignedPrograms.length,
    };
  });

  return NextResponse.json({ sessions: libraryCatalog });
}

export async function POST(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const requestBody = await request.json().catch(() => null);
  if (!requestBody || typeof requestBody !== "object") {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const createParse = createLibrarySessionSchema.safeParse(requestBody);
  if (createParse.success) {
    const supabase = getSupabaseAdminClient();
    const resolvedModuleTitle = createParse.data.moduleTitle?.trim() || "Modulo Livre";

    let resolvedModuleOrder = 999;
    if (resolvedModuleTitle !== "Modulo Livre") {
      const existingModuleResult = await supabase
        .from("continuous_program_session_library")
        .select("module_order")
        .eq("module_title", resolvedModuleTitle)
        .order("module_order", { ascending: true })
        .limit(1)
        .maybeSingle<{ module_order: number | string | null }>();

      if (isMissingTableError(existingModuleResult.error, "continuous_program_session_library")) {
        return NextResponse.json(
          {
            error:
              "Session library table is missing. Apply migration 20260307110000_continuous_program_session_library.sql.",
          },
          { status: 409 },
        );
      }
      if (existingModuleResult.error && isMissingColumnError(existingModuleResult.error)) {
        return sessionLibraryTopicMigrationError();
      }
      if (existingModuleResult.error) {
        return NextResponse.json({ error: "Could not create session." }, { status: 500 });
      }

      const existingModuleOrder = Number(existingModuleResult.data?.module_order);
      if (Number.isFinite(existingModuleOrder)) {
        resolvedModuleOrder = existingModuleOrder;
      } else {
        const maxModuleOrderResult = await supabase
          .from("continuous_program_session_library")
          .select("module_order")
          .lt("module_order", 999)
          .order("module_order", { ascending: false })
          .limit(1)
          .maybeSingle<{ module_order: number | string | null }>();

        if (isMissingTableError(maxModuleOrderResult.error, "continuous_program_session_library")) {
          return NextResponse.json(
            {
              error:
                "Session library table is missing. Apply migration 20260307110000_continuous_program_session_library.sql.",
            },
            { status: 409 },
          );
        }
        if (maxModuleOrderResult.error && isMissingColumnError(maxModuleOrderResult.error)) {
          return sessionLibraryTopicMigrationError();
        }
        if (maxModuleOrderResult.error) {
          return NextResponse.json({ error: "Could not create session." }, { status: 500 });
        }

        const maxModuleOrder = Number(maxModuleOrderResult.data?.module_order);
        resolvedModuleOrder = Number.isFinite(maxModuleOrder) ? maxModuleOrder + 1 : 1;
      }
    }

    const maxTopicOrderByModuleResult = await supabase
      .from("continuous_program_session_library")
      .select("topic_order")
      .eq("module_title", resolvedModuleTitle)
      .order("topic_order", { ascending: false })
      .limit(1)
      .maybeSingle<{ topic_order: number | string | null }>();

    if (isMissingTableError(maxTopicOrderByModuleResult.error, "continuous_program_session_library")) {
      return NextResponse.json(
        {
          error:
            "Session library table is missing. Apply migration 20260307110000_continuous_program_session_library.sql.",
        },
        { status: 409 },
      );
    }
    if (maxTopicOrderByModuleResult.error && isMissingColumnError(maxTopicOrderByModuleResult.error)) {
      return sessionLibraryTopicMigrationError();
    }
    if (maxTopicOrderByModuleResult.error) {
      return NextResponse.json({ error: "Could not create session." }, { status: 500 });
    }

    const maxTopicOrderByModule = Number(maxTopicOrderByModuleResult.data?.topic_order);
    const resolvedTopicOrder = Number.isFinite(maxTopicOrderByModule) ? maxTopicOrderByModule + 1 : 1;

    const insertResult = await supabase
      .from("continuous_program_session_library")
      .insert({
        title: createParse.data.title.trim(),
        notes: createParse.data.notes?.trim() || null,
        preparation_required: createParse.data.preparationRequired?.trim() || null,
        materials: [],
        module_order: resolvedModuleOrder,
        module_title: resolvedModuleTitle,
        topic_order: resolvedTopicOrder,
        topic_title: createParse.data.title.trim(),
      })
      .select(SESSION_LIBRARY_SELECT)
      .maybeSingle<SessionLibraryRow>();

    if (isMissingTableError(insertResult.error, "continuous_program_session_library")) {
      return NextResponse.json(
        {
          error:
            "Session library table is missing. Apply migration 20260307110000_continuous_program_session_library.sql.",
        },
        { status: 409 },
      );
    }

    if (insertResult.error && isMissingColumnError(insertResult.error)) {
      return sessionLibraryTopicMigrationError();
    }

    if (insertResult.error) {
      return NextResponse.json({ error: "Could not create session." }, { status: 500 });
    }

    if (!insertResult.data) {
      return NextResponse.json({ error: "Could not create session." }, { status: 500 });
    }

    return NextResponse.json({
      session: {
        catalogId: libraryCatalogId(insertResult.data.session_library_id),
        sourceType: "library" as const,
        sourceProgramId: null,
        sourceProgramTitle: insertResult.data.module_title ?? "Modulo Livre",
        sourceTargetRiskTopic: null,
        sourceTriggerThreshold: null,
        sessionId: insertResult.data.session_library_id,
        sessionIndex: null,
        sessionTitle: insertResult.data.topic_title ?? insertResult.data.title,
        notes: insertResult.data.notes,
        preparationRequired: insertResult.data.preparation_required,
        materials: [],
        materialCount: 0,
        moduleOrder: Number(insertResult.data.module_order) || resolvedModuleOrder,
        moduleTitle: insertResult.data.module_title ?? resolvedModuleTitle,
        topicOrder: Number(insertResult.data.topic_order) || resolvedTopicOrder,
        topicTitle: insertResult.data.topic_title ?? insertResult.data.title,
        assignedPrograms: [],
        assignedProgramCount: 0,
      },
    });
  }

  let parsed: z.infer<typeof assignSessionsSchema>;
  try {
    parsed = assignSessionsSchema.parse(requestBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const decodedRefs = parsed.sessions
    .map((item) => decodeCatalogId(item.catalogId))
    .filter((item): item is DecodedCatalogRef => Boolean(item));
  if (decodedRefs.length === 0) {
    return NextResponse.json({ error: "No valid sessions were selected." }, { status: 400 });
  }

  const sourceProgramIds = new Set<string>([parsed.targetProgramId]);
  const requestedLibrarySessionIds = new Set<string>();
  for (const ref of decodedRefs) {
    if (ref.sourceType === "program") {
      sourceProgramIds.add(ref.programId);
    } else {
      requestedLibrarySessionIds.add(ref.librarySessionId);
    }
  }

  const requiredProgramIds = Array.from(
    sourceProgramIds,
  );

  const supabase = getSupabaseAdminClient();
  const programsResult = await supabase
    .from("periodic_programs")
    .select(PROGRAM_SESSIONS_SELECT)
    .in("program_id", requiredProgramIds)
    .returns<ProgramSessionsRow[]>();

  if (
    programsResult.error &&
    (isMissingColumnError(programsResult.error, "sessions") ||
      isMissingColumnError(programsResult.error, "materials"))
  ) {
    return migrationError();
  }

  if (
    programsResult.error &&
    !isMissingTableError(programsResult.error, "periodic_programs")
  ) {
    return NextResponse.json({ error: "Could not assign sessions." }, { status: 500 });
  }

  const rows = programsResult.data ?? [];
  const programById = new Map(rows.map((item) => [item.program_id, item]));
  const targetProgram = programById.get(parsed.targetProgramId);
  if (!targetProgram) {
    return NextResponse.json({ error: "Target program not found." }, { status: 404 });
  }

  const targetSessions = parseContinuousProgramSessions(targetProgram.sessions, {
    fallbackMaterials: targetProgram.materials,
    minCount: 1,
  });

  const sourceSessionsByRef = new Map<
    string,
    ReturnType<typeof parseContinuousProgramSessions>[number]
  >();
  for (const row of rows) {
    const parsedSessions = parseContinuousProgramSessions(row.sessions, {
      fallbackMaterials: row.materials,
      minCount: 1,
    });
    for (const session of parsedSessions) {
      sourceSessionsByRef.set(programCatalogId(row.program_id, session.id), session);
    }
  }

  const libraryById = new Map<string, SessionLibraryRow>();
  if (requestedLibrarySessionIds.size > 0) {
    const libraryResult = await supabase
      .from("continuous_program_session_library")
      .select(SESSION_LIBRARY_BASE_SELECT)
      .in("session_library_id", Array.from(requestedLibrarySessionIds))
      .returns<SessionLibraryRow[]>();

    if (isMissingTableError(libraryResult.error, "continuous_program_session_library")) {
      return NextResponse.json(
        {
          error:
            "Session library table is missing. Apply migration 20260307110000_continuous_program_session_library.sql.",
        },
        { status: 409 },
      );
    }

    if (libraryResult.error) {
      return NextResponse.json({ error: "Could not assign sessions." }, { status: 500 });
    }

    for (const row of libraryResult.data ?? []) {
      libraryById.set(row.session_library_id, row);
    }
  }

  const selectedSourceSessions: ReturnType<typeof parseContinuousProgramSessions>[number][] = [];
  const consumedCatalogIds = new Set<string>();
  for (const selected of parsed.sessions) {
    const decoded = decodeCatalogId(selected.catalogId);
    if (!decoded) continue;
    if (consumedCatalogIds.has(selected.catalogId)) continue;
    consumedCatalogIds.add(selected.catalogId);

    if (decoded.sourceType === "program") {
      const sourceSession = sourceSessionsByRef.get(programCatalogId(decoded.programId, decoded.sessionId));
      if (!sourceSession) continue;
      selectedSourceSessions.push({
        id: sourceSession.id,
        title: sourceSession.title,
        notes: sourceSession.notes,
        preparationRequired: sourceSession.preparationRequired,
        materials: sourceSession.materials.map((material) => ({ ...material })),
      });
      continue;
    }

    const sourceLibrarySession = libraryById.get(decoded.librarySessionId);
    if (!sourceLibrarySession) continue;
    selectedSourceSessions.push({
      id: `library-${sourceLibrarySession.session_library_id}`,
      title: sourceLibrarySession.title,
      notes: sourceLibrarySession.notes,
      preparationRequired: sourceLibrarySession.preparation_required,
      materials: parseContinuousProgramMaterials(sourceLibrarySession.materials),
    });
  }

  if (selectedSourceSessions.length === 0) {
    return NextResponse.json({ error: "No valid sessions were selected." }, { status: 400 });
  }

  if (targetSessions.length + selectedSourceSessions.length > CONTINUOUS_PROGRAM_MAX_SESSIONS) {
    return NextResponse.json(
      {
        error: `Cannot exceed ${CONTINUOUS_PROGRAM_MAX_SESSIONS} sessions per program.`,
      },
      { status: 400 },
    );
  }

  const nextSessions = parseContinuousProgramSessions(
    [...targetSessions, ...selectedSourceSessions],
    { minCount: 1 },
  );
  const nextMaterials = flattenContinuousProgramSessionMaterials(nextSessions);

  const updateResult = await supabase
    .from("periodic_programs")
    .update({ sessions: nextSessions, materials: nextMaterials })
    .eq("program_id", parsed.targetProgramId)
    .select("program_id")
    .maybeSingle<{ program_id: string }>();

  if (
    updateResult.error &&
    !isMissingTableError(updateResult.error, "periodic_programs")
  ) {
    return NextResponse.json({ error: "Could not assign sessions." }, { status: 500 });
  }

  if (!updateResult.data) {
    return NextResponse.json({ error: "Target program not found." }, { status: 404 });
  }

  return NextResponse.json({
    targetProgramId: parsed.targetProgramId,
    sessionsAdded: selectedSourceSessions.length,
    totalSessions: nextSessions.length,
  });
}
