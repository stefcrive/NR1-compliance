import { ClientHistoryEventRecord } from "@/components/client-history-event-record";

export default async function ClientHistoryEventRecordPage({
  params,
}: {
  params: Promise<{ clientSlug: string; eventId: string }>;
}) {
  const { clientSlug, eventId } = await params;
  return <ClientHistoryEventRecord clientSlug={clientSlug} eventId={eventId} />;
}
