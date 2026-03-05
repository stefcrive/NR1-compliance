type RequiredEnvKey =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "FORM_SESSION_SECRET"
  | "IP_HASH_SECRET"
  | "TURNSTILE_SECRET_KEY";

function requireEnv(name: RequiredEnvKey): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolveSupabaseAdminKey(): string {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";

  if (serviceRoleKey && !serviceRoleKey.startsWith("sb_publishable_")) {
    return serviceRoleKey;
  }
  if (secretKey) {
    return secretKey;
  }
  if (serviceRoleKey.startsWith("sb_publishable_")) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY appears to be a publishable key. Set SUPABASE_SECRET_KEY or a real service role key.",
    );
  }
  throw new Error(
    "Missing Supabase admin key: set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY.",
  );
}

export function getServerEnv() {
  const formSessionSecret = requireEnv("FORM_SESSION_SECRET");
  return {
    supabaseUrl: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseServiceRoleKey: resolveSupabaseAdminKey(),
    formSessionSecret,
    authSessionSecret: process.env.AUTH_SESSION_SECRET?.trim() || formSessionSecret,
    ipHashSecret: requireEnv("IP_HASH_SECRET"),
    turnstileSecretKey: requireEnv("TURNSTILE_SECRET_KEY"),
    turnstileBypass:
      process.env.TURNSTILE_BYPASS === "true" &&
      process.env.NODE_ENV !== "production",
    adminApiKey: process.env.ADMIN_API_KEY ?? "",
    managerLoginEmail: process.env.MANAGER_LOGIN_EMAIL?.trim() ?? "",
    managerLoginPassword: process.env.MANAGER_LOGIN_PASSWORD ?? "",
  };
}
