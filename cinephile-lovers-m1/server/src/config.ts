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
  FRONTEND_URL: z.url().default("http://localhost:3000"),
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
