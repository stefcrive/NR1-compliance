import { ClientWorkspace } from "@/components/client-workspace";

export default async function ClientCompanyDataPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  return <ClientWorkspace clientSlug={clientSlug} />;
}
