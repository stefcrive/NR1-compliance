import { ManagerHistoryEventRecord } from "@/components/manager-history-event-record";

export default async function ManagerHistoryEventRecordPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <ManagerHistoryEventRecord eventId={eventId} />;
}
