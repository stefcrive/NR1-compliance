import { ManagerAssignedContinuousProgram } from "@/components/manager-assigned-continuous-program";

export default async function ManagerAssignedContinuousProgramPage({
  params,
}: {
  params: Promise<{ clientId: string; assignmentId: string }>;
}) {
  const { clientId, assignmentId } = await params;

  return (
    <ManagerAssignedContinuousProgram
      clientId={clientId}
      assignmentId={assignmentId}
    />
  );
}
