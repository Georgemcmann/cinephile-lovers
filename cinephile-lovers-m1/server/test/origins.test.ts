// @ts-ignore Node.js type definitions are unavailable in this project.
import assert from "node:assert/strict";
// @ts-ignore Node.js type definitions are unavailable in this project.
import { test } from "node:test";

import { loadEnv, type Env } from "../src/config.js";
import { allowedOrigins, originMiddleware } from "../src/origins.js";
// @ts-ignore Node.js type definitions are unavailable in this project.
import process from "node:process";

const devEnv: Env = {
  PORT: 4000,
  NODE_ENV: "development",
  FRONTEND_URL: "https://app.example",
  ROOM_TTL_HOURS: 0,
  ROOM_CREATE_RATE_LIMIT: 0,
  ROOM_CREATE_RATE_WINDOW_MIN: 0,
  DEV_EXTRA_ORIGINS: ""
};

const prodEnv: Env = {
  PORT: 4000,
  NODE_ENV: "production",
  FRONTEND_URL: "https://app.example",
  ROOM_TTL_HOURS: 0,
  ROOM_CREATE_RATE_LIMIT: 0,
  ROOM_CREATE_RATE_WINDOW_MIN: 0,
  DEV_EXTRA_ORIGINS: ""
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

test("development allows the frontend origin and both localhost spellings", () => {
  assert.deepEqual(allowedOrigins(devEnv), [
    "https://app.example",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
});

test("production allows only the configured frontend origin", () => {
  assert.deepEqual(allowedOrigins(prodEnv), ["https://app.example"]);
});

test("allowed origins receive CORS headers", () => {
  const res = fakeResponse();
  let nextCalled = false;

  originMiddleware(devEnv)(
    { headers: { origin: "http://localhost:3000" }, method: "GET" },
    res,
    () => {
      nextCalled = true;
    },
  );

  assert.equal(nextCalled, true);
  assert.equal(
    res.headers.get("Access-Control-Allow-Origin"),
    "http://localhost:3000",
  );
  assert.equal(res.headers.get("Vary"), "Origin");
});

test("disallowed origins receive no CORS header but still vary by origin", () => {
  const res = fakeResponse();
  let nextCalled = false;

  originMiddleware(devEnv)(
    { headers: { origin: "https://evil.example" }, method: "GET" },
    res,
    () => {
      nextCalled = true;
    },
  );

  assert.equal(nextCalled, true);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), undefined);
  assert.equal(res.headers.get("Vary"), "Origin");
});

test("FRONTEND_URL is normalized without a trailing slash", () => {
  const previous = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = "https://app.example/";

  try {
    assert.equal(loadEnv().FRONTEND_URL, "https://app.example");
  } finally {
    if (previous === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = previous;
    }
  }
});

test("OPTIONS is allowed for an allowed origin and refused otherwise", () => {
  const allowed = fakeResponse();
  originMiddleware(devEnv)(
    { headers: { origin: "http://localhost:3000" }, method: "OPTIONS" },
    allowed,
    () => assert.fail("next must not run for OPTIONS"),
  );
  assert.equal(allowed.status, 204);

  const refused = fakeResponse();
  originMiddleware(devEnv)(
    { headers: { origin: "https://evil.example" }, method: "OPTIONS" },
    refused,
    () => assert.fail("next must not run for OPTIONS"),
  );
  assert.equal(refused.status, 403);
});
