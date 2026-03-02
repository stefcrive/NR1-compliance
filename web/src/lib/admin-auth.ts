import { getServerEnv } from "@/lib/env";

export function isAdminApiAuthorized(request: Request): boolean {
  const env = getServerEnv();
  if (!env.adminApiKey) {
    return process.env.NODE_ENV !== "production";
  }

  const provided = request.headers.get("x-admin-api-key") ?? "";
  return provided.length > 0 && provided === env.adminApiKey;
}
