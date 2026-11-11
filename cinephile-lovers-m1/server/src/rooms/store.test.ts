import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
    assert.match(room.inviteSecret, /^[A-Za-z0-9_-]{43}$/);
    assert.match(room.recoveryCode,
      /^[\da-f]{8}-[\da-f]{8}-[\da-f]{8}-[\da-f]{8}$/,
    );
    // The stored record must NOT contain any plaintext capability.
    const stored = JSON.stringify(store.get(room.roomId));
    assert.doesNotMatch(stored, new RegExp(room.inviteSecret));
    assert.doesNotMatch(stored, new RegExp(room.recoveryCode));
  });

  it("verifies the invite secret and rejects wrong values", () => {
    const { store } = makeStore();
    const room = store.create();
    assert.equal(store.verifySecret(room.roomId, room.inviteSecret), true);
    assert.equal(store.verifySecret(room.roomId, `${room.inviteSecret}x`), false);
    assert.equal(store.verifySecret("unknown-room", room.inviteSecret), false);
  });

  it("verifies the recovery code with human-style input", () => {
    const { store } = makeStore();
    const room = store.create();
    const flat = room.recoveryCode.replace(/-/g, "");
    assert.equal(store.verifyRecovery(room.roomId, flat.toUpperCase()), true);
    assert.equal(store.verifyRecovery(room.roomId, room.recoveryCode), true);
    assert.equal(store.verifyRecovery(room.roomId, "00000000-00000000-00000000-00000000"), false);
  });

  it("sweeps rooms idle beyond the TTL", () => {
    const { store, advance } = makeStore({ ttlMs: 1_000 });
    const a = store.create();
    const b = store.create();
    advance(800);
    store.touch(b.roomId); // b stays alive by activity
    advance(800); // a is now 1600ms idle, b only 800ms
    assert.equal(store.sweep(), 1);
    assert.equal(store.get(a.roomId), undefined);
    assert.equal(store.verifySecret(a.roomId, a.inviteSecret), false);
    assert.notEqual(store.get(b.roomId), undefined);
  });

  it("never hands out the same roomId twice in a row of creations", () => {
    const { store } = makeStore();
    const ids = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      ids.add(store.create().roomId);
    }
    assert.equal(ids.size, 100);
  });
});