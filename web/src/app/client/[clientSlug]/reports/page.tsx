import { ClientReportsSection } from "@/components/client-portal-sections";

export default async function ClientReportsPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  return <ClientReportsSection clientSlug={clientSlug} />;
}
