"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ManagerLocaleProvider, useManagerLocale } from "@/components/manager-locale";

type IconProps = { className?: string };
type ManagerNotification = {
  id: string;
  clientId: string | null;
  notificationType: "client_reschedule_submitted" | "client_report_downloaded";
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
};

type ManagerClientNavItem = {
  id: string;
  companyName: string;
  updatedAt: string;
};

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

function HistoryIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M12 8v5l3 2" />
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v3h3" />
    </svg>
  );
}

function BellIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M6 9a6 6 0 1 1 12 0v4.3l1.2 2.4a1 1 0 0 1-.9 1.4H5.7a1 1 0 0 1-.9-1.4L6 13.3V9Z" />
      <path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" />
    </svg>
  );
}

const TOP_NAV = [
  { href: "/manager", labelKey: "home", icon: HomeIcon },
  { href: "/manager/clients", labelKey: "clientArea", icon: ListIcon },
  { href: "/manager/calendar", labelKey: "calendar", icon: CalendarIcon },
  { href: "/manager/history", labelKey: "history", icon: HistoryIcon },
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
    history: "History",
    programsDatabase: "Programs database",
    createClient: "Create client",
    recentClients: "Recent clients",
    new: "New",
    switchLabel: "Language",
    notifications: "Notifications",
    notificationsLoading: "Loading...",
    notificationsEmpty: "No notifications yet.",
    notificationsUnavailable: "Notifications unavailable right now.",
    markRead: "Mark as read",
    read: "Read",
    refresh: "Refresh",
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
    history: "Historico",
    programsDatabase: "Base de programas",
    createClient: "Criar cliente",
    recentClients: "Clientes recentes",
    new: "Novo",
    switchLabel: "Idioma",
    notifications: "Notificacoes",
    notificationsLoading: "Carregando...",
    notificationsEmpty: "Sem notificacoes ainda.",
    notificationsUnavailable: "Notificacoes indisponiveis no momento.",
    markRead: "Marcar como lida",
    read: "Lida",
    refresh: "Atualizar",
  },
} as const;

function formatNotificationDate(value: string, locale: "en" | "pt") {
  return new Intl.DateTimeFormat(locale === "pt" ? "pt-BR" : "en-US", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function ManagerShellInner({ children }: { children: React.ReactNode }) {
  const { locale, toggleLocale } = useManagerLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = COPY[locale];
  const notificationsPanelRef = useRef<HTMLDivElement | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [loadingNotifications, setLoadingNotifications] = useState(true);
  const [notificationsUnavailable, setNotificationsUnavailable] = useState(false);
  const [notifications, setNotifications] = useState<ManagerNotification[]>([]);
  const [markingNotificationId, setMarkingNotificationId] = useState<string | null>(null);
  const [recentClients, setRecentClients] = useState<ManagerClientNavItem[]>([]);

  const loadNotifications = useCallback(async () => {
    setLoadingNotifications(true);
    try {
      const response = await fetch("/api/admin/notifications?limit=12", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        notifications?: ManagerNotification[];
        notificationsUnavailable?: boolean;
      };
      if (!response.ok) {
        setNotifications([]);
        setNotificationsUnavailable(true);
        return;
      }
      setNotifications(payload.notifications ?? []);
      setNotificationsUnavailable(Boolean(payload.notificationsUnavailable));
    } finally {
      setLoadingNotifications(false);
    }
  }, []);

  const loadRecentClients = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/clients", { cache: "no-store" });
      if (!response.ok) {
        setRecentClients([]);
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        clients?: Array<{ id?: string; companyName?: string; updatedAt?: string }>;
      };
      const clients = (payload.clients ?? [])
        .filter(
          (item): item is { id: string; companyName: string; updatedAt: string } =>
            Boolean(item.id && item.companyName && item.updatedAt),
        )
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 3);
      setRecentClients(clients);
    } catch {
      setRecentClients([]);
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications, pathname]);

  useEffect(() => {
    void loadRecentClients();
  }, [loadRecentClients, pathname]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!notificationsPanelRef.current || !target) return;
      if (!notificationsPanelRef.current.contains(target)) {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.isRead).length,
    [notifications],
  );

  const markNotificationRead = useCallback(async (notificationId: string) => {
    setMarkingNotificationId(notificationId);
    try {
      const response = await fetch(`/api/admin/notifications/${notificationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      });
      if (!response.ok) return;
      setNotifications((previous) =>
        previous.map((notification) =>
          notification.id === notificationId ? { ...notification, isRead: true } : notification,
        ),
      );
    } finally {
      setMarkingNotificationId(null);
    }
  }, []);

  const isNavItemActive = (href: string) => {
    if (pathname.startsWith("/manager/history/events/")) {
      const source = searchParams.get("from");
      if (source === "client-area") return href === "/manager/clients";
      if (source === "calendar") return href === "/manager/calendar";
    }
    return href === "/manager" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <div className="min-h-screen bg-[#f6f6f6]">
      <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
        <aside className="border-b border-[#d7d7d7] bg-[#ececec] lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col">
            <div className="border-b border-[#d7d7d7] px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#5d6d77]">{t.portalLabel}</p>
              <h1 className="text-base font-semibold text-[#11191f]">{t.workspaceTitle}</h1>
              <div className="relative mt-3 flex items-center gap-2" ref={notificationsPanelRef}>
                <button
                  type="button"
                  onClick={toggleLocale}
                  className="rounded-full border border-[#c7cfd3] bg-white px-3 py-1.5 text-xs font-semibold text-[#2a3d49] hover:bg-[#f7f8f9]"
                  aria-label={t.switchLabel}
                >
                  {locale === "en" ? "PT" : "EN"}
                </button>
                <button
                  type="button"
                  onClick={() => setNotificationsOpen((previous) => !previous)}
                  className="relative rounded-full border border-[#c7cfd3] bg-white p-2 text-[#2a3d49] hover:bg-[#f7f8f9]"
                  aria-label={t.notifications}
                >
                  <BellIcon />
                  {unreadCount > 0 ? (
                    <span className="absolute -right-1 -top-1 rounded-full bg-[#0f5b73] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  ) : null}
                </button>
                {notificationsOpen ? (
                  <section className="absolute left-0 top-11 z-50 w-[350px] rounded-xl border border-[#cbd6dc] bg-white p-3 shadow-xl">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#60737f]">
                        {t.notifications}
                      </p>
                      <button
                        type="button"
                        onClick={() => void loadNotifications()}
                        className="rounded-full border border-[#d2dade] px-2.5 py-1 text-[11px] font-semibold text-[#2a3d49]"
                      >
                        {t.refresh}
                      </button>
                    </div>
                    <div className="mt-2 max-h-[340px] space-y-2 overflow-y-auto pr-1">
                      {loadingNotifications ? (
                        <p className="text-xs text-[#5f7481]">{t.notificationsLoading}</p>
                      ) : notificationsUnavailable ? (
                        <p className="text-xs text-[#8a5b2d]">{t.notificationsUnavailable}</p>
                      ) : notifications.length === 0 ? (
                        <p className="text-xs text-[#5f7481]">{t.notificationsEmpty}</p>
                      ) : (
                        notifications.map((notification) => (
                          <article
                            key={notification.id}
                            className={`rounded-lg border p-2 ${
                              notification.isRead
                                ? "border-[#e5edf2] bg-[#fafcfd]"
                                : "border-[#cde0ea] bg-[#f3f9fc]"
                            }`}
                          >
                            <p className="text-xs font-semibold text-[#173747]">{notification.title}</p>
                            <p className="mt-1 text-xs text-[#456676]">{notification.message}</p>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <p className="text-[11px] text-[#607d8c]">
                                {formatNotificationDate(notification.createdAt, locale)}
                              </p>
                              <div className="flex items-center gap-2">
                                {notification.clientId ? (
                                  <Link
                                    href={`/manager/clients/${notification.clientId}`}
                                    className="text-[11px] font-semibold text-[#0f5b73] hover:underline"
                                    onClick={() => setNotificationsOpen(false)}
                                  >
                                    {COPY[locale].clientArea}
                                  </Link>
                                ) : null}
                                {!notification.isRead ? (
                                  <button
                                    type="button"
                                    disabled={markingNotificationId === notification.id}
                                    onClick={() => void markNotificationRead(notification.id)}
                                    className="rounded-full border border-[#bfd4df] px-2 py-0.5 text-[10px] font-semibold text-[#18485d] disabled:opacity-50"
                                  >
                                    {markingNotificationId === notification.id
                                      ? `${t.markRead}...`
                                      : t.markRead}
                                  </button>
                                ) : (
                                  <span className="rounded-full border border-[#d7e5ee] px-2 py-0.5 text-[10px] text-[#5c7b8b]">
                                    {t.read}
                                  </span>
                                )}
                              </div>
                            </div>
                          </article>
                        ))
                      )}
                    </div>
                  </section>
                ) : null}
              </div>
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
                  {recentClients.length > 0 ? (
                    <>
                      <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6a7f8b]">
                        {t.recentClients}
                      </p>
                      {recentClients.map((client) => {
                        const href = `/manager/clients/${client.id}`;
                        const active = isNavItemActive(href);
                        return (
                          <Link
                            key={client.id}
                            href={href}
                            className={`block rounded-xl px-3 py-2 text-sm ${
                              active
                                ? "bg-white font-semibold text-[#0f1720]"
                                : "text-[#202f38] hover:bg-white/70"
                            }`}
                            title={client.companyName}
                          >
                            <span className="block truncate">{client.companyName}</span>
                          </Link>
                        );
                      })}
                    </>
                  ) : null}
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
