import { ManagerSessionDetail } from "@/components/manager-session-detail";

export default async function ManagerProgramSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string; sessionId: string }>;
  searchParams?: Promise<{ returnTo?: string | string[] }>;
}) {
  const { programId, sessionId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const returnTo = Array.isArray(resolvedSearchParams.returnTo)
    ? resolvedSearchParams.returnTo[0]
    : resolvedSearchParams.returnTo;
  return (
    <ManagerSessionDetail
      source="program"
      programId={programId}
      sessionId={sessionId}
      returnTo={returnTo}
    />
  );
}
