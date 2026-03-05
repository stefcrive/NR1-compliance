import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ManagerShell } from "@/components/manager-shell";
import { MANAGER_SESSION_COOKIE, parseManagerSessionToken } from "@/lib/auth/session";

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const session = parseManagerSessionToken(cookieStore.get(MANAGER_SESSION_COOKIE)?.value);

  if (!session) {
    redirect("/access/manager");
  }

  return <ManagerShell>{children}</ManagerShell>;
}
