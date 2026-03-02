import { ClientDiagnosticResultsSection } from "@/components/client-portal-sections";

export default async function ClientDiagnosticResultPage({
  params,
}: {
  params: Promise<{ clientSlug: string; campaignId: string }>;
}) {
  const { clientSlug, campaignId } = await params;
  return <ClientDiagnosticResultsSection clientSlug={clientSlug} campaignId={campaignId} />;
}
