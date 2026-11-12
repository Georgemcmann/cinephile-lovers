import process from "node:process";

import { describe, expect, it } from "vitest";

import { loadEnv, type Env } from "../src/config.js";
import { allowedOrigins, originMiddleware } from "../src/origins.js";

const devEnv: Env = {
  PORT: 4000,
  NODE_ENV: "development",
  FRONTEND_URL: "https://app.example",
  ROOM_TTL_HOURS: 0,
  ROOM_CREATE_RATE_LIMIT: 0,
  ROOM_CREATE_RATE_WINDOW_MIN: 0,
  DEV_EXTRA_ORIGINS: "",
};

const prodEnv: Env = {
  PORT: 4000,
  NODE_ENV: "production",
  FRONTEND_URL: "https://app.example",
  ROOM_TTL_HOURS: 0,
  ROOM_CREATE_RATE_LIMIT: 0,
  ROOM_CREATE_RATE_WINDOW_MIN: 0,
  DEV_EXTRA_ORIGINS: "",
};

type FakeResponse = {
  headers: Map<string, string>;
  status: number | null;
  setHeader: (key: string, value: string) => void;
  sendStatus: (status: number) => void;
};

function fakeResponse(): FakeResponse {
  return {
    headers: new Map<string, string>(),
    status: null,
    setHeader(key, value) {
      this.headers.set(key, value);
    },
    sendStatus(status) {
      this.status = status;
    },
  };
}

describe("origins", () => {
  it("development allows the frontend origin and both localhost spellings", () => {
    expect(allowedOrigins(devEnv)).toEqual([
      "https://app.example",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]);
  });

  it("production allows only the configured frontend origin", () => {
    expect(allowedOrigins(prodEnv)).toEqual(["https://app.example"]);
  });

  it("allowed origins receive CORS headers", () => {
    const res = fakeResponse();
    let nextCalled = false;

    originMiddleware(devEnv)(
      { headers: { origin: "http://localhost:3000" }, method: "GET" },
      res,
      () => {
        nextCalled = true;
      },
    );

    expect(nextCalled).toBe(true);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000",
    );
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("disallowed origins receive no CORS header but still vary by origin", () => {
    const res = fakeResponse();
    let nextCalled = false;

    originMiddleware(devEnv)(
      { headers: { origin: "https://evil.example" }, method: "GET" },
      res,
      () => {
        nextCalled = true;
      },
    );

    expect(nextCalled).toBe(true);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeUndefined();
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("FRONTEND_URL is normalized without a trailing slash", () => {
    const previous = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = "https://app.example/";

    try {
      expect(loadEnv().FRONTEND_URL).toBe("https://app.example");
    } finally {
      if (previous === undefined) {
        delete process.env.FRONTEND_URL;
      } else {
        process.env.FRONTEND_URL = previous;
      }
    }
  });

  it("OPTIONS is allowed for an allowed origin and refused otherwise", () => {
    const allowed = fakeResponse();
    originMiddleware(devEnv)(
      { headers: { origin: "http://localhost:3000" }, method: "OPTIONS" },
      allowed,
      () => {
        throw new Error("next must not run for OPTIONS");
      },
    );
    expect(allowed.status).toBe(204);

    const refused = fakeResponse();
    originMiddleware(devEnv)(
      { headers: { origin: "https://evil.example" }, method: "OPTIONS" },
      refused,
      () => {
        throw new Error("next must not run for OPTIONS");
      },
    );
    expect(refused.status).toBe(403);
  });
});
