import { ClientDiagnosticResultsSection } from "@/components/client-portal-sections";

export default async function ClientDiagnosticResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string; campaignId: string }>;
  searchParams?: Promise<{ from?: string }>;
}) {
  const { clientSlug, campaignId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  return (
    <ClientDiagnosticResultsSection
      clientSlug={clientSlug}
      campaignId={campaignId}
      fromHistory={resolvedSearchParams.from === "history"}
    />
  );
}
