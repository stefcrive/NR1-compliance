"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ManagerLocaleProvider, useManagerLocale } from "@/components/manager-locale";

type IconProps = { className?: string };

function HomeIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.8V21h14V9.8" />
    </svg>
  );
}

function CalendarIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M4 7h16v13H4z" />
      <path d="M4 11h16" />
      <path d="M8 3v4M16 3v4" />
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

function PlusIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ListIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

const TOP_NAV = [
  { href: "/manager", labelKey: "home", icon: HomeIcon },
  { href: "/manager/clients", labelKey: "clientArea", icon: ListIcon },
  { href: "/manager/calendar", labelKey: "calendar", icon: CalendarIcon },
  { href: "/manager/programs", labelKey: "programsDatabase", icon: GridIcon },
] as const;

const PINNED_NAV = [
  { href: "/manager/clients/new", labelKey: "createClient", icon: PlusIcon, isNew: true },
] as const;

const COPY = {
  en: {
    portalLabel: "Manager Portal",
    workspaceTitle: "Compliance Workspace",
    mainNav: "Main",
    pinned: "Pinned",
    backToGateway: "Back to gateway",
    home: "Home",
    clientArea: "Client area",
    calendar: "Calendar",
    programsDatabase: "Programs database",
    createClient: "Create client",
    new: "New",
    switchLabel: "Language",
  },
  pt: {
    portalLabel: "Portal do Gestor",
    workspaceTitle: "Workspace de Compliance",
    mainNav: "Principal",
    pinned: "Fixados",
    backToGateway: "Voltar ao acesso",
    home: "Inicio",
    clientArea: "Area de clientes",
    calendar: "Calendario",
    programsDatabase: "Base de programas",
    createClient: "Criar cliente",
    new: "Novo",
    switchLabel: "Idioma",
  },
} as const;

function ManagerShellInner({ children }: { children: React.ReactNode }) {
  const { locale, toggleLocale } = useManagerLocale();
  const pathname = usePathname();
  const t = COPY[locale];
  const isNavItemActive = (href: string) =>
    href === "/manager" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="min-h-screen bg-[#f6f6f6]">
      <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
        <aside className="border-b border-[#d7d7d7] bg-[#ececec] lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col">
            <div className="border-b border-[#d7d7d7] px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#5d6d77]">{t.portalLabel}</p>
              <h1 className="text-base font-semibold text-[#11191f]">{t.workspaceTitle}</h1>
              <button
                type="button"
                onClick={toggleLocale}
                className="mt-3 rounded-full border border-[#c7cfd3] bg-white px-3 py-1.5 text-xs font-semibold text-[#2a3d49] hover:bg-[#f7f8f9]"
                aria-label={t.switchLabel}
              >
                {locale === "en" ? "PT" : "EN"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <section className="px-2 py-3">
                <p className="px-2 pb-2 text-xs font-semibold text-[#697983]">{t.mainNav}</p>
                <nav className="space-y-1">
                  {TOP_NAV.map((item) => {
                    const Icon = item.icon;
                    const active = isNavItemActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                          active
                            ? "bg-white font-semibold text-[#0f1720]"
                            : "text-[#202f38] hover:bg-white/70"
                        }`}
                      >
                        <Icon />
                        <span>{t[item.labelKey]}</span>
                      </Link>
                    );
                  })}
                </nav>
              </section>

              <section className="border-t border-[#d7d7d7] px-2 py-3">
                <p className="px-2 pb-2 text-xs font-semibold text-[#697983]">{t.pinned}</p>
                <nav className="space-y-1">
                  {PINNED_NAV.map((item) => {
                    const Icon = item.icon;
                    const active = isNavItemActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                          active
                            ? "bg-white font-semibold text-[#0f1720]"
                            : "text-[#202f38] hover:bg-white/70"
                        }`}
                      >
                        <Icon />
                        <span className="truncate">{t[item.labelKey]}</span>
                        {item.isNew ? (
                          <span className="ml-auto rounded-md bg-[#d7e4ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#395798]">
                            {t.new}
                          </span>
                        ) : null}
                      </Link>
                    );
                  })}
                </nav>
              </section>

            </div>

            <div className="border-t border-[#d7d7d7] p-3">
              <Link
                href="/access"
                className="flex items-center justify-center rounded-xl border border-[#c4ccd1] bg-white px-3 py-2 text-sm font-medium text-[#23353f] hover:bg-[#f7f8f9]"
              >
                {t.backToGateway}
              </Link>
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          <div className="mx-auto w-full max-w-[1700px] px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function ManagerShell({ children }: { children: React.ReactNode }) {
  return (
    <ManagerLocaleProvider>
      <ManagerShellInner>{children}</ManagerShellInner>
    </ManagerLocaleProvider>
  );
}
