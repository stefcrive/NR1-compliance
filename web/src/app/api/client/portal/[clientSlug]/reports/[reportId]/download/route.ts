import { NextRequest, NextResponse } from "next/server";

import { createManagerNotification } from "@/lib/manager-notifications";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ClientRow = {
  client_id: string;
  company_name: string;
};

type ReportRow = {
  id: string;
  report_title: string;
  status: "draft" | "processing" | "ready" | "failed";
  summary: Record<string, unknown> | null;
  created_at: string;
};

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ clientSlug: string; reportId: string }> },
) {
  const { clientSlug, reportId } = await context.params;
  const supabase = getSupabaseAdminClient();

  const clientResult = await supabase
    .from("clients")
    .select("client_id,company_name")
    .eq("portal_slug", clientSlug)
    .maybeSingle<ClientRow>();

  if (clientResult.error) {
    return NextResponse.json({ error: "Could not load client." }, { status: 500 });
  }
  if (!clientResult.data) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const reportResult = await supabase
    .from("client_reports")
    .select("id,report_title,status,summary,created_at")
    .eq("client_id", clientResult.data.client_id)
    .eq("id", reportId)
    .maybeSingle<ReportRow>();

  if (reportResult.error) {
    return NextResponse.json({ error: "Could not load report." }, { status: 500 });
  }
  if (!reportResult.data) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  try {
    await createManagerNotification(supabase, {
      clientId: clientResult.data.client_id,
      notificationType: "client_report_downloaded",
      title: `Cliente baixou relatorio: ${reportResult.data.report_title}`,
      message: `${clientResult.data.company_name} baixou um relatorio pelo portal do cliente.`,
      metadata: {
        clientSlug,
        clientCompanyName: clientResult.data.company_name,
        reportId: reportResult.data.id,
        reportTitle: reportResult.data.report_title,
        reportStatus: reportResult.data.status,
      },
    });
  } catch {
    // Do not block report delivery when notification persistence fails.
  }

  return NextResponse.json({
    report: {
      id: reportResult.data.id,
      title: reportResult.data.report_title,
      status: reportResult.data.status,
      createdAt: reportResult.data.created_at,
      summary: reportResult.data.summary ?? {},
    },
    fileName: `${reportResult.data.report_title.replace(/[^\w\-]+/g, "_") || "report"}-${
      reportResult.data.id
    }.json`,
  });
}
