import type { Env } from "./config.js";

/**
 * Strict origin allowlist (brief §6): the deployed frontend origin, plus
 * localhost during development only. Vercel preview URLs are deliberately
 * NOT allowed (owner decision #10) — test preview builds on a stable alias
 * that is explicitly added to FRONTEND_URL, or against production.
 */
export function allowedOrigins(env: Env): string[] {
  const origins = [env.FRONTEND_URL];
  if (env.NODE_ENV === "development") {
    origins.push("http://localhost:3000", "http://127.0.0.1:3000");
  }
  return origins;
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

    if (isAllowed && origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
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
