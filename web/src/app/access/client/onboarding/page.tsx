"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { CompanyLogoLink } from "@/components/company-logo-link";

type InvitationResponse = {
  invitation?: {
    companyName: string;
    clientSlug: string;
    status: "pending" | "accepted" | "expired" | "revoked";
    expiresAt: string;
    hasCredentials: boolean;
    loginEmail: string | null;
  };
  error?: string;
};

type OnboardingResponse = {
  redirectTo?: string;
  error?: string;
};

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export default function ClientOnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tokenFromUrl = useMemo(() => searchParams.get("token")?.trim() ?? "", [searchParams]);

  const [token, setToken] = useState(tokenFromUrl);
  const [invitation, setInvitation] = useState<InvitationResponse["invitation"] | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loadingInvitation, setLoadingInvitation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setToken(tokenFromUrl);
  }, [tokenFromUrl]);

  useEffect(() => {
    if (!tokenFromUrl) {
      setInvitation(null);
      return;
    }

    const controller = new AbortController();
    setLoadingInvitation(true);
    setError("");

    fetch(`/api/auth/client/onboarding?token=${encodeURIComponent(tokenFromUrl)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as InvitationResponse;
        if (!response.ok || !payload.invitation) {
          throw new Error(payload.error ?? "Invitation not found.");
        }
        setInvitation(payload.invitation);
        if (payload.invitation.loginEmail) {
          setEmail(payload.invitation.loginEmail);
        }
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setInvitation(null);
        setError(loadError instanceof Error ? loadError.message : "Could not validate invitation link.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingInvitation(false);
        }
      });

    return () => controller.abort();
  }, [tokenFromUrl]);

  const canCreateCredentials =
    invitation?.status === "pending" && !invitation.hasCredentials;

  async function validateToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInvitation(null);

    const normalizedToken = token.trim();
    if (!normalizedToken) {
      setError("Paste the invitation token or open this page from the invitation link.");
      return;
    }

    setLoadingInvitation(true);
    try {
      const response = await fetch(
        `/api/auth/client/onboarding?token=${encodeURIComponent(normalizedToken)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => ({}))) as InvitationResponse;
      if (!response.ok || !payload.invitation) {
        throw new Error(payload.error ?? "Invitation not found.");
      }
      setInvitation(payload.invitation);
      if (payload.invitation.loginEmail) {
        setEmail(payload.invitation.loginEmail);
      }
      router.replace(`/access/client/onboarding?token=${encodeURIComponent(normalizedToken)}`);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Could not validate invitation.");
    } finally {
      setLoadingInvitation(false);
    }
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreateCredentials) return;

    setError("");

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter the login email.");
      return;
    }
    if (password.length < 8) {
      setError("Password must have at least 8 characters.");
      return;
    }
    if (password !== passwordConfirm) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/client/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          email: normalizedEmail,
          password,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as OnboardingResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not create credentials.");
      }
      router.push(payload.redirectTo ?? `/client/${invitation.clientSlug}/company`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not create credentials.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f6f6] px-4 py-10">
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <header className="flex items-center justify-between rounded-[26px] border border-[#dfdfdf] bg-white p-4 shadow-sm">
          <CompanyLogoLink />
          <Link
            href="/access/client"
            className="rounded-full border border-[#c8c8c8] bg-white px-4 py-2 text-sm font-semibold text-[#1b2832]"
          >
            Back to client login
          </Link>
        </header>

        <section className="rounded-[26px] border border-[#dfdfdf] bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-[#5d6d77]">Client Onboarding</p>
          <h1 className="mt-1 text-3xl font-semibold text-[#141d24]">Create company credentials</h1>
          <p className="mt-2 text-sm text-[#4a5862]">
            Use the invitation link sent by the manager to create your company login.
          </p>
        </section>

        <section className="space-y-4 rounded-[26px] border border-[#dfdfdf] bg-white p-5 shadow-sm">
          <form onSubmit={validateToken} className="space-y-2">
            <label className="block space-y-1">
              <span className="text-sm text-[#485762]">Invitation token</span>
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="w-full rounded-xl border border-[#c8c8c8] bg-white px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={loadingInvitation}
              className="rounded-full border border-[#9ec8db] px-4 py-2 text-xs font-semibold text-[#0f5b73] disabled:opacity-50"
            >
              {loadingInvitation ? "Validating..." : "Validate invitation"}
            </button>
          </form>

          {invitation ? (
            <div className="rounded-xl border border-[#d8e4ee] bg-white p-4">
              <p className="text-sm font-semibold text-[#123447]">Company: {invitation.companyName}</p>
              <p className="mt-1 text-xs text-[#4f6977]">Workspace slug: {invitation.clientSlug}</p>
              <p className="mt-1 text-xs text-[#4f6977]">Status: {invitation.status}</p>
              <p className="mt-1 text-xs text-[#4f6977]">Expires at: {formatDate(invitation.expiresAt)}</p>
              {invitation.hasCredentials ? (
                <p className="mt-1 text-xs text-[#4f6977]">
                  Credentials already configured: {invitation.loginEmail ?? "-"}
                </p>
              ) : null}
            </div>
          ) : null}

          {canCreateCredentials ? (
            <form onSubmit={submitCredentials} className="space-y-3 rounded-xl border border-[#d8e4ee] bg-white p-4">
              <label className="block space-y-1">
                <span className="text-sm text-[#485762]">Login email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-xl border border-[#c8c8c8] bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-[#485762]">Password</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-[#c8c8c8] bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-[#485762]">Confirm password</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={passwordConfirm}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                  className="w-full rounded-xl border border-[#c8c8c8] bg-white px-3 py-2 text-sm"
                />
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="rounded-full bg-[#131313] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {submitting ? "Creating account..." : "Create credentials"}
              </button>
            </form>
          ) : invitation?.hasCredentials || invitation?.status === "accepted" ? (
            <p className="text-sm text-[#35515f]">
              This company already has credentials. Use the client login page.
            </p>
          ) : invitation?.status === "expired" ? (
            <p className="text-sm text-[#8a5b2d]">
              This invitation has expired. Ask the manager to generate a new link.
            </p>
          ) : invitation?.status === "revoked" ? (
            <p className="text-sm text-[#8a2d2d]">
              This invitation was revoked. Ask the manager for a valid link.
            </p>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}
