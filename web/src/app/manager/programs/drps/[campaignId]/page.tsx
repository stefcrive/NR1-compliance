import { ManagerDrpsDiagnosticEditor } from "@/components/manager-drps-diagnostic-editor";

export default async function ManagerDrpsDiagnosticPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  return <ManagerDrpsDiagnosticEditor campaignId={campaignId} />;
}
