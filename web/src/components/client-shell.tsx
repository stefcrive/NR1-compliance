"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type IconProps = { className?: string };
type ClientNotification = {
  id: string;
  clientId: string;
  notificationType:
    | "manager_drps_assigned"
    | "manager_program_assigned"
    | "manager_report_issued"
    | "company_risk_profile_reminder"
    | "manager_calendar_event_status_changed";
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
};

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

function HistoryIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M12 8v5l3 2" />
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v3h3" />
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

function BellIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M6 9a6 6 0 1 1 12 0v4.3l1.2 2.4a1 1 0 0 1-.9 1.4H5.7a1 1 0 0 1-.9-1.4L6 13.3V9Z" />
      <path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" />
    </svg>
  );
}

const NAV_ITEMS = [
  { key: "diagnostic", suffix: "diagnostic", label: "DRPS Diagnostics", icon: ClipboardIcon },
  { key: "programs", suffix: "programs", label: "Continuous Program", icon: GridIcon },
  { key: "reports", suffix: "reports", label: "Reports", icon: ReportIcon },
  { key: "history", suffix: "history", label: "History", icon: HistoryIcon },
  { key: "contracts", suffix: "contracts", label: "Contracts and invoces", icon: ContractIcon },
] as const;

function formatNotificationDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function ClientShell({
  clientSlug,
  children,
}: {
  clientSlug: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const notificationsPanelRef = useRef<HTMLDivElement | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [loadingNotifications, setLoadingNotifications] = useState(true);
  const [notificationsUnavailable, setNotificationsUnavailable] = useState(false);
  const [notifications, setNotifications] = useState<ClientNotification[]>([]);
  const [markingNotificationId, setMarkingNotificationId] = useState<string | null>(null);
  const companyHref = `/client/${clientSlug}/company`;
  const surveyEntryHref = `/s/demo-nr1-2026`;
  const viewingFromHistorySection =
    searchParams.get("from") === "history" &&
    (pathname.startsWith(`/client/${clientSlug}/diagnostic/`) ||
      pathname.startsWith(`/client/${clientSlug}/programs/`));

  const loadNotifications = useCallback(async () => {
    setLoadingNotifications(true);
    try {
      const response = await fetch(
        `/api/client/portal/${encodeURIComponent(clientSlug)}/notifications?limit=12`,
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        notifications?: ClientNotification[];
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
  }, [clientSlug]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications, pathname]);

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

  const markNotificationRead = useCallback(
    async (notificationId: string) => {
      setMarkingNotificationId(notificationId);
      try {
        const response = await fetch(
          `/api/client/portal/${encodeURIComponent(clientSlug)}/notifications/${notificationId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isRead: true }),
          },
        );
        if (!response.ok) return;
        setNotifications((previous) =>
          previous.map((notification) =>
            notification.id === notificationId ? { ...notification, isRead: true } : notification,
          ),
        );
      } finally {
        setMarkingNotificationId(null);
      }
    },
    [clientSlug],
  );

  return (
    <div className="min-h-screen bg-[#f6f6f6]">
      <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
        <aside className="border-b border-[#d7d7d7] bg-[#ececec] lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col">
            <div className="border-b border-[#d7d7d7] px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#5d6d77]">Client Portal</p>
              <h1 className="text-base font-semibold text-[#11191f]">Company Workspace</h1>
              <div className="relative mt-3 flex items-center gap-2" ref={notificationsPanelRef}>
                <button
                  type="button"
                  onClick={() => setNotificationsOpen((previous) => !previous)}
                  className="relative rounded-full border border-[#c7cfd3] bg-white p-2 text-[#2a3d49] hover:bg-[#f7f8f9]"
                  aria-label="Notifications"
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
                        Notifications
                      </p>
                      <button
                        type="button"
                        onClick={() => void loadNotifications()}
                        className="rounded-full border border-[#d2dade] px-2.5 py-1 text-[11px] font-semibold text-[#2a3d49]"
                      >
                        Refresh
                      </button>
                    </div>
                    <div className="mt-2 max-h-[340px] space-y-2 overflow-y-auto pr-1">
                      {loadingNotifications ? (
                        <p className="text-xs text-[#5f7481]">Loading...</p>
                      ) : notificationsUnavailable ? (
                        <p className="text-xs text-[#8a5b2d]">Notifications unavailable right now.</p>
                      ) : notifications.length === 0 ? (
                        <p className="text-xs text-[#5f7481]">No notifications yet.</p>
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
                                {formatNotificationDate(notification.createdAt)}
                              </p>
                              {!notification.isRead ? (
                                <button
                                  type="button"
                                  disabled={markingNotificationId === notification.id}
                                  onClick={() => void markNotificationRead(notification.id)}
                                  className="rounded-full border border-[#bfd4df] px-2 py-0.5 text-[10px] font-semibold text-[#18485d] disabled:opacity-50"
                                >
                                  {markingNotificationId === notification.id ? "Marking..." : "Mark as read"}
                                </button>
                              ) : (
                                <span className="rounded-full border border-[#d7e5ee] px-2 py-0.5 text-[10px] text-[#5c7b8b]">
                                  Read
                                </span>
                              )}
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
                    const baseActive = pathname === href || pathname.startsWith(`${href}/`);
                    const active =
                      item.key === "history"
                        ? baseActive || viewingFromHistorySection
                        : item.key === "diagnostic" || item.key === "programs"
                          ? baseActive && !viewingFromHistorySection
                          : baseActive;
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
