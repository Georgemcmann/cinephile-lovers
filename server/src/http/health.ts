import { Router } from "express";

/**
 * GET /api/health — liveness probe for Render and for local verification.
 * Returns the minimum: no version info, no config, no internals (brief §6).
 */
export function healthRouter(): Router {
  const router = Router();

  router.get("/api/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
