import { ClientDiagnosticResultsSection } from "@/components/client-portal-sections";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ClientPortalLookup = {
  portal_slug: string | null;
  company_name: string | null;
};

export default async function ManagerClientDiagnosticResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string; campaignId: string }>;
  searchParams?: Promise<{ from?: string }>;
}) {
  const { clientId, campaignId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("clients")
    .select("portal_slug,company_name")
    .eq("client_id", clientId)
    .maybeSingle<ClientPortalLookup>();

  if (error || !data?.portal_slug) {
    return <p className="text-sm text-red-600">Cliente indisponivel para abrir resultados do diagnostico.</p>;
  }

  return (
    <ClientDiagnosticResultsSection
      clientSlug={data.portal_slug}
      campaignId={campaignId}
      managerClientId={clientId}
      managerClientName={data.company_name}
      managerFromHome={resolvedSearchParams.from === "home"}
    />
  );
}
