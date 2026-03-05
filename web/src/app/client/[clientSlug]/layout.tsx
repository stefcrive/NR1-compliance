import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ClientShell } from "@/components/client-shell";
import { CLIENT_SESSION_COOKIE, parseClientSessionToken } from "@/lib/auth/session";

export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const cookieStore = await cookies();
  const session = parseClientSessionToken(cookieStore.get(CLIENT_SESSION_COOKIE)?.value);

  if (!session || session.clientSlug !== clientSlug) {
    redirect(`/access/client?clientSlug=${encodeURIComponent(clientSlug)}`);
  }

  return <ClientShell clientSlug={clientSlug}>{children}</ClientShell>;
}
