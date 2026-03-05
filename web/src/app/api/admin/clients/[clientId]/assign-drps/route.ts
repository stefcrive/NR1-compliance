import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { cloneSurveyStructure } from "@/lib/campaign-clone";
import { createClientNotification } from "@/lib/client-notifications";
import { slugify } from "@/lib/slug";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { syncClientSectorTemplatesToSurvey } from "@/lib/survey-sectors";

type ClientRow = {
  client_id: string;
  company_name: string;
  portal_slug?: string | null;
};

type LegacyDrpsCampaignRow = {
  campaign_id: string;
  campaign_name: string;
  status: "Draft" | "Active" | "Completed";
  start_date: string;
  end_date: string | null;
};

const assignDrpsSchema = z.object({
  campaignName: z.string().trim().min(3).max(120),
  publicSlug: z.string().trim().optional(),
  status: z.enum(["draft", "live"]).optional(),
  kAnonymityMin: z.number().int().min(3).max(20).optional(),
  sessionTtlMinutes: z.number().int().min(15).max(60).optional(),
  turnstileSiteKey: z.string().trim().min(3).optional(),
  turnstileExpectedHostname: z.string().trim().min(3).optional(),
  startsAt: z.string().datetime().optional().or(z.literal("")),
  closesAt: z.string().datetime().optional().or(z.literal("")),
  // Accept Postgres UUID format, including deterministic seeded IDs
  // that do not follow RFC version bits (z.string().uuid() would reject them).
  sourceSurveyId: z.string().trim().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).optional(),
});

const DRPS_DEFAULT_WINDOW_DAYS = 7;

function toLegacyStatus(value: "draft" | "live" | undefined): "Draft" | "Active" {
  return value === "live" ? "Active" : "Draft";
}

function toDateOnly(value?: string | null): string {
  if (!value) {
    return new Date().toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}

function plusDaysIso(value: string, days: number): string {
  const base = new Date(value);
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function resolveCampaignWindow(params: { startsAt?: string | null; closesAt?: string | null }) {
  const startsAtRaw = params.startsAt?.trim() || null;
  const closesAtRaw = params.closesAt?.trim() || null;

  const startsAtDate = startsAtRaw ? new Date(startsAtRaw) : null;
  const closesAtDate = closesAtRaw ? new Date(closesAtRaw) : null;
  const startsAtValid = startsAtDate && !Number.isNaN(startsAtDate.getTime()) ? startsAtDate.toISOString() : null;
  const closesAtValid = closesAtDate && !Number.isNaN(closesAtDate.getTime()) ? closesAtDate.toISOString() : null;

  if (startsAtValid && closesAtValid && new Date(closesAtValid).getTime() > new Date(startsAtValid).getTime()) {
    return { startsAt: startsAtValid, closesAt: closesAtValid };
  }
  if (startsAtValid) {
    return { startsAt: startsAtValid, closesAt: plusDaysIso(startsAtValid, DRPS_DEFAULT_WINDOW_DAYS) };
  }
  if (closesAtValid) {
    return { startsAt: plusDaysIso(closesAtValid, -DRPS_DEFAULT_WINDOW_DAYS), closesAt: closesAtValid };
  }

  const nowIso = new Date().toISOString();
  return { startsAt: nowIso, closesAt: plusDaysIso(nowIso, DRPS_DEFAULT_WINDOW_DAYS) };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { clientId } = await context.params;
  let parsed: z.infer<typeof assignDrpsSchema>;
  try {
    parsed = assignDrpsSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const campaignWindow = resolveCampaignWindow({
    startsAt: parsed.startsAt,
    closesAt: parsed.closesAt,
  });
  if (parsed.sourceSurveyId) {
    const { data: sourceQuestion, error: sourceQuestionError } = await supabase
      .from("questions")
      .select("id")
      .eq("survey_id", parsed.sourceSurveyId)
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (sourceQuestionError) {
      return NextResponse.json({ error: "Could not validate source template questions." }, { status: 500 });
    }

    if (!sourceQuestion) {
      return NextResponse.json({ error: "Selected template has no base questions." }, { status: 400 });
    }
  }

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("client_id,company_name,portal_slug")
    .eq("client_id", clientId)
    .maybeSingle<ClientRow>();

  if (clientError) {
    if (isMissingColumnError(clientError, "portal_slug")) {
      const { data: legacyClient, error: legacyClientError } = await supabase
        .from("clients")
        .select("client_id,company_name")
        .eq("client_id", clientId)
        .maybeSingle<{ client_id: string; company_name: string }>();

      if (legacyClientError) {
        return NextResponse.json({ error: "Could not load client." }, { status: 500 });
      }
      if (!legacyClient) {
        return NextResponse.json({ error: "Client not found." }, { status: 404 });
      }

      const fallbackSlugBase = slugify(legacyClient.company_name) || "client";
      const slugSeed = (parsed.publicSlug || `${fallbackSlugBase}-${parsed.campaignName}`).slice(0, 240);
      const slugBase = slugify(slugSeed).slice(0, 120);
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

      const legacyInsert = await supabase
        .from("surveys")
        .insert({
          name: parsed.campaignName,
          public_slug: finalSlug,
          status: parsed.status ?? "draft",
          k_anonymity_min: parsed.kAnonymityMin ?? 5,
          session_ttl_minutes: parsed.sessionTtlMinutes ?? 30,
          turnstile_site_key: parsed.turnstileSiteKey ?? "1x00000000000000000000AA",
          turnstile_expected_hostname:
            parsed.turnstileExpectedHostname ?? request.nextUrl.hostname ?? "localhost",
          starts_at: campaignWindow.startsAt,
          closes_at: campaignWindow.closesAt,
        })
        .select("id,name,public_slug,status,created_at")
        .single();

      if (legacyInsert.error || !legacyInsert.data) {
        return NextResponse.json(
          {
            error:
              "Could not assign DRPS campaign. Apply migration 20260301201000_manager_client_workspaces.sql first.",
          },
          { status: 412 },
        );
      }

      const legacyCampaignId = legacyInsert.data.id || randomUUID();
      const legacyCampaignInsert = await supabase
        .from("drps_campaigns")
        .insert({
          campaign_id: legacyCampaignId,
          client_id: legacyClient.client_id,
          campaign_name: parsed.campaignName,
          status: toLegacyStatus(parsed.status),
          start_date: toDateOnly(campaignWindow.startsAt),
          end_date: toDateOnly(campaignWindow.closesAt),
          unique_link_token: `${finalSlug}-${randomUUID().slice(0, 8)}`,
        })
        .select("campaign_id,campaign_name,status,start_date,end_date")
        .single<LegacyDrpsCampaignRow>();

      if (
        legacyCampaignInsert.error &&
        !isMissingTableError(legacyCampaignInsert.error, "drps_campaigns")
      ) {
        return NextResponse.json(
          {
            campaign: legacyInsert.data,
            warning:
              "Survey created, but failed to persist in legacy drps_campaigns.",
            details: legacyCampaignInsert.error.message,
            sectorTemplatesSynced: 0,
          },
          { status: 207 },
        );
      }

      try {
        await createClientNotification(supabase, {
          clientId: legacyClient.client_id,
          notificationType: "manager_drps_assigned",
          title: `Novo DRPS atribuido: ${parsed.campaignName}`,
          message: "O gestor atribuiu um novo diagnostico DRPS para sua empresa.",
          metadata: {
            campaignId: legacyCampaignInsert.data?.campaign_id ?? legacyCampaignId,
            campaignName: parsed.campaignName,
            campaignStatus: parsed.status ?? "draft",
            campaignSlug: finalSlug,
          },
        });
      } catch {
        // Do not block DRPS assignment when notification persistence fails.
      }

      return NextResponse.json(
        {
          campaign:
            legacyCampaignInsert.data
              ? {
                  id: legacyCampaignInsert.data.campaign_id,
                  name: legacyCampaignInsert.data.campaign_name,
                  public_slug: finalSlug,
                  status:
                    legacyCampaignInsert.data.status === "Active"
                      ? "live"
                      : legacyCampaignInsert.data.status === "Completed"
                        ? "closed"
                        : "draft",
                  created_at: new Date().toISOString(),
                }
              : legacyInsert.data,
          warning:
            "Campaign created without client linkage because migration 20260301201000_manager_client_workspaces.sql is not applied.",
          sectorTemplatesSynced: 0,
        },
        { status: 207 },
      );
    }
    return NextResponse.json({ error: "Could not load client." }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const clientSlugSeed = client.portal_slug?.trim() || slugify(client.company_name) || "client";
  const slugSeed = (parsed.publicSlug || `${clientSlugSeed}-${parsed.campaignName}`).slice(0, 240);
  const slugBase = slugify(slugSeed).slice(0, 120);
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
      name: parsed.campaignName,
      client_id: client.client_id,
      public_slug: finalSlug,
      status: parsed.status ?? "draft",
      k_anonymity_min: parsed.kAnonymityMin ?? 5,
      session_ttl_minutes: parsed.sessionTtlMinutes ?? 30,
      turnstile_site_key: parsed.turnstileSiteKey ?? "1x00000000000000000000AA",
      turnstile_expected_hostname:
        parsed.turnstileExpectedHostname ?? request.nextUrl.hostname ?? "localhost",
      starts_at: campaignWindow.startsAt,
      closes_at: campaignWindow.closesAt,
    })
    .select("id,name,public_slug,status,client_id,created_at")
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ error: "Could not assign DRPS campaign." }, { status: 500 });
  }

  try {
    await createClientNotification(supabase, {
      clientId: client.client_id,
      notificationType: "manager_drps_assigned",
      title: `Novo DRPS atribuido: ${inserted.name}`,
      message: "O gestor atribuiu um novo diagnostico DRPS para sua empresa.",
      metadata: {
        campaignId: inserted.id,
        campaignName: inserted.name,
        campaignStatus: inserted.status,
        campaignSlug: inserted.public_slug,
      },
    });
  } catch {
    // Do not block DRPS assignment when notification persistence fails.
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

  try {
    const sync = await syncClientSectorTemplatesToSurvey({
      clientId: client.client_id,
      surveyId: inserted.id,
    });

    return NextResponse.json(
      {
        campaign: inserted,
        sectorTemplatesSynced: sync.synced,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Campaign assigned, but failed to sync client sectors.",
        details: error instanceof Error ? error.message : "unknown",
        campaign: inserted,
      },
      { status: 207 },
    );
  }
}
