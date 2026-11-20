import { spawn, type ChildProcess } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PORT = 4198;
const ORIGIN = "http://localhost:3000";
let server: ChildProcess | undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await sleep(100);
  }
  throw new Error("server did not become healthy");
}

function createRoom(): Promise<Response> {
  return fetch(`http://127.0.0.1:${PORT}/api/rooms`, {
    method: "POST",
    headers: { Origin: ORIGIN },
  });
}

describe("POST /api/rooms", () => {
  beforeAll(async () => {
    server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: "development",
        ROOM_TTL_HOURS: "1",
        ROOM_CREATE_RATE_LIMIT: "2",
        ROOM_CREATE_RATE_WINDOW_MIN: "10",
      },
      stdio: "ignore",
    });
    await waitForHealth();
  });

  afterAll(async () => {
    if (!server) return;
    const exited = new Promise<void>((resolve) => server?.once("exit", resolve));
    server.kill("SIGTERM");
    await exited;
  });

  it("creates a room and returns each secret exactly once", async () => {
    const first = await createRoom();
    expect(first.status).toBe(201);
    expect(first.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(first.headers.get("vary")).toBe("Origin");
    expect(first.headers.get("cache-control")).toBe("no-store");

    const room = (await first.json()) as Record<string, unknown>;
    expect(String(room.roomId)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(room.invitePath).toBe(`/room/${String(room.roomId)}`);
    expect(String(room.inviteSecret)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(String(room.recoveryCode)).toMatch(
      /^[\da-f]{8}-[\da-f]{8}-[\da-f]{8}-[\da-f]{8}$/,
    );

    const expiresAt = Date.parse(String(room.expiresAt));
    expect(Number.isFinite(expiresAt)).toBe(true);
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 60 * 60_000 + 5_000);

    expect("secretHash" in room).toBe(false);
    expect("recoveryHash" in room).toBe(false);

    const second = await createRoom();
    expect(second.status).toBe(201);
    const secondRoom = (await second.json()) as Record<string, unknown>;
    expect(secondRoom.roomId).not.toBe(room.roomId);

    const refused = await createRoom();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(await refused.json()).toEqual({ error: "rate_limited" });
  });
});
