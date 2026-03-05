"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Role = "manager" | "client" | "employee";

type LoginResponse = {
  redirectTo?: string;
  error?: string;
};

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function postLogin<TBody extends Record<string, unknown>>(
  endpoint: string,
  body: TBody,
): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as LoginResponse;
  if (!response.ok) {
    throw new Error(payload.error ?? "Could not authenticate.");
  }

  return payload.redirectTo ?? "/";
}

export function RoleLoginForm({ role }: { role: Role }) {
  const router = useRouter();
  const isDev = process.env.NODE_ENV !== "production";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [clientSlug, setClientSlug] = useState("");
  const [directLink, setDirectLink] = useState("");
  const [campaignSlug, setCampaignSlug] = useState("demo-nr1-2026");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const title = useMemo(() => {
    if (role === "manager") return "Manager Login";
    if (role === "client") return "Client Login";
    return "Employee Access";
  }, [role]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (role === "manager") {
      if (!email.trim() || !password.trim()) {
        setError("Enter email and password.");
        return;
      }

      setIsSubmitting(true);
      try {
        const redirectTo = await postLogin("/api/auth/manager/login", {
          email: email.trim(),
          password,
        });
        router.push(redirectTo || "/manager/clients");
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Could not authenticate manager login.");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (role === "client") {
      if (!email.trim() || !password.trim()) {
        setError("Enter email and password.");
        return;
      }

      setIsSubmitting(true);
      try {
        const normalizedSlug = normalizeSlug(clientSlug);
        const redirectTo = await postLogin("/api/auth/client/login", {
          email: email.trim(),
          password,
          clientSlug: normalizedSlug || undefined,
        });
        router.push(redirectTo || "/access/client");
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Could not authenticate client login.");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (directLink.trim()) {
      try {
        const parsed = new URL(directLink.trim(), window.location.origin);
        router.push(`${parsed.pathname}${parsed.search}`);
        return;
      } catch {
        setError("Invalid direct link.");
        return;
      }
    }

    const slug = normalizeSlug(campaignSlug);
    if (!slug) {
      setError("Enter campaign slug or direct link.");
      return;
    }
    const query = token.trim() ? `?token=${encodeURIComponent(token.trim())}` : "";
    router.push(`/s/${slug}${query}`);
  }

  async function handleDevLogin() {
    setError("");

    if (role === "employee") {
      router.push("/s/demo-nr1-2026");
      return;
    }

    setIsSubmitting(true);
    try {
      if (role === "manager") {
        const redirectTo = await postLogin("/api/auth/manager/login", {
          devBypass: true,
          email: email.trim() || undefined,
        });
        router.push(redirectTo || "/manager/clients");
        return;
      }

      const slug = normalizeSlug(clientSlug) || "techcorp-brasil";
      const redirectTo = await postLogin("/api/auth/client/login", {
        devBypass: true,
        clientSlug: slug,
        email: email.trim() || undefined,
      });
      router.push(redirectTo || `/client/${slug}/company`);
    } catch (devError) {
      setError(devError instanceof Error ? devError.message : "Could not complete dev login.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-[26px] border border-[#dfdfdf] bg-[#f8f8f8] p-5 shadow-sm"
    >
      <h1 className="text-2xl font-semibold text-[#141d24]">{title}</h1>

      {isDev ? (
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => void handleDevLogin()}
          className="rounded-full border border-[#dfcfb0] bg-[#fbf5e9] px-4 py-2 text-sm font-semibold text-[#744d14] disabled:opacity-50"
        >
          Temporary dev login (bypass credentials)
        </button>
      ) : null}

      {role === "manager" || role === "client" ? (
        <>
          <label className="block space-y-1">
            <span className="text-sm text-[#485762]">Email</span>
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
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-[#c8c8c8] bg-white px-3 py-2 text-sm"
            />
          </label>
        </>
      ) : null}

      {role === "client" ? (
        <>
          {isDev ? (
            <label className="block space-y-1">
              <span className="text-sm text-[#485762]">Client slug (dev only)</span>
              <input
                value={clientSlug}
                onChange={(event) => setClientSlug(event.target.value)}
                className="w-full rounded-xl border border-[#c8c8c8] bg-white px-3 py-2 text-sm"
              />
            </label>
          ) : null}
          <p className="text-xs text-[#5a6871]">
            Received an invitation link?{" "}
            <Link href="/access/client/onboarding" className="font-semibold text-[#0f5b73] hover:underline">
              Create credentials in onboarding
            </Link>
            .
          </p>
        </>
      ) : null}

      {role === "employee" ? (
        <>
          <label className="block space-y-1">
            <span className="text-sm text-[#485762]">Direct tokenized link</span>
            <input
              value={directLink}
              onChange={(event) => setDirectLink(event.target.value)}
              placeholder="https://example.com/s/campaign-slug?token=..."
              className="w-full rounded-xl border border-[#c8c8c8] bg-white px-3 py-2 text-sm"
            />
          </label>
          <p className="text-xs text-[#5a6871]">Or access using campaign slug + token.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm text-[#485762]">Campaign slug</span>
              <input
                value={campaignSlug}
                onChange={(event) => setCampaignSlug(event.target.value)}
                className="w-full rounded-xl border border-[#c8c8c8] bg-white px-3 py-2 text-sm"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-[#485762]">Token (optional)</span>
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="w-full rounded-xl border border-[#c8c8c8] bg-white px-3 py-2 text-sm"
              />
            </label>
          </div>
        </>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-full bg-[#131313] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {isSubmitting ? "Entering..." : "Enter platform"}
      </button>
    </form>
  );
}
