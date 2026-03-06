import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  parseContinuousProgramEvaluationQuestions,
  summarizeContinuousProgramEvaluations,
} from "@/lib/continuous-program-evaluations";
import { slugify } from "@/lib/slug";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ClientRow = {
  client_id: string;
  company_name: string;
};

type AssignmentRow = {
  client_program_id: string;
  program_id: string;
};

type ProgramRow = {
  evaluation_questions?: unknown;
};

type ProgramEvaluationRow = {
  answers: unknown;
};

const submitEvaluationSchema = z.object({
  answers: z.array(z.number().int().min(1).max(5)).min(1).max(20),
});

async function loadClientBySlug(clientSlug: string) {
  const supabase = getSupabaseAdminClient();
  const directLookup = await supabase
    .from("clients")
    .select("client_id,company_name")
    .eq("portal_slug", clientSlug)
    .maybeSingle<ClientRow>();

  if (!directLookup.error) {
    return {
      client: directLookup.data,
      error: null as { message: string; status: number } | null,
    };
  }

  if (!isMissingColumnError(directLookup.error, "portal_slug")) {
    return {
      client: null,
      error: { message: "Could not load client.", status: 500 },
    };
  }

  const legacyLookup = await supabase
    .from("clients")
    .select("client_id,company_name")
    .returns<ClientRow[]>();

  if (legacyLookup.error) {
    return {
      client: null,
      error: { message: "Could not load client.", status: 500 },
    };
  }

  const matched = (legacyLookup.data ?? []).find((item) => slugify(item.company_name) === clientSlug) ?? null;
  return {
    client: matched,
    error: null as { message: string; status: number } | null,
  };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ clientSlug: string; assignmentId: string }> },
) {
  let parsedPayload: z.infer<typeof submitEvaluationSchema>;
  try {
    parsedPayload = submitEvaluationSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const { clientSlug, assignmentId } = await context.params;
  const clientLookup = await loadClientBySlug(clientSlug);
  if (clientLookup.error) {
    return NextResponse.json({ error: clientLookup.error.message }, { status: clientLookup.error.status });
  }
  if (!clientLookup.client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const supabase = getSupabaseAdminClient();
  const assignmentResult = await supabase
    .from("client_programs")
    .select("client_program_id,program_id")
    .eq("client_program_id", assignmentId)
    .eq("client_id", clientLookup.client.client_id)
    .maybeSingle<AssignmentRow>();

  if (assignmentResult.error) {
    if (isMissingTableError(assignmentResult.error, "client_programs")) {
      return NextResponse.json(
        {
          error:
            "Assigned programs table unavailable. Apply migration 20260301173000_seed_b2b_multitenant_compliance.sql.",
        },
        { status: 412 },
      );
    }
    return NextResponse.json({ error: "Could not load assigned program." }, { status: 500 });
  }

  if (!assignmentResult.data) {
    return NextResponse.json({ error: "Assigned program not found." }, { status: 404 });
  }

  const detailedProgramResult = await supabase
    .from("periodic_programs")
    .select("evaluation_questions")
    .eq("program_id", assignmentResult.data.program_id)
    .maybeSingle<ProgramRow>();

  const programResult =
    detailedProgramResult.error && isMissingColumnError(detailedProgramResult.error, "evaluation_questions")
      ? await supabase
          .from("periodic_programs")
          .select("program_id")
          .eq("program_id", assignmentResult.data.program_id)
          .maybeSingle<{ program_id: string }>()
      : detailedProgramResult;

  if (programResult.error && !isMissingTableError(programResult.error, "periodic_programs")) {
    return NextResponse.json({ error: "Could not load program questionnaire." }, { status: 500 });
  }

  if (!programResult.data) {
    return NextResponse.json({ error: "Program template not found." }, { status: 404 });
  }

  const evaluationQuestions = parseContinuousProgramEvaluationQuestions(
    "evaluation_questions" in programResult.data
      ? (programResult.data as ProgramRow).evaluation_questions
      : undefined,
  );

  if (parsedPayload.answers.length !== evaluationQuestions.length) {
    return NextResponse.json(
      {
        error: `Expected ${evaluationQuestions.length} answers for this questionnaire.`,
      },
      { status: 400 },
    );
  }

  const insertResult = await supabase
    .from("client_program_evaluations")
    .insert({
      evaluation_id: randomUUID(),
      client_program_id: assignmentResult.data.client_program_id,
      client_id: clientLookup.client.client_id,
      answers: parsedPayload.answers,
      questionnaire_snapshot: evaluationQuestions,
    })
    .select("evaluation_id")
    .maybeSingle<{ evaluation_id: string }>();

  if (insertResult.error) {
    if (isMissingTableError(insertResult.error, "client_program_evaluations")) {
      return NextResponse.json(
        {
          error:
            "Evaluation storage table unavailable. Apply migration 20260306013000_client_program_evaluations_and_online_activity_seed.sql.",
        },
        { status: 412 },
      );
    }
    return NextResponse.json({ error: "Could not persist evaluation." }, { status: 500 });
  }

  const evaluationsResult = await supabase
    .from("client_program_evaluations")
    .select("answers")
    .eq("client_program_id", assignmentResult.data.client_program_id)
    .returns<ProgramEvaluationRow[]>();

  if (evaluationsResult.error) {
    return NextResponse.json({ error: "Could not refresh evaluation metrics." }, { status: 500 });
  }

  const summary = summarizeContinuousProgramEvaluations({
    answerPayloads: (evaluationsResult.data ?? []).map((item) => item.answers),
    questionCount: evaluationQuestions.length,
  });

  return NextResponse.json({
    summary,
  });
}
