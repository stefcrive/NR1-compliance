import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { cloneSurveyStructure } from "@/lib/campaign-clone";
import { slugify } from "@/lib/slug";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

const createCampaignSchema = z.object({
  name: z.string().min(3).max(120),
  publicSlug: z.string().min(3).max(120).optional(),
  status: z.enum(["draft", "live", "closed", "archived"]).optional(),
  kAnonymityMin: z.number().int().min(3).max(20).optional(),
  sessionTtlMinutes: z.number().int().min(15).max(60).optional(),
  turnstileSiteKey: z.string().min(3).optional(),
  turnstileExpectedHostname: z.string().min(3).optional(),
  startsAt: z.string().datetime().optional().or(z.literal("")),
  closesAt: z.string().datetime().optional().or(z.literal("")),
  sourceSurveyId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
});

type CampaignStatsRow = {
  id: string;
  name: string;
  public_slug: string;
  status: "draft" | "live" | "closed" | "archived";
  starts_at: string | null;
  closes_at: string | null;
  k_anonymity_min: number;
  question_count: number;
  response_count: number;
  latest_response_at: string | null;
  created_at: string;
};

type SurveyClientRow = {
  id: string;
  client_id: string | null;
};

type ClientInfoRow = {
  client_id: string;
  company_name: string;
};

export async function GET(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.rpc("get_campaign_stats").returns<CampaignStatsRow[]>();
  if (error) {
    return NextResponse.json({ error: "Could not fetch campaigns." }, { status: 500 });
  }

  const campaigns = Array.isArray(data) ? data : [];
  const campaignIds = campaigns.map((campaign) => campaign.id);
  const { data: surveyClientRows, error: surveyClientError } =
    campaignIds.length > 0
      ? await supabase
          .from("surveys")
          .select("id,client_id")
          .in("id", campaignIds)
          .returns<SurveyClientRow[]>()
      : { data: [] as SurveyClientRow[], error: null };

  if (
    surveyClientError &&
    !isMissingColumnError(surveyClientError, "client_id") &&
    !isMissingTableError(surveyClientError, "surveys")
  ) {
    return NextResponse.json({ error: "Could not fetch campaigns." }, { status: 500 });
  }

  const surveyClientMap = new Map((surveyClientRows ?? []).map((row) => [row.id, row.client_id] as const));
  const clientIds = Array.from(
    new Set((surveyClientRows ?? []).map((row) => row.client_id).filter((value): value is string => Boolean(value))),
  );

  const { data: clientRows, error: clientRowsError } =
    clientIds.length > 0
      ? await supabase
          .from("clients")
          .select("client_id,company_name")
          .in("client_id", clientIds)
          .returns<ClientInfoRow[]>()
      : { data: [] as ClientInfoRow[], error: null };

  if (
    clientRowsError &&
    !isMissingTableError(clientRowsError, "clients") &&
    !isMissingColumnError(clientRowsError, "company_name")
  ) {
    return NextResponse.json({ error: "Could not fetch campaigns." }, { status: 500 });
  }

  const clientMap = new Map((clientRows ?? []).map((row) => [row.client_id, row] as const));

  return NextResponse.json({
    campaigns: campaigns.map((campaign) => {
      const clientId = surveyClientMap.get(campaign.id) ?? null;
      const client = clientId ? clientMap.get(clientId) : null;
      return {
        ...campaign,
        client_id: clientId,
        client_name: client?.company_name ?? null,
        client_portal_slug: null,
      };
    }),
  });
}

export async function POST(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let parsed: z.infer<typeof createCampaignSchema>;
  try {
    parsed = createCampaignSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const slugBase = slugify(parsed.publicSlug || parsed.name);
  if (!slugBase) {
    return NextResponse.json({ error: "Could not derive campaign slug." }, { status: 400 });
  }

  let finalSlug = slugBase;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const candidate = attempt === 1 ? slugBase : `${slugBase}-${attempt}`;
    const { data: exists, error: existsError } = await supabase
      .from("surveys")
      .select("id")
      .eq("public_slug", candidate)
      .maybeSingle();

    if (existsError) {
      return NextResponse.json({ error: "Could not validate slug uniqueness." }, { status: 500 });
    }
    if (!exists) {
      finalSlug = candidate;
      break;
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from("surveys")
    .insert({
      name: parsed.name,
      public_slug: finalSlug,
      status: parsed.status ?? "draft",
      client_id: parsed.clientId ?? null,
      k_anonymity_min: parsed.kAnonymityMin ?? 5,
      session_ttl_minutes: parsed.sessionTtlMinutes ?? 30,
      turnstile_site_key: parsed.turnstileSiteKey ?? "1x00000000000000000000AA",
      turnstile_expected_hostname:
        parsed.turnstileExpectedHostname ?? request.nextUrl.hostname ?? "localhost",
      starts_at: parsed.startsAt || null,
      closes_at: parsed.closesAt || null,
    })
    .select("id,name,public_slug,status")
    .single<{ id: string; name: string; public_slug: string; status: string }>();

  if (insertError || !inserted) {
    return NextResponse.json({ error: "Could not create campaign." }, { status: 500 });
  }

  if (parsed.sourceSurveyId) {
    try {
      await cloneSurveyStructure({
        sourceSurveyId: parsed.sourceSurveyId,
        targetSurveyId: inserted.id,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: "Campaign created, but failed to clone structure.",
          details: error instanceof Error ? error.message : "unknown",
          campaign: inserted,
        },
        { status: 207 },
      );
    }
  }

  return NextResponse.json(
    {
      campaign: inserted,
    },
    { status: 201 },
  );
}
