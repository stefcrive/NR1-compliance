import { ManagerClientAssignDrps } from "@/components/manager-client-assign-drps";

export default async function ManagerClientAssignDrpsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ManagerClientAssignDrps clientId={clientId} />;
}
