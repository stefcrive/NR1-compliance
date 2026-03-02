import { NextRequest, NextResponse } from "next/server";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  buildAccessLink,
  generateAccessToken,
  toRiskParameter,
} from "@/lib/survey-sectors";

type CampaignRow = {
  id: string;
  public_slug: string;
};

type SectorRow = {
  id: string;
  survey_id: string;
  key: string;
  name: string;
  risk_parameter: number | string;
  access_token: string;
  is_active: boolean;
  submission_count: number;
  last_submitted_at: string | null;
  created_at: string;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ campaignId: string; sectorId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { campaignId, sectorId } = await context.params;
  const supabase = getSupabaseAdminClient();

  const { data: campaign, error: campaignError } = await supabase
    .from("surveys")
    .select("id,public_slug")
    .eq("id", campaignId)
    .maybeSingle<CampaignRow>();

  if (campaignError) {
    return NextResponse.json({ error: "Could not load campaign." }, { status: 500 });
  }
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  const { data: existing, error: existingError } = await supabase
    .from("survey_sectors")
    .select("id,survey_id,key,name,risk_parameter,access_token,is_active,submission_count,last_submitted_at,created_at")
    .eq("id", sectorId)
    .eq("survey_id", campaignId)
    .maybeSingle<SectorRow>();

  if (existingError) {
    return NextResponse.json({ error: "Could not load sector." }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Sector not found." }, { status: 404 });
  }

  let updated: SectorRow | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase
      .from("survey_sectors")
      .update({
        access_token: generateAccessToken(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", sectorId)
      .eq("survey_id", campaignId)
      .select("id,survey_id,key,name,risk_parameter,access_token,is_active,submission_count,last_submitted_at,created_at")
      .single<SectorRow>();

    if (!error && data) {
      updated = data;
      break;
    }

    if (error && error.code !== "23505") {
      return NextResponse.json({ error: "Could not rotate sector token." }, { status: 500 });
    }
  }

  if (!updated) {
    return NextResponse.json({ error: "Could not rotate sector token." }, { status: 500 });
  }

  return NextResponse.json({
    sector: {
      id: updated.id,
      key: updated.key,
      name: updated.name,
      riskParameter: toRiskParameter(updated.risk_parameter),
      accessToken: updated.access_token,
      accessLink: buildAccessLink(request.nextUrl.origin, campaign.public_slug, updated.access_token),
      isActive: updated.is_active,
      submissionCount: updated.submission_count,
      lastSubmittedAt: updated.last_submitted_at,
      createdAt: updated.created_at,
    },
  });
}
