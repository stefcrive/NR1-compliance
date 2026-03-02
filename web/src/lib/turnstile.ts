import { getServerEnv } from "@/lib/env";

type TurnstileApiResponse = {
  success: boolean;
  "error-codes"?: string[];
  hostname?: string;
  action?: string;
};

export type TurnstileVerificationResult = {
  success: boolean;
  bypassed: boolean;
  errorCodes: string[];
};

export async function verifyTurnstileToken(params: {
  token: string;
  expectedHostname: string;
  remoteIp?: string;
  expectedAction?: string;
}): Promise<TurnstileVerificationResult> {
  const env = getServerEnv();

  if (env.turnstileBypass) {
    return {
      success: true,
      bypassed: true,
      errorCodes: [],
    };
  }

  if (!params.token || params.token.trim().length === 0) {
    return {
      success: false,
      bypassed: false,
      errorCodes: ["missing-token"],
    };
  }

  const body = new URLSearchParams();
  body.set("secret", env.turnstileSecretKey);
  body.set("response", params.token);
  if (params.remoteIp) {
    body.set("remoteip", params.remoteIp);
  }

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    return {
      success: false,
      bypassed: false,
      errorCodes: ["verification-request-failed"],
    };
  }

  const data = (await response.json()) as TurnstileApiResponse;
  const hostnameValid =
    typeof data.hostname === "string" &&
    data.hostname.toLowerCase() === params.expectedHostname.toLowerCase();
  const actionValid =
    !params.expectedAction || data.action === params.expectedAction;

  const success = Boolean(data.success && hostnameValid && actionValid);

  return {
    success,
    bypassed: false,
    errorCodes: data["error-codes"] ?? [],
  };
}
