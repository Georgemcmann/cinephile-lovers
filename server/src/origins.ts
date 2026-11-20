import type { Env } from "./config.js";

/**
 * Strict origin allowlist (brief §6): the deployed frontend origin, plus
 * localhost during development only. Vercel preview URLs are deliberately
 * NOT allowed (owner decision #10) — test preview builds on a stable alias
 * that is explicitly added to FRONTEND_URL, or against production.
 *
 * M3 addition: DEV_EXTRA_ORIGINS (development only) lets a real device on
 * the LAN (an iPhone cannot present a localhost origin) call the dev
 * server. Entries are validated strictly and the default is empty, so the
 * default allowlist is exactly what review R5 specifies.
 */
export function allowedOrigins(env: Env): string[] {
  const origins = new Set([env.FRONTEND_URL]);
  if (env.NODE_ENV === "development") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
    for (const raw of env.DEV_EXTRA_ORIGINS.split(",")) {
      const candidate = raw.trim();
      if (!candidate) continue;
      // Fail fast at boot on malformed entries — this is a security list.
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(
          `DEV_EXTRA_ORIGINS entry must be an http(s) origin: "${candidate}"`,
        );
      }
      origins.add(url.origin);
    }
  }
  return [...origins];
}

/**
 * Express middleware: mirrors the allowlist onto REST responses.
 * Disallowed origins simply receive no CORS headers, so browsers block them.
 */
export function originMiddleware(env: Env) {
  const allowed = new Set(allowedOrigins(env));

  return function originMiddleware(
    req: { headers: { origin?: string }; method?: string },
    res: {
      setHeader: (key: string, value: string) => void;
      sendStatus: (code: number) => void;
    },
    next: () => void,
  ): void {
    const origin = req.headers.origin;
    const isAllowed = origin !== undefined && allowed.has(origin);

    // Responses vary by Origin even when the origin is refused.
    res.setHeader("Vary", "Origin");

    if (isAllowed && origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "600");
    }

    if (req.method === "OPTIONS") {
      res.sendStatus(isAllowed ? 204 : 403);
      return;
    }

    next();
  };
}