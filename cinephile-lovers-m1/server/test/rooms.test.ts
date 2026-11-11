import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { after, before, test } from "node:test";

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

before(async () => {
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

after(async () => {
  if (!server) return;
  const exited = new Promise<void>((resolve) => server?.once("exit", resolve));
  server.kill("SIGTERM");
  await exited;
});

test("creates a room and returns each secret exactly once", async () => {
  const first = await createRoom();
  assert.equal(first.status, 201);
  assert.equal(first.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(first.headers.get("vary"), "Origin");
  assert.equal(first.headers.get("cache-control"), "no-store");

  const room = (await first.json()) as Record<string, unknown>;
  assert.match(String(room.roomId), /^[A-Za-z0-9_-]{22}$/);
  assert.equal(room.invitePath, `/room/${String(room.roomId)}`);
  assert.match(String(room.inviteSecret), /^[A-Za-z0-9_-]{43}$/);
  assert.match(
    String(room.recoveryCode),
    /^[\da-f]{8}-[\da-f]{8}-[\da-f]{8}-[\da-f]{8}$/,
  );

  const expiresAt = Date.parse(String(room.expiresAt));
  assert.ok(Number.isFinite(expiresAt));
  assert.ok(expiresAt > Date.now());
  assert.ok(expiresAt <= Date.now() + 60 * 60_000 + 5_000);

  assert.equal("secretHash" in room, false);
  assert.equal("recoveryHash" in room, false);

  const second = await createRoom();
  assert.equal(second.status, 201);
  const secondRoom = (await second.json()) as Record<string, unknown>;
  assert.notEqual(secondRoom.roomId, room.roomId);

  const refused = await createRoom();
  assert.equal(refused.status, 429);
  assert.equal(refused.headers.get("cache-control"), "no-store");
  assert.ok(Number(refused.headers.get("retry-after")) >= 1);
  assert.deepEqual(await refused.json(), { error: "rate_limited" });
});
