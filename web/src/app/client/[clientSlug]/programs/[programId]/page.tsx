import { ClientProgramDetailsSection } from "@/components/client-portal-sections";

export default async function ClientProgramDetailPage({
  params,
}: {
  params: Promise<{ clientSlug: string; programId: string }>;
}) {
  const { clientSlug, programId } = await params;
  return <ClientProgramDetailsSection clientSlug={clientSlug} programId={programId} />;
}
