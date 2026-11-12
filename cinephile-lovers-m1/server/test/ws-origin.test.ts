import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { connect } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PORT = 4199;
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

function handshake(origin?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: PORT });
    let settled = false;

    const finish = (status: number) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(status);
    };

    socket.setTimeout(3_000, () => finish(-1));
    socket.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    socket.on("connect", () => {
      const lines = [
        "GET /socket.io/?EIO=4&transport=websocket HTTP/1.1",
        `Host: 127.0.0.1:${PORT}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
        "Sec-WebSocket-Version: 13",
        ...(origin ? [`Origin: ${origin}`] : []),
        "",
        "",
      ];
      socket.write(lines.join("\r\n"));
    });

    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString("latin1");
      const match = data.match(/^HTTP\/1\.1 (\d{3})/);
      if (match?.[1]) finish(Number(match[1]));
    });
  });
}

describe("WebSocket origin allowlist", () => {
  beforeAll(async () => {
    server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: "development",
      },
      stdio: "ignore",
    });
    await waitForHealth();
  });

  afterAll(() => {
    server?.kill("SIGTERM");
  });

  it("allows an allowed origin to upgrade", async () => {
    expect(await handshake("http://localhost:3000")).toBe(101);
  });

  it("rejects a disallowed origin during the upgrade", async () => {
    expect(await handshake("https://evil.example")).toBe(400);
  });

  it("rejects a missing Origin header during the upgrade", async () => {
    expect(await handshake()).toBe(400);
  });
});
