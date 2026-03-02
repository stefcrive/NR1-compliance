import { ClientDiagnosticStatusSection } from "@/components/client-portal-sections";

export default async function ClientDiagnosticPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  return <ClientDiagnosticStatusSection clientSlug={clientSlug} />;
}
