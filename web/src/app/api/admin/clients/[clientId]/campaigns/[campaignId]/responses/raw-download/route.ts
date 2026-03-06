import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type CampaignRow = {
  id: string;
  client_id: string | null;
  name: string;
};

type QuestionRow = {
  id: string;
  question_code: string | null;
  prompt: string | null;
  position: number;
};

type ResponseRow = {
  id: string;
  submitted_at: string;
  session_sid: string | null;
  sector_id: string | null;
  group_values: Record<string, unknown> | null;
  answers_json: unknown;
};

type SectorRow = {
  id: string;
  name: string;
};

type AnswerRow = {
  response_id: string;
  question_id: string;
  raw_value: number | string | null;
  corrected_value: number | string | null;
};

type WorkbookSheet = {
  name: string;
  headers: string[];
  rows: string[][];
};

function resolveSectorName(response: ResponseRow, sectorById: Map<string, string>): string {
  if (response.sector_id && sectorById.has(response.sector_id)) {
    return sectorById.get(response.sector_id) ?? "Sem setor";
  }
  const fromGroup = response.group_values?.sector;
  if (typeof fromGroup === "string" && fromGroup.trim().length > 0) {
    return fromGroup.trim();
  }
  return "Sem setor";
}

function resolveSectorKey(response: ResponseRow): string {
  const fromGroup = response.group_values?.sector_key;
  if (typeof fromGroup === "string" && fromGroup.trim().length > 0) {
    return fromGroup.trim();
  }
  return "";
}

function parseAnswersMap(raw: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(raw)) return map;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const questionId = record.question_id;
    if (typeof questionId !== "string" || questionId.trim().length === 0) continue;
    const value = record.raw_value ?? record.value ?? record.corrected_value ?? "";
    map.set(questionId, value === null || value === undefined ? "" : String(value));
  }
  return map;
}

function buildAnswersByResponse(rows: AnswerRow[]): Map<string, Map<string, string>> {
  const byResponse = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const map = byResponse.get(row.response_id) ?? new Map<string, string>();
    const value = row.raw_value ?? row.corrected_value ?? "";
    map.set(row.question_id, value === null || value === undefined ? "" : String(value));
    byResponse.set(row.response_id, map);
  }
  return byResponse;
}

function toSafeSheetName(name: string, usedNames: Set<string>): string {
  const base = name
    .replace(/[\\/*?:\[\]]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 31) || "Sem setor";
  let candidate = base;
  let index = 2;
  while (usedNames.has(candidate)) {
    const suffix = ` (${index})`;
    const maxBaseLength = Math.max(1, 31 - suffix.length);
    candidate = `${base.slice(0, maxBaseLength)}${suffix}`;
    index += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function sanitizeFileSegment(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "drps_responses";
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ clientId: string; campaignId: string }> },
) {
  const { clientId, campaignId } = await context.params;
  const supabase = getSupabaseAdminClient();

  const [campaignResult, questionsResult, responsesResult, sectorsResult] = await Promise.all([
    supabase
      .from("surveys")
      .select("id,client_id,name")
      .eq("id", campaignId)
      .eq("client_id", clientId)
      .maybeSingle<CampaignRow>(),
    supabase
      .from("questions")
      .select("id,question_code,prompt,position")
      .eq("survey_id", campaignId)
      .eq("is_active", true)
      .order("position", { ascending: true })
      .returns<QuestionRow[]>(),
    supabase
      .from("responses")
      .select("id,submitted_at,session_sid,sector_id,group_values,answers_json")
      .eq("survey_id", campaignId)
      .order("submitted_at", { ascending: true })
      .returns<ResponseRow[]>(),
    supabase
      .from("survey_sectors")
      .select("id,name")
      .eq("survey_id", campaignId)
      .returns<SectorRow[]>(),
  ]);

  if (campaignResult.error || questionsResult.error || responsesResult.error || sectorsResult.error) {
    return NextResponse.json({ error: "Could not load raw responses." }, { status: 500 });
  }

  if (!campaignResult.data) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  const questions = (questionsResult.data ?? []).slice().sort((a, b) => a.position - b.position);
  const responses = responsesResult.data ?? [];
  const sectorById = new Map((sectorsResult.data ?? []).map((sector) => [sector.id, sector.name]));
  const responseIds = responses.map((response) => response.id);
  const questionIds = questions.map((question) => question.id);

  let answersByResponse = new Map<string, Map<string, string>>();
  if (responseIds.length > 0 && questionIds.length > 0) {
    const answersResult = await supabase
      .from("answers")
      .select("response_id,question_id,raw_value,corrected_value")
      .in("response_id", responseIds)
      .in("question_id", questionIds)
      .returns<AnswerRow[]>();
    if (answersResult.error) {
      return NextResponse.json({ error: "Could not load raw responses." }, { status: 500 });
    }
    answersByResponse = buildAnswersByResponse(answersResult.data ?? []);
  }

  const headers = [
    "response_id",
    "submitted_at",
    "session_sid",
    "sector",
    "sector_key",
    ...questions.map(
      (question) => question.prompt?.trim() || question.question_code?.trim() || `Q${question.position}`,
    ),
  ];

  const rowsBySector = new Map<string, string[][]>();
  for (const response of responses) {
    const sectorName = resolveSectorName(response, sectorById);
    const answerMapFromJson = parseAnswersMap(response.answers_json);
    const answerMapFromTable = answersByResponse.get(response.id) ?? new Map<string, string>();
    const row = [
      response.id,
      response.submitted_at,
      response.session_sid ?? "",
      sectorName,
      resolveSectorKey(response),
      ...questions.map(
        (question) => answerMapFromJson.get(question.id) ?? answerMapFromTable.get(question.id) ?? "",
      ),
    ];
    const list = rowsBySector.get(sectorName) ?? [];
    list.push(row);
    rowsBySector.set(sectorName, list);
  }

  const usedNames = new Set<string>();
  const sheets: WorkbookSheet[] =
    rowsBySector.size === 0
      ? [
          {
            name: "Sem respostas",
            headers: ["status", "campaign_id"],
            rows: [["Nenhuma resposta encontrada para este diagnostico.", campaignId]],
          },
        ]
      : Array.from(rowsBySector.entries())
          .sort(([left], [right]) => left.localeCompare(right, "pt-BR"))
          .map(([sectorName, rows]) => ({
            name: toSafeSheetName(sectorName, usedNames),
            headers,
            rows,
          }));

  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const matrix = [sheet.headers, ...sheet.rows];
    const worksheet = XLSX.utils.aoa_to_sheet(matrix);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }
  const workbookArrayBuffer = XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx",
    compression: true,
  }) as ArrayBuffer;
  const fileSafeCampaignName = sanitizeFileSegment(campaignResult.data.name);
  const fileName = `${fileSafeCampaignName}_raw_data.xlsx`;

  return new NextResponse(workbookArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
