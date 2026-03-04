import { ManagerClientFicha } from "@/components/manager-client-ficha";

export default async function ManagerClientHistoryPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ManagerClientFicha clientId={clientId} initialTab="history" />;
}
