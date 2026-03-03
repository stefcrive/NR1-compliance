import { randomUUID } from "crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isAdminApiAuthorized } from "@/lib/admin-auth";
import {
  CONTINUOUS_PROGRAM_MATERIAL_ALLOWED_MIME_TYPES,
  type ContinuousProgramMaterial,
} from "@/lib/continuous-programs";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

const BUCKET_NAME = "program-materials";
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

type ProgramMaterialsRow = {
  program_id: string;
  materials?: unknown;
};

const materialSchema: z.ZodType<ContinuousProgramMaterial> = z.object({
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(240),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().min(0).max(50 * 1024 * 1024),
  uploadedAt: z.string().datetime({ offset: true }),
  storagePath: z.string().trim().min(1).max(512),
  downloadUrl: z.string().url(),
});

const deleteMaterialSchema = z.object({
  materialId: z.string().trim().min(1),
});

function parseMaterials(value: unknown): ContinuousProgramMaterial[] {
  const parsed = z.array(materialSchema).safeParse(value);
  if (!parsed.success) {
    return [];
  }
  return parsed.data;
}

function sanitizeFileName(fileName: string): string {
  const normalized = fileName.trim().replace(/\s+/g, "-");
  const safe = normalized.replace(/[^a-zA-Z0-9._-]/g, "");
  return safe.length > 0 ? safe : "material.bin";
}

function deriveTitle(fileName: string): string {
  const withoutExt = fileName.replace(/\.[^.]+$/, "");
  const normalized = withoutExt.replace(/[_-]+/g, " ").trim();
  return normalized.length > 0 ? normalized : "Campaign material";
}

async function loadProgramMaterials(programId: string) {
  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("periodic_programs")
    .select("program_id,materials")
    .eq("program_id", programId)
    .maybeSingle<ProgramMaterialsRow>();

  return result;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ programId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { programId } = await context.params;
  const form = await request.formData();
  const fileValue = form.get("file");

  if (!(fileValue instanceof File)) {
    return NextResponse.json({ error: "File is required." }, { status: 400 });
  }
  if (fileValue.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "File too large. Maximum size is 15 MB." },
      { status: 400 },
    );
  }

  const mimeType = fileValue.type || "application/octet-stream";
  if (
    fileValue.type &&
    !CONTINUOUS_PROGRAM_MATERIAL_ALLOWED_MIME_TYPES.includes(
      fileValue.type as (typeof CONTINUOUS_PROGRAM_MATERIAL_ALLOWED_MIME_TYPES)[number],
    )
  ) {
    return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });
  }

  const materialsResult = await loadProgramMaterials(programId);
  if (materialsResult.error && isMissingColumnError(materialsResult.error, "materials")) {
    return NextResponse.json(
      {
        error:
          "Program materials column is missing. Apply migration 20260302190000_continuous_program_details.sql.",
      },
      { status: 409 },
    );
  }
  if (
    materialsResult.error &&
    !isMissingTableError(materialsResult.error, "periodic_programs")
  ) {
    return NextResponse.json({ error: "Could not load program." }, { status: 500 });
  }
  if (!materialsResult.data) {
    return NextResponse.json({ error: "Continuous program not found." }, { status: 404 });
  }

  const currentMaterials = parseMaterials(materialsResult.data.materials);
  const titleValue = String(form.get("title") ?? "")
    .trim()
    .slice(0, 240);
  const title = titleValue.length > 0 ? titleValue : deriveTitle(fileValue.name);

  const safeName = sanitizeFileName(fileValue.name);
  const storagePath = `${programId}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;

  const supabase = getSupabaseAdminClient();
  const uploadResult = await supabase.storage.from(BUCKET_NAME).upload(storagePath, fileValue, {
    cacheControl: "3600",
    contentType: mimeType,
    upsert: false,
  });

  if (uploadResult.error) {
    return NextResponse.json(
      { error: `Could not upload material: ${uploadResult.error.message}` },
      { status: 500 },
    );
  }

  const publicUrlResult = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
  const material: ContinuousProgramMaterial = {
    id: randomUUID(),
    title,
    fileName: fileValue.name,
    mimeType,
    sizeBytes: fileValue.size,
    uploadedAt: new Date().toISOString(),
    storagePath,
    downloadUrl: publicUrlResult.data.publicUrl,
  };

  const nextMaterials = [...currentMaterials, material];
  const updateResult = await supabase
    .from("periodic_programs")
    .update({ materials: nextMaterials })
    .eq("program_id", programId)
    .select("program_id")
    .maybeSingle<{ program_id: string }>();

  if (
    updateResult.error &&
    !isMissingTableError(updateResult.error, "periodic_programs")
  ) {
    await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
    return NextResponse.json({ error: "Could not save material metadata." }, { status: 500 });
  }
  if (!updateResult.data) {
    await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
    return NextResponse.json({ error: "Continuous program not found." }, { status: 404 });
  }

  return NextResponse.json({ material }, { status: 201 });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ programId: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { programId } = await context.params;
  let parsed: z.infer<typeof deleteMaterialSchema>;
  try {
    parsed = deleteMaterialSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const materialsResult = await loadProgramMaterials(programId);
  if (materialsResult.error && isMissingColumnError(materialsResult.error, "materials")) {
    return NextResponse.json(
      {
        error:
          "Program materials column is missing. Apply migration 20260302190000_continuous_program_details.sql.",
      },
      { status: 409 },
    );
  }
  if (
    materialsResult.error &&
    !isMissingTableError(materialsResult.error, "periodic_programs")
  ) {
    return NextResponse.json({ error: "Could not load program materials." }, { status: 500 });
  }
  if (!materialsResult.data) {
    return NextResponse.json({ error: "Continuous program not found." }, { status: 404 });
  }

  const currentMaterials = parseMaterials(materialsResult.data.materials);
  const target = currentMaterials.find((item) => item.id === parsed.materialId);
  if (!target) {
    return NextResponse.json({ error: "Material not found." }, { status: 404 });
  }

  const nextMaterials = currentMaterials.filter((item) => item.id !== parsed.materialId);
  const supabase = getSupabaseAdminClient();
  const updateResult = await supabase
    .from("periodic_programs")
    .update({ materials: nextMaterials })
    .eq("program_id", programId)
    .select("program_id")
    .maybeSingle<{ program_id: string }>();

  if (
    updateResult.error &&
    !isMissingTableError(updateResult.error, "periodic_programs")
  ) {
    return NextResponse.json({ error: "Could not remove material." }, { status: 500 });
  }
  if (!updateResult.data) {
    return NextResponse.json({ error: "Continuous program not found." }, { status: 404 });
  }

  if (target.storagePath) {
    await supabase.storage.from(BUCKET_NAME).remove([target.storagePath]);
  }

  return NextResponse.json({ ok: true });
}
