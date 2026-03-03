"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type IconProps = { className?: string };

function HomeIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.8V21h14V9.8" />
    </svg>
  );
}

function ClipboardIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M9 5h6" />
      <path d="M8 3h8v4H8z" />
      <path d="M6 7h12v14H6z" />
    </svg>
  );
}

function GridIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
    </svg>
  );
}

function ReportIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M15 3v4h4" />
      <path d="M9 11h6M9 15h6M9 19h4" />
    </svg>
  );
}

function ContractIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M7 4h10l2 2v12l-2 2H7l-2-2V6z" />
      <path d="M9 10h6M9 14h6" />
      <circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="18" r="1" />
    </svg>
  );
}

function LinkIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M10 14 7 17a4 4 0 1 1-6-6l3-3a4 4 0 0 1 6 0" />
      <path d="m14 10 3-3a4 4 0 0 1 6 6l-3 3a4 4 0 0 1-6 0" />
      <path d="m8 16 8-8" />
    </svg>
  );
}

const NAV_ITEMS = [
  { key: "diagnostic", suffix: "diagnostic", label: "DRPS Diagnostics", icon: ClipboardIcon },
  { key: "programs", suffix: "programs", label: "Continuous Program", icon: GridIcon },
  { key: "reports", suffix: "reports", label: "Reports", icon: ReportIcon },
  { key: "contracts", suffix: "contracts", label: "Contracts and invoces", icon: ContractIcon },
] as const;

export function ClientShell({
  clientSlug,
  children,
}: {
  clientSlug: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const companyHref = `/client/${clientSlug}/company`;
  const surveyEntryHref = `/s/demo-nr1-2026`;

  return (
    <div className="min-h-screen bg-[#f6f6f6]">
      <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
        <aside className="border-b border-[#d7d7d7] bg-[#ececec] lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col">
            <div className="border-b border-[#d7d7d7] px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#5d6d77]">Client Portal</p>
              <h1 className="text-base font-semibold text-[#11191f]">Company Workspace</h1>
            </div>

            <div className="flex-1 overflow-y-auto">
              <section className="px-2 py-3">
                <p className="px-2 pb-2 text-xs font-semibold text-[#697983]">Main</p>
                <nav className="space-y-1">
                  <Link
                    href={companyHref}
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                      pathname === companyHref || pathname === `/client/${clientSlug}`
                        ? "bg-white font-semibold text-[#0f1720]"
                        : "text-[#202f38] hover:bg-white/70"
                    }`}
                  >
                    <HomeIcon />
                    <span>Home</span>
                  </Link>
                  {NAV_ITEMS.map((item) => {
                    const href = `/client/${clientSlug}/${item.suffix}`;
                    const Icon = item.icon;
                    const active = pathname === href || pathname.startsWith(`${href}/`);
                    return (
                      <Link
                        key={item.key}
                        href={href}
                        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                          active
                            ? "bg-white font-semibold text-[#0f1720]"
                            : "text-[#202f38] hover:bg-white/70"
                        }`}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </nav>
              </section>

              <section className="border-t border-[#d7d7d7] px-2 py-3">
                <p className="px-2 pb-2 text-xs font-semibold text-[#697983]">Utility</p>
                <nav className="space-y-1">
                  <Link
                    href={surveyEntryHref}
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-[#202f38] hover:bg-white/70"
                  >
                    <LinkIcon />
                    <span>Employee survey entry</span>
                  </Link>
                </nav>
              </section>
            </div>

            <div className="border-t border-[#d7d7d7] p-3">
              <Link
                href="/access"
                className="flex items-center justify-center rounded-xl border border-[#c4ccd1] bg-white px-3 py-2 text-sm font-medium text-[#23353f] hover:bg-[#f7f8f9]"
              >
                Back to gateway
              </Link>
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          <div className="mx-auto w-full max-w-[1700px] px-4 py-4 sm:px-6 lg:px-8 lg:py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
