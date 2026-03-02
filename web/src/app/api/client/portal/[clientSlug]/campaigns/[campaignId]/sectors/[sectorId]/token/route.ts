import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  buildAccessLink,
  generateAccessToken,
  toRiskParameter,
} from "@/lib/survey-sectors";

type ClientRow = {
  client_id: string;
  portal_slug: string;
};

type CampaignRow = {
  id: string;
  client_id: string | null;
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

async function resolveClientCampaignOrNull(params: {
  clientSlug: string;
  campaignId: string;
}): Promise<{ client: ClientRow; campaign: CampaignRow } | null> {
  const supabase = getSupabaseAdminClient();
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("client_id,portal_slug")
    .eq("portal_slug", params.clientSlug)
    .maybeSingle<ClientRow>();

  if (clientError) {
    throw new Error(clientError.message);
  }
  if (!client) {
    return null;
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("surveys")
    .select("id,client_id,public_slug")
    .eq("id", params.campaignId)
    .eq("client_id", client.client_id)
    .maybeSingle<CampaignRow>();

  if (campaignError) {
    throw new Error(campaignError.message);
  }
  if (!campaign) {
    return null;
  }

  return { client, campaign };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ clientSlug: string; campaignId: string; sectorId: string }> },
) {
  const { clientSlug, campaignId, sectorId } = await context.params;
  const resolved = await resolveClientCampaignOrNull({ clientSlug, campaignId });
  if (!resolved) {
    return NextResponse.json({ error: "Campaign not found for this client." }, { status: 404 });
  }

  const supabase = getSupabaseAdminClient();
  const { data: existing, error: existingError } = await supabase
    .from("survey_sectors")
    .select(
      "id,survey_id,key,name,risk_parameter,access_token,is_active,submission_count,last_submitted_at,created_at",
    )
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
      .select(
        "id,survey_id,key,name,risk_parameter,access_token,is_active,submission_count,last_submitted_at,created_at",
      )
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
      accessLink: buildAccessLink(request.nextUrl.origin, resolved.campaign.public_slug, updated.access_token),
      isActive: updated.is_active,
      submissionCount: updated.submission_count,
      lastSubmittedAt: updated.last_submitted_at,
      createdAt: updated.created_at,
    },
  });
}
