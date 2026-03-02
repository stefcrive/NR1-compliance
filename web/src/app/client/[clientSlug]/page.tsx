import { redirect } from "next/navigation";

export default async function ClientPortalPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  redirect(`/client/${clientSlug}/company`);
}
