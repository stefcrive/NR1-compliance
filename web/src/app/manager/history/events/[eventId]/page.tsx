import { ManagerHistoryEventRecord } from "@/components/manager-history-event-record";

export default async function ManagerHistoryEventRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams?: Promise<{ from?: string }>;
}) {
  const { eventId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  return <ManagerHistoryEventRecord eventId={eventId} from={resolvedSearchParams.from} />;
}
