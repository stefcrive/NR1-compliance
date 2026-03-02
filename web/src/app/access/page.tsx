import Link from "next/link";
import { CompanyLogoLink } from "@/components/company-logo-link";

const ROLES = [
  {
    title: "Manager",
    description:
      "Consultancy workspace: clients table, DRPS diagnostics calendar, and programs database.",
    href: "/access/manager",
    devHref: "/manager/clients",
  },
  {
    title: "Client",
    description:
      "Company workspace: company metrics, DRPS diagnostics, and continuous programs.",
    href: "/access/client",
    devHref: "/client/techcorp-brasil/company",
  },
  {
    title: "Employee",
    description:
      "Direct questionnaire flow through secure tokenized diagnostic links.",
    href: "/access/employee",
    devHref: "/s/demo-nr1-2026",
  },
];

export default function AccessGatewayPage() {
  return (
    <main className="min-h-screen bg-[#f6f6f6] px-4 py-10">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header className="flex items-center justify-between rounded-[26px] border border-[#dfdfdf] bg-[#f4f4f4] p-4 shadow-sm">
          <CompanyLogoLink />
          <Link
            href="/"
            className="rounded-full border border-[#c8c8c8] bg-white px-4 py-2 text-sm font-semibold text-[#1b2832]"
          >
            Landing Page
          </Link>
        </header>

        <section className="rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[#5d6d77]">Platform Gateway</p>
          <h1 className="mt-2 text-3xl font-semibold text-[#141d24]">Select your role</h1>
          <p className="mt-2 text-sm text-[#4a5862]">
            Choose how you access the platform. Each role redirects to its specific login flow and workspace.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {ROLES.map((role) => (
            <article key={role.title} className="rounded-2xl border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm">
              <h2 className="text-xl font-semibold text-[#141d24]">{role.title}</h2>
              <p className="mt-2 text-sm text-[#4a5862]">{role.description}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href={role.href}
                  className="inline-flex rounded-full border border-[#c8c8c8] bg-white px-4 py-2 text-sm font-semibold text-[#1b2832]"
                >
                  Continue
                </Link>
                {process.env.NODE_ENV !== "production" ? (
                  <Link
                    href={role.devHref}
                    className="inline-flex rounded-full border border-[#dfcfb0] bg-[#fbf5e9] px-4 py-2 text-sm font-semibold text-[#744d14]"
                  >
                    Dev login
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
