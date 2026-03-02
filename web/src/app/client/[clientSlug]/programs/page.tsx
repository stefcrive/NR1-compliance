import { ClientProgramsListSection } from "@/components/client-portal-sections";

export default async function ClientProgramsPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  return <ClientProgramsListSection clientSlug={clientSlug} />;
}
