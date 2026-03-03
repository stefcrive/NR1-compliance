import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ClientProgramRow = {
  client_program_id: string;
  program_id: string;
  status: "Recommended" | "Active" | "Completed";
  deployed_at: string;
};

const updateAssignmentSchema = z
  .object({
    status: z.enum(["Recommended", "Active", "Completed"]).optional(),
    deployedAt: z.string().datetime().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ clientId: string; assignmentId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { clientId, assignmentId } = await context.params;
  let parsed: z.infer<typeof updateAssignmentSchema>;
  try {
    parsed = updateAssignmentSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const updatePayload = {
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
    ...(parsed.deployedAt !== undefined ? { deployed_at: parsed.deployedAt } : {}),
  };

  const supabase = getSupabaseAdminClient();
  const updateResult = await supabase
    .from("client_programs")
    .update(updatePayload)
    .eq("client_id", clientId)
    .eq("client_program_id", assignmentId)
    .select("client_program_id,program_id,status,deployed_at")
    .maybeSingle<ClientProgramRow>();

  if (updateResult.error) {
    if (isMissingTableError(updateResult.error, "client_programs")) {
      return NextResponse.json(
        {
          error:
            "Assignments table is unavailable. Apply migration 20260301173000_seed_b2b_multitenant_compliance.sql.",
        },
        { status: 412 },
      );
    }
    return NextResponse.json({ error: "Could not update assignment." }, { status: 500 });
  }

  if (!updateResult.data) {
    return NextResponse.json({ error: "Assignment not found for this company." }, { status: 404 });
  }

  return NextResponse.json({
    assignment: {
      id: updateResult.data.client_program_id,
      programId: updateResult.data.program_id,
      status: updateResult.data.status,
      deployedAt: updateResult.data.deployed_at,
    },
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ clientId: string; assignmentId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { clientId, assignmentId } = await context.params;
  const supabase = getSupabaseAdminClient();
  const deleteResult = await supabase
    .from("client_programs")
    .delete()
    .eq("client_id", clientId)
    .eq("client_program_id", assignmentId)
    .select("client_program_id")
    .maybeSingle<{ client_program_id: string }>();

  if (deleteResult.error) {
    if (isMissingTableError(deleteResult.error, "client_programs")) {
      return NextResponse.json(
        {
          error:
            "Assignments table is unavailable. Apply migration 20260301173000_seed_b2b_multitenant_compliance.sql.",
        },
        { status: 412 },
      );
    }
    return NextResponse.json({ error: "Could not remove assignment." }, { status: 500 });
  }

  if (!deleteResult.data) {
    return NextResponse.json({ error: "Assignment not found for this company." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
