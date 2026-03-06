import { ClientDiagnosticAggregateResultsSection } from "@/components/client-portal-sections";

export default async function ClientDiagnosticResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string; campaignId: string }>;
  searchParams?: Promise<{ from?: string; sector?: string }>;
}) {
  const { clientSlug, campaignId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  return (
    <ClientDiagnosticAggregateResultsSection
      clientSlug={clientSlug}
      campaignId={campaignId}
      fromHistory={resolvedSearchParams.from === "history"}
      fromReports={resolvedSearchParams.from === "reports"}
      sectorFilter={resolvedSearchParams.sector}
    />
  );
}
