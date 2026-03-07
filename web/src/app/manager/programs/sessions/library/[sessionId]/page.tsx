import { ManagerSessionDetail } from "@/components/manager-session-detail";

export default async function ManagerLibrarySessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams?: Promise<{ returnTo?: string | string[] }>;
}) {
  const { sessionId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const returnTo = Array.isArray(resolvedSearchParams.returnTo)
    ? resolvedSearchParams.returnTo[0]
    : resolvedSearchParams.returnTo;
  return <ManagerSessionDetail source="library" sessionId={sessionId} returnTo={returnTo} />;
}
