import { ManagerContinuousProgramEditor } from "@/components/manager-continuous-program-editor";

export default async function ManagerContinuousProgramPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  return <ManagerContinuousProgramEditor programId={programId} />;
}
