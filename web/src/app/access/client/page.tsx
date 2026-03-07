import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CompanyLogoLink } from "@/components/company-logo-link";
import { RoleLoginForm } from "@/components/role-login-form";
import { CLIENT_SESSION_COOKIE, parseClientSessionToken } from "@/lib/auth/session";

export default async function ClientAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ blocked?: string }>;
}) {
  const { blocked } = await searchParams;
  const blockedByPolicy = blocked === "1";
  const cookieStore = await cookies();
  const session = parseClientSessionToken(cookieStore.get(CLIENT_SESSION_COOKIE)?.value);

  if (session && !blockedByPolicy) {
    redirect(`/client/${session.clientSlug}/company`);
  }

  return (
    <main className="min-h-screen bg-[#f6f6f6] px-4 py-10">
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <header className="flex items-center justify-between rounded-[26px] border border-[#dfdfdf] bg-[#f4f4f4] p-4 shadow-sm">
          <CompanyLogoLink />
          <Link
            href="/access"
            className="rounded-full border border-[#c8c8c8] bg-white px-4 py-2 text-sm font-semibold text-[#1b2832]"
          >
            Back to role selection
          </Link>
        </header>

        <header className="rounded-[26px] border border-[#dfdfdf] bg-[#f4f4f4] p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[#5d6d77]">Client Portal</p>
          <h1 className="mt-1 text-3xl font-semibold text-[#141d24]">Company Access</h1>
          <p className="mt-2 text-sm text-[#4a5862]">
            Authenticate and enter your company workspace for diagnostics and programs.
          </p>
          {blockedByPolicy ? (
            <p className="mt-3 rounded-lg border border-[#f0c9c9] bg-[#fff5f5] px-3 py-2 text-sm text-[#8f2a2a]">
              Client access is currently blocked for this workspace.
            </p>
          ) : null}
        </header>
        <RoleLoginForm role="client" />
      </div>
    </main>
  );
}
