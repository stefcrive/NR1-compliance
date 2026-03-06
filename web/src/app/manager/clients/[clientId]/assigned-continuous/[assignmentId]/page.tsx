import { ManagerAssignedContinuousProgram } from "@/components/manager-assigned-continuous-program";

export default async function ManagerAssignedContinuousProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string; assignmentId: string }>;
  searchParams?: Promise<{ from?: string }>;
}) {
  const { clientId, assignmentId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};

  return (
    <ManagerAssignedContinuousProgram
      clientId={clientId}
      assignmentId={assignmentId}
      fromHistory={resolvedSearchParams.from === "history"}
      fromHome={resolvedSearchParams.from === "home"}
    />
  );
}
