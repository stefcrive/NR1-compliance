import { ManagerClientFicha } from "@/components/manager-client-ficha";

export default async function ManagerClientFichaPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  return <ManagerClientFicha clientId={clientId} />;
}
