import { randomBytes } from "node:crypto";

import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type GroupDimensionRow = {
  id: string;
};

type GroupOptionSortRow = {
  sort_order: number;
};

type ClientSectorTemplateRow = {
  key: string;
  name: string;
  risk_parameter: number | string;
};

export function generateAccessToken(): string {
  return randomBytes(18).toString("base64url");
}

export function toRiskParameter(value: number | string): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 1;
}

export function buildAccessLink(origin: string, slug: string, token: string): string {
  const url = new URL(`/s/${slug}`, origin);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function ensureSectorGroupOption(params: {
  surveyId: string;
  sectorName: string;
}) {
  const supabase = getSupabaseAdminClient();
  const { data: existingDimension, error: dimensionError } = await supabase
    .from("survey_group_dimensions")
    .select("id")
    .eq("survey_id", params.surveyId)
    .eq("key", "sector")
    .maybeSingle<GroupDimensionRow>();

  if (dimensionError) {
    throw new Error(dimensionError.message);
  }

  let dimensionId = existingDimension?.id;

  if (!dimensionId) {
    const { data: insertedDimension, error: insertDimensionError } = await supabase
      .from("survey_group_dimensions")
      .insert({
        survey_id: params.surveyId,
        key: "sector",
        label: "Setor",
        is_required: true,
      })
      .select("id")
      .single<GroupDimensionRow>();

    if (insertDimensionError || !insertedDimension) {
      throw new Error(insertDimensionError?.message ?? "Could not create sector group dimension.");
    }
    dimensionId = insertedDimension.id;
  }

  const { data: optionRows, error: optionRowsError } = await supabase
    .from("survey_group_options")
    .select("sort_order")
    .eq("dimension_id", dimensionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .returns<GroupOptionSortRow[]>();

  if (optionRowsError) {
    throw new Error(optionRowsError.message);
  }

  const nextSortOrder = (optionRows?.[0]?.sort_order ?? 0) + 1;

  const { error: upsertOptionError } = await supabase.from("survey_group_options").upsert(
    {
      dimension_id: dimensionId,
      value: params.sectorName,
      label: params.sectorName,
      sort_order: nextSortOrder,
    },
    {
      onConflict: "dimension_id,value",
    },
  );

  if (upsertOptionError) {
    throw new Error(upsertOptionError.message);
  }
}

export async function syncClientSectorTemplatesToSurvey(params: {
  clientId: string;
  surveyId: string;
}) {
  const supabase = getSupabaseAdminClient();

  const { data: templates, error: templatesError } = await supabase
    .from("client_sectors")
    .select("key,name,risk_parameter")
    .eq("client_id", params.clientId)
    .order("created_at", { ascending: true })
    .returns<ClientSectorTemplateRow[]>();

  if (templatesError) {
    throw new Error(templatesError.message);
  }

  let synced = 0;
  for (const template of templates ?? []) {
    const { error: upsertError } = await supabase.from("survey_sectors").upsert(
      {
        survey_id: params.surveyId,
        key: template.key,
        name: template.name,
        risk_parameter: toRiskParameter(template.risk_parameter),
        is_active: true,
        access_token: generateAccessToken(),
      },
      {
        onConflict: "survey_id,key",
      },
    );

    if (upsertError) {
      throw new Error(upsertError.message);
    }

    await ensureSectorGroupOption({
      surveyId: params.surveyId,
      sectorName: template.name,
    });

    synced += 1;
  }

  return { synced };
}