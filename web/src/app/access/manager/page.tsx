import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CompanyLogoLink } from "@/components/company-logo-link";
import { RoleLoginForm } from "@/components/role-login-form";
import { MANAGER_SESSION_COOKIE, parseManagerSessionToken } from "@/lib/auth/session";

export default async function ManagerAccessPage() {
  const cookieStore = await cookies();
  const session = parseManagerSessionToken(cookieStore.get(MANAGER_SESSION_COOKIE)?.value);

  if (session) {
    redirect("/manager/clients");
  }

  return (
    <main className="min-h-screen bg-[#f6f6f6] px-4 py-10">
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <header className="flex items-center justify-between rounded-[26px] border border-[#dfdfdf] bg-white p-4 shadow-sm">
          <CompanyLogoLink />
          <Link
            href="/access"
            className="rounded-full border border-[#c8c8c8] bg-white px-4 py-2 text-sm font-semibold text-[#1b2832]"
          >
            Back to role selection
          </Link>
        </header>

        <section className="rounded-[26px] border border-[#dfdfdf] bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[#5d6d77]">Manager Portal</p>
          <h1 className="mt-1 text-3xl font-semibold text-[#141d24]">Workspace Access</h1>
          <p className="mt-2 text-sm text-[#4a5862]">
            Authenticate to manage clients, diagnostics, and programs.
          </p>
        </section>

        <RoleLoginForm role="manager" />
      </div>
    </main>
  );
}
