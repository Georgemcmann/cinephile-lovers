import { describe, expect, it } from "vitest";

import { RoomStore } from "./store.js";

function makeStore(overrides?: { ttlMs?: number; now?: () => number }) {
  let now = 1_000_000;
  const store = new RoomStore({
    ttlMs: overrides?.ttlMs ?? 1_000,
    now: overrides?.now ?? (() => now),
  });
  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("RoomStore", () => {
  it("creation returns the plaintext secret and recovery code exactly once", () => {
    const { store } = makeStore();
    const room = store.create();
    expect(room.inviteSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(room.recoveryCode).toMatch(
      /^[\da-f]{8}-[\da-f]{8}-[\da-f]{8}-[\da-f]{8}$/,
    );
    // The stored record must NOT contain any plaintext capability.
    const stored = JSON.stringify(store.get(room.roomId));
    expect(stored).not.toContain(room.inviteSecret);
    expect(stored).not.toContain(room.recoveryCode);
  });

  it("verifies the invite secret and rejects wrong values", () => {
    const { store } = makeStore();
    const room = store.create();
    expect(store.verifySecret(room.roomId, room.inviteSecret)).toBe(true);
    expect(store.verifySecret(room.roomId, `${room.inviteSecret}x`)).toBe(false);
    expect(store.verifySecret("unknown-room", room.inviteSecret)).toBe(false);
  });

  it("verifies the recovery code with human-style input", () => {
    const { store } = makeStore();
    const room = store.create();
    const flat = room.recoveryCode.replace(/-/g, "");
    expect(store.verifyRecovery(room.roomId, flat.toUpperCase())).toBe(true);
    expect(store.verifyRecovery(room.roomId, room.recoveryCode)).toBe(true);
    expect(store.verifyRecovery(room.roomId, "00000000-00000000-00000000-00000000")).toBe(false);
  });

  it("sweeps rooms idle beyond the TTL and reports their ids", () => {
    const { store, advance } = makeStore({ ttlMs: 1_000 });
    const a = store.create();
    const b = store.create();
    advance(800);
    store.touch(b.roomId); // b stays alive by activity
    advance(800); // a is now 1600ms idle, b only 800ms
    expect(store.sweep()).toEqual([a.roomId]);
    expect(store.get(a.roomId)).toBeUndefined();
    expect(store.verifySecret(a.roomId, a.inviteSecret)).toBe(false);
    expect(store.get(b.roomId)).toBeDefined();
  });

  it("never hands out the same roomId twice in a row of creations", () => {
    const { store } = makeStore();
    const ids = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      ids.add(store.create().roomId);
    }
    expect(ids.size).toBe(100);
  });
});