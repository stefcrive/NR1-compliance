import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type SurveyRow = {
  id: string;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  starts_at: string | null;
  closes_at: string | null;
  created_at: string;
};

type LegacyCampaignRow = {
  campaign_id: string;
  campaign_name: string;
  status: "Draft" | "Active" | "Completed";
  start_date: string;
  end_date: string | null;
};

const updateCampaignSchema = z
  .object({
    name: z.string().trim().min(3).max(120).optional(),
    status: z.enum(["draft", "live", "closed", "archived"]).optional(),
    startsAt: z.string().datetime().optional().or(z.literal("")),
    closesAt: z.string().datetime().optional().or(z.literal("")),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

function toLegacyStatus(status: "draft" | "live" | "closed" | "archived" | undefined) {
  if (status === "live") return "Active";
  if (status === "draft") return "Draft";
  return "Completed";
}

function toDateOnly(value: string | undefined | null): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

function isForeignKeyViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23503";
}

async function cleanupSurveyDependencies(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  surveyId: string,
): Promise<{ message: string } | null> {
  const dependentSurveyTables = [
    "responses",
    "rate_limit_buckets",
    "drps_assessments",
    "survey_sector_risk_factor_timeseries",
    "survey_sectors",
    "survey_group_dimensions",
    "questions",
  ];

  for (const table of dependentSurveyTables) {
    const result = await supabase.from(table).delete().eq("survey_id", surveyId);
    if (result.error && !isMissingTableError(result.error, table)) {
      return { message: result.error.message };
    }
  }

  return null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ campaignId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { campaignId } = await context.params;
  let parsed: z.infer<typeof updateCampaignSchema>;
  try {
    parsed = updateCampaignSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const surveyUpdatePayload = {
    ...(parsed.name !== undefined ? { name: parsed.name.trim() } : {}),
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
    ...(parsed.startsAt !== undefined ? { starts_at: parsed.startsAt || null } : {}),
    ...(parsed.closesAt !== undefined ? { closes_at: parsed.closesAt || null } : {}),
  };

  const surveyUpdate = await supabase
    .from("surveys")
    .update(surveyUpdatePayload)
    .eq("id", campaignId)
    .select("id,name,public_slug,status,starts_at,closes_at,created_at")
    .maybeSingle<SurveyRow>();

  if (surveyUpdate.error && !isMissingTableError(surveyUpdate.error, "surveys")) {
    return NextResponse.json({ error: "Could not update diagnostic." }, { status: 500 });
  }

  if (surveyUpdate.data) {
    return NextResponse.json({
      campaign: surveyUpdate.data,
    });
  }

  const legacyUpdatePayload = {
    ...(parsed.name !== undefined ? { campaign_name: parsed.name.trim() } : {}),
    ...(parsed.status !== undefined ? { status: toLegacyStatus(parsed.status) } : {}),
    ...(parsed.startsAt !== undefined
      ? { start_date: toDateOnly(parsed.startsAt) ?? new Date().toISOString().slice(0, 10) }
      : {}),
    ...(parsed.closesAt !== undefined ? { end_date: toDateOnly(parsed.closesAt) } : {}),
  };

  const legacyUpdate = await supabase
    .from("drps_campaigns")
    .update(legacyUpdatePayload)
    .eq("campaign_id", campaignId)
    .select("campaign_id,campaign_name,status,start_date,end_date")
    .maybeSingle<LegacyCampaignRow>();

  if (legacyUpdate.error) {
    return NextResponse.json({ error: "Could not update diagnostic." }, { status: 500 });
  }

  if (!legacyUpdate.data) {
    return NextResponse.json({ error: "Diagnostic not found." }, { status: 404 });
  }

  return NextResponse.json({
    campaign: {
      id: legacyUpdate.data.campaign_id,
      name: legacyUpdate.data.campaign_name,
      public_slug: "",
      status:
        legacyUpdate.data.status === "Active"
          ? "live"
          : legacyUpdate.data.status === "Draft"
            ? "draft"
            : "closed",
      starts_at: legacyUpdate.data.start_date
        ? new Date(legacyUpdate.data.start_date).toISOString()
        : null,
      closes_at: legacyUpdate.data.end_date ? new Date(legacyUpdate.data.end_date).toISOString() : null,
      created_at: new Date().toISOString(),
    },
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ campaignId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { campaignId } = await context.params;
  const supabase = getSupabaseAdminClient();

  let surveyDelete = await supabase
    .from("surveys")
    .delete({ count: "exact" })
    .eq("id", campaignId);

  if (
    surveyDelete.error &&
    !isMissingTableError(surveyDelete.error, "surveys") &&
    isForeignKeyViolation(surveyDelete.error)
  ) {
    const cleanupError = await cleanupSurveyDependencies(supabase, campaignId);
    if (cleanupError) {
      return NextResponse.json(
        { error: "Could not delete diagnostic.", details: cleanupError.message },
        { status: 500 },
      );
    }

    surveyDelete = await supabase
      .from("surveys")
      .delete({ count: "exact" })
      .eq("id", campaignId);
  }

  if (surveyDelete.error && !isMissingTableError(surveyDelete.error, "surveys")) {
    return NextResponse.json(
      { error: "Could not delete diagnostic.", details: surveyDelete.error.message },
      { status: 500 },
    );
  }

  if ((surveyDelete.count ?? 0) > 0) {
    return NextResponse.json({ ok: true });
  }

  const legacyDelete = await supabase
    .from("drps_campaigns")
    .delete({ count: "exact" })
    .eq("campaign_id", campaignId);

  if (legacyDelete.error && !isMissingTableError(legacyDelete.error, "drps_campaigns")) {
    return NextResponse.json(
      { error: "Could not delete diagnostic.", details: legacyDelete.error.message },
      { status: 500 },
    );
  }

  if ((legacyDelete.count ?? 0) > 0) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Diagnostic not found." }, { status: 404 });
}
