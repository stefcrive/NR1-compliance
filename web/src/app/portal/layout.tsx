import Link from "next/link";

const NAV_ITEMS = [
  { href: "/portal", label: "Visao Geral" },
  { href: "/portal/campaigns", label: "Campanhas" },
  { href: "/portal/dashboard", label: "Dashboard" },
  { href: "/portal/drps/new", label: "Novo DRPS" },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f6f6f6]">
      <header className="border-b border-[#d8e4ee] bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[#0c556a]">Client Portal</p>
            <h1 className="text-lg font-semibold text-[#0f2e3c]">NR1 Compliance</h1>
          </div>
          <Link
            href="/"
            className="rounded-full border border-[#9ec8db] px-4 py-2 text-sm font-medium text-[#0b4f63] hover:bg-[#e8f3f8]"
          >
            Voltar para landing
          </Link>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[240px_1fr]">
        <aside className="h-fit rounded-2xl border border-[#d8e4ee] bg-white p-3 shadow-sm">
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-xl px-3 py-2 text-sm font-medium text-[#1f4252] hover:bg-[#e8f3f8]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <section>{children}</section>
      </div>
    </div>
  );
}
