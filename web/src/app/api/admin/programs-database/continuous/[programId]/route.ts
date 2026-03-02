import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type PeriodicProgramRow = {
  program_id: string;
  title: string;
  description: string | null;
  target_risk_topic: number | string;
  trigger_threshold: number | string;
};

type ClientProgramStatusRow = {
  status: "Recommended" | "Active" | "Completed";
};

const updateProgramSchema = z
  .object({
    title: z.string().trim().min(3).max(255).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    targetRiskTopic: z.number().int().min(1).max(13).optional(),
    triggerThreshold: z.number().min(1).max(3).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

function summarizeAssignments(rows: ClientProgramStatusRow[] | null | undefined) {
  const summary = {
    total: 0,
    recommended: 0,
    active: 0,
    completed: 0,
  };

  for (const row of rows ?? []) {
    summary.total += 1;
    if (row.status === "Recommended") summary.recommended += 1;
    if (row.status === "Active") summary.active += 1;
    if (row.status === "Completed") summary.completed += 1;
  }

  return summary;
}

function mapProgram(row: PeriodicProgramRow, assignments: ReturnType<typeof summarizeAssignments>) {
  return {
    id: row.program_id,
    title: row.title,
    description: row.description,
    targetRiskTopic: Number(row.target_risk_topic),
    triggerThreshold: Number(row.trigger_threshold),
    assignments,
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ programId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { programId } = await context.params;
  const supabase = getSupabaseAdminClient();

  const periodicResult = await supabase
    .from("periodic_programs")
    .select("program_id,title,description,target_risk_topic,trigger_threshold")
    .eq("program_id", programId)
    .maybeSingle<PeriodicProgramRow>();

  if (
    periodicResult.error &&
    !isMissingTableError(periodicResult.error, "periodic_programs")
  ) {
    return NextResponse.json({ error: "Could not load continuous program." }, { status: 500 });
  }

  if (!periodicResult.data) {
    return NextResponse.json({ error: "Continuous program not found." }, { status: 404 });
  }

  const assignmentsResult = await supabase
    .from("client_programs")
    .select("status")
    .eq("program_id", programId)
    .returns<ClientProgramStatusRow[]>();

  if (
    assignmentsResult.error &&
    !isMissingTableError(assignmentsResult.error, "client_programs")
  ) {
    return NextResponse.json({ error: "Could not load continuous program." }, { status: 500 });
  }

  return NextResponse.json({
    program: mapProgram(periodicResult.data, summarizeAssignments(assignmentsResult.data)),
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ programId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { programId } = await context.params;
  let parsed: z.infer<typeof updateProgramSchema>;
  try {
    parsed = updateProgramSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const payload = {
    ...(parsed.title !== undefined ? { title: parsed.title } : {}),
    ...(parsed.description !== undefined
      ? { description: parsed.description && parsed.description.length > 0 ? parsed.description : null }
      : {}),
    ...(parsed.targetRiskTopic !== undefined ? { target_risk_topic: parsed.targetRiskTopic } : {}),
    ...(parsed.triggerThreshold !== undefined
      ? { trigger_threshold: Number(parsed.triggerThreshold.toFixed(2)) }
      : {}),
  };

  const supabase = getSupabaseAdminClient();
  const updateResult = await supabase
    .from("periodic_programs")
    .update(payload)
    .eq("program_id", programId)
    .select("program_id,title,description,target_risk_topic,trigger_threshold")
    .maybeSingle<PeriodicProgramRow>();

  if (
    updateResult.error &&
    !isMissingTableError(updateResult.error, "periodic_programs")
  ) {
    return NextResponse.json({ error: "Could not update continuous program." }, { status: 500 });
  }

  if (!updateResult.data) {
    return NextResponse.json({ error: "Continuous program not found." }, { status: 404 });
  }

  const assignmentsResult = await supabase
    .from("client_programs")
    .select("status")
    .eq("program_id", programId)
    .returns<ClientProgramStatusRow[]>();

  if (
    assignmentsResult.error &&
    !isMissingTableError(assignmentsResult.error, "client_programs")
  ) {
    return NextResponse.json({ error: "Could not update continuous program." }, { status: 500 });
  }

  return NextResponse.json({
    program: mapProgram(updateResult.data, summarizeAssignments(assignmentsResult.data)),
  });
}
