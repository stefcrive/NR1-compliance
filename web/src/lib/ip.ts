import { createHmac } from "node:crypto";

function pickFirstIp(value: string): string {
  return value.split(",")[0]?.trim() ?? "";
}

export function extractTrustedIp(headers: Headers): string {
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp && cfIp.trim()) {
    return cfIp.trim();
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded && forwarded.trim()) {
    const ip = pickFirstIp(forwarded);
    if (ip) {
      return ip;
    }
  }

  const realIp = headers.get("x-real-ip");
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }

  return "0.0.0.0";
}

export function hashIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex");
}
