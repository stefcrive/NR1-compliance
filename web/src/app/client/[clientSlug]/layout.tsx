import { ClientShell } from "@/components/client-shell";

export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  return <ClientShell clientSlug={clientSlug}>{children}</ClientShell>;
}
