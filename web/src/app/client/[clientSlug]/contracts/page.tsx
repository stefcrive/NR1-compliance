import { ClientContractsInvoicesSection } from "@/components/client-portal-sections";

export default async function ClientContractsPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  return <ClientContractsInvoicesSection clientSlug={clientSlug} />;
}
