import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { slugify } from "@/lib/slug";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  buildAccessLink,
  ensureSectorGroupOption,
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
  name: string;
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

const upsertSectorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  riskParameter: z.number().min(0.5).max(2.0).optional(),
  isActive: z.boolean().optional(),
});

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
    .select("id,client_id,name,public_slug")
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

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientSlug: string; campaignId: string }> },
) {
  const { clientSlug, campaignId } = await context.params;
  const resolved = await resolveClientCampaignOrNull({ clientSlug, campaignId });
  if (!resolved) {
    return NextResponse.json({ error: "Campaign not found for this client." }, { status: 404 });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("survey_sectors")
    .select(
      "id,survey_id,key,name,risk_parameter,access_token,is_active,submission_count,last_submitted_at,created_at",
    )
    .eq("survey_id", resolved.campaign.id)
    .order("created_at", { ascending: true })
    .returns<SectorRow[]>();

  if (error) {
    return NextResponse.json({ error: "Could not load sectors." }, { status: 500 });
  }

  const sortedSectors = (data ?? []).slice().sort((left, right) => {
    if (left.is_active !== right.is_active) {
      return left.is_active ? -1 : 1;
    }
    return left.created_at.localeCompare(right.created_at);
  });

  return NextResponse.json({
    campaign: {
      id: resolved.campaign.id,
      name: resolved.campaign.name,
      slug: resolved.campaign.public_slug,
    },
    sectors: sortedSectors.map((item) => ({
      id: item.id,
      key: item.key,
      name: item.name,
      riskParameter: toRiskParameter(item.risk_parameter),
      accessToken: item.access_token,
      accessLink: buildAccessLink(request.nextUrl.origin, resolved.campaign.public_slug, item.access_token),
      isActive: item.is_active,
      submissionCount: item.submission_count,
      lastSubmittedAt: item.last_submitted_at,
      createdAt: item.created_at,
    })),
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ clientSlug: string; campaignId: string }> },
) {
  const { clientSlug, campaignId } = await context.params;
  const resolved = await resolveClientCampaignOrNull({ clientSlug, campaignId });
  if (!resolved) {
    return NextResponse.json({ error: "Campaign not found for this client." }, { status: 404 });
  }

  let parsed: z.infer<typeof upsertSectorSchema>;
  try {
    parsed = upsertSectorSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const key = slugify(parsed.name);
  if (!key) {
    return NextResponse.json({ error: "Invalid sector name." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data: existing, error: existingError } = await supabase
    .from("survey_sectors")
    .select(
      "id,survey_id,key,name,risk_parameter,access_token,is_active,submission_count,last_submitted_at,created_at",
    )
    .eq("survey_id", resolved.campaign.id)
    .eq("key", key)
    .maybeSingle<SectorRow>();

  if (existingError) {
    return NextResponse.json({ error: "Could not validate sector uniqueness." }, { status: 500 });
  }

  let upserted: SectorRow | null = null;
  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from("survey_sectors")
      .update({
        name: parsed.name,
        risk_parameter: parsed.riskParameter ?? toRiskParameter(existing.risk_parameter),
        is_active: parsed.isActive ?? existing.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("survey_id", resolved.campaign.id)
      .select(
        "id,survey_id,key,name,risk_parameter,access_token,is_active,submission_count,last_submitted_at,created_at",
      )
      .single<SectorRow>();

    if (updateError || !updated) {
      return NextResponse.json({ error: "Could not update sector." }, { status: 500 });
    }
    upserted = updated;
  } else {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data: inserted, error: insertError } = await supabase
        .from("survey_sectors")
        .insert({
          survey_id: resolved.campaign.id,
          key,
          name: parsed.name,
          risk_parameter: parsed.riskParameter ?? 1,
          is_active: parsed.isActive ?? true,
          access_token: generateAccessToken(),
        })
        .select(
          "id,survey_id,key,name,risk_parameter,access_token,is_active,submission_count,last_submitted_at,created_at",
        )
        .single<SectorRow>();

      if (!insertError && inserted) {
        upserted = inserted;
        break;
      }

      if (insertError && insertError.code !== "23505") {
        return NextResponse.json({ error: "Could not create sector." }, { status: 500 });
      }
    }
  }

  if (!upserted) {
    return NextResponse.json({ error: "Could not create sector token." }, { status: 500 });
  }

  try {
    await ensureSectorGroupOption({
      surveyId: resolved.campaign.id,
      sectorName: upserted.name,
    });
  } catch (groupError) {
    return NextResponse.json(
      {
        error: "Sector saved, but could not sync questionnaire sector option.",
        details: groupError instanceof Error ? groupError.message : "unknown",
      },
      { status: 207 },
    );
  }

  return NextResponse.json(
    {
      sector: {
        id: upserted.id,
        key: upserted.key,
        name: upserted.name,
        riskParameter: toRiskParameter(upserted.risk_parameter),
        accessToken: upserted.access_token,
        accessLink: buildAccessLink(
          request.nextUrl.origin,
          resolved.campaign.public_slug,
          upserted.access_token,
        ),
        isActive: upserted.is_active,
        submissionCount: upserted.submission_count,
        lastSubmittedAt: upserted.last_submitted_at,
        createdAt: upserted.created_at,
      },
    },
    { status: existing ? 200 : 201 },
  );
}
