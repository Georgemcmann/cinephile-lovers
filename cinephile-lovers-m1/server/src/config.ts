import { z } from "zod";

/**
 * Environment configuration, validated once at boot with Zod (approved stack).
 * The server fails fast on bad config rather than starting in a broken state.
 * In production (Render), FRONTEND_URL must be the exact deployed origin.
 */
const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  FRONTEND_URL: z
    .url()
    .transform((url) => url.replace(/\/+$/, ""))
    .default("http://localhost:3000"),

  // Rooms expire after this many hours WITHOUT activity (joins/events
  // extend the clock). Memory-only server; the sweeper enforces it.
  ROOM_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),

  // Room creation rate limit, per IP, fixed window (M3). Sanity brake;
  // meaningful hardening only after M7 re-verifies trust proxy on Render.
  ROOM_CREATE_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(10),
  ROOM_CREATE_RATE_WINDOW_MIN: z.coerce.number().int().min(1).max(1440).default(10),

  // Dev-only escape hatch for real-device testing: extra allowed origins,
  // comma-separated (e.g. the LAN IP of the dev machine). HONORED ONLY WHEN
  // NODE_ENV=development; empty by default, so the default allowlist stays
  // exactly production origin + localhost (review R5).
  DEV_EXTRA_ORIGINS: z.string().default(""),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:");
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}