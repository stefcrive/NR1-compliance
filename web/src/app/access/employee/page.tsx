import Link from "next/link";
import { CompanyLogoLink } from "@/components/company-logo-link";
import { RoleLoginForm } from "@/components/role-login-form";

export default function EmployeeAccessPage() {
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

        <header className="rounded-[26px] border border-[#dfdfdf] bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[#5d6d77]">Employee Portal</p>
          <h1 className="mt-1 text-3xl font-semibold text-[#141d24]">Survey Access</h1>
          <p className="mt-2 text-sm text-[#4a5862]">
            Enter through a secure campaign link or by campaign slug and optional token.
          </p>
        </header>
        <RoleLoginForm role="employee" />
      </div>
    </main>
  );
}
