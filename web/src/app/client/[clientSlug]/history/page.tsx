import { ClientHistory } from "@/components/client-history";

export default async function ClientHistoryPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  return <ClientHistory clientSlug={clientSlug} />;
}
