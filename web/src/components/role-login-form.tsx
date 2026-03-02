"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Role = "manager" | "client" | "employee";

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function RoleLoginForm({ role }: { role: Role }) {
  const router = useRouter();
  const isDev = process.env.NODE_ENV !== "production";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [clientSlug, setClientSlug] = useState("techcorp-brasil");
  const [directLink, setDirectLink] = useState("");
  const [campaignSlug, setCampaignSlug] = useState("demo-nr1-2026");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  const title = useMemo(() => {
    if (role === "manager") return "Manager Login";
    if (role === "client") return "Client Login";
    return "Employee Access";
  }, [role]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (role === "manager") {
      if (!email.trim() || !password.trim()) {
        setError("Enter email and password.");
        return;
      }
      router.push("/manager/clients");
      return;
    }

    if (role === "client") {
      if (!email.trim() || !password.trim()) {
        setError("Enter email and password.");
        return;
      }
      const slug = normalizeSlug(clientSlug) || "techcorp-brasil";
      router.push(`/client/${slug}/company`);
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

  function handleDevLogin() {
    if (role === "manager") {
      router.push("/manager/clients");
      return;
    }
    if (role === "client") {
      const slug = normalizeSlug(clientSlug) || "techcorp-brasil";
      router.push(`/client/${slug}/company`);
      return;
    }
    router.push("/s/demo-nr1-2026");
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
          onClick={handleDevLogin}
          className="rounded-full border border-[#dfcfb0] bg-[#fbf5e9] px-4 py-2 text-sm font-semibold text-[#744d14]"
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
        <label className="block space-y-1">
          <span className="text-sm text-[#485762]">Client slug</span>
          <input
            value={clientSlug}
            onChange={(event) => setClientSlug(event.target.value)}
            className="w-full rounded-xl border border-[#c8c8c8] bg-white px-3 py-2 text-sm"
          />
        </label>
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
        className="rounded-full bg-[#131313] px-5 py-2 text-sm font-semibold text-white"
      >
        Enter platform
      </button>
    </form>
  );
}
