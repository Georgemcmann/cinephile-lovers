import { describe, expect, it } from "vitest";

import { sha256Hex } from "../ids.js";
import {
  CHAT_HISTORY_LIMIT,
  MembershipStore,
  type Membership,
} from "./membership.js";

const HASH_1 = sha256Hex("token-one");
const HASH_2 = sha256Hex("token-two");
const HASH_3 = sha256Hex("token-three");

function makeStore() {
  let now = 1_000_000;
  const store = new MembershipStore({ now: () => now });
  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function claimBothSeats(
  store: MembershipStore,
  roomId: string,
): { aSocket: string; bSocket: string } {
  const first = store.claim(roomId, HASH_1, "socket-1");
  if (!first.ok || first.slot !== "A") throw new Error("first claim failed");
  const second = store.claim(roomId, HASH_2, "socket-2");
  if (!second.ok || second.slot !== "B") throw new Error("second claim failed");
  return { aSocket: "socket-1", bSocket: "socket-2" };
}

describe("MembershipStore — claims", () => {
  it("claims seats in order: first join takes A (creator), second B (partner)", () => {
    const { store } = makeStore();
    store.ensure("room1");
    const first = store.claim("room1", HASH_1, "socket-1");
    const second = store.claim("room1", HASH_2, "socket-2");
    expect(first).toEqual({ ok: true, slot: "A", role: "creator" });
    expect(second).toEqual({ ok: true, slot: "B", role: "partner" });
  });

  it("rejects a third claim with room_full", () => {
    const { store } = makeStore();
    store.ensure("room1");
    claimBothSeats(store, "room1");
    expect(store.claim("room1", HASH_3, "socket-3")).toEqual({
      ok: false,
      error: "room_full",
    });
  });

  it("the claim is synchronous — check-and-set in one call, no promise", () => {
    const { store } = makeStore();
    store.ensure("room1");
    // Structural guarantee (token-design §5): the method returns a plain
    // result, not a promise, so the join handler cannot await inside it.
    const result = store.claim("room1", HASH_1, "socket-1");
    expect(result).toBeTypeOf("object");
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("refuses to claim for a room with no membership record", () => {
    const { store } = makeStore();
    expect(store.claim("ghost", HASH_1, "socket-1")).toEqual({
      ok: false,
      error: "room_full",
    });
  });
});

describe("MembershipStore — resume (newest wins)", () => {
  it("resumes a claimed seat by token hash and reports role", () => {
    const { store } = makeStore();
    store.ensure("room1");
    claimBothSeats(store, "room1");
    const resumed = store.resume("room1", HASH_1, "socket-1b");
    expect(resumed).toMatchObject({ ok: true, slot: "A", role: "creator" });
  });

  it("evicts the previous live socket (newest wins)", () => {
    const { store } = makeStore();
    store.ensure("room1");
    claimBothSeats(store, "room1");
    const resumed = store.resume("room1", HASH_1, "socket-1b");
    if (!resumed.ok) throw new Error("resume failed");
    expect(resumed.evictedSocketId).toBe("socket-1");
    expect(store.snapshot("room1")?.slots.A).toEqual({
      occupied: true,
      online: true,
    });
  });

  it("resuming from the same socket evicts nobody", () => {
    const { store } = makeStore();
    store.ensure("room1");
    claimBothSeats(store, "room1");
    const resumed = store.resume("room1", HASH_1, "socket-1");
    if (!resumed.ok) throw new Error("resume failed");
    expect(resumed.evictedSocketId).toBeNull();
  });

  it("rejects a wrong or unknown token", () => {
    const { store } = makeStore();
    store.ensure("room1");
    claimBothSeats(store, "room1");
    expect(store.resume("room1", HASH_3, "socket-9").ok).toBe(false);
    expect(store.resume("ghost", HASH_1, "socket-9").ok).toBe(false);
  });

  it("an unbound (offline) seat resumes with no eviction", () => {
    const { store } = makeStore();
    store.ensure("room1");
    claimBothSeats(store, "room1");
    expect(store.unbindLive("room1", "socket-1")).toBe("A");
    const resumed = store.resume("room1", HASH_1, "socket-1b");
    if (!resumed.ok) throw new Error("resume failed");
    expect(resumed.evictedSocketId).toBeNull();
  });
});

describe("MembershipStore — recovery and reset", () => {
  it("recovery re-mints the creator seat and evicts a stale A socket", () => {
    const { store } = makeStore();
    store.ensure("room1");
    claimBothSeats(store, "room1");
    const result = store.recover("room1", HASH_3, "socket-creator-new");
    expect(result).toMatchObject({
      ok: true,
      slot: "A",
      evictedSocketId: "socket-1",
      freedSlot: null,
    });
    expect(store.resume("room1", HASH_1, "socket-1").ok).toBe(false);
    expect(store.resume("room1", HASH_3, "socket-creator-new").ok).toBe(true);
  });

  it("recovery never touches the live partner in B", () => {
    const { store } = makeStore();
    store.ensure("room1");
    claimBothSeats(store, "room1");
    store.recover("room1", HASH_3, "socket-creator-new");
    expect(store.snapshot("room1")?.slots.B).toEqual({
      occupied: true,
      online: true,
    });
  });

  it("recovery from a session stuck in B releases B (partner can re-join)", () => {
    const { store } = makeStore();
    store.ensure("room1");
    const first = store.claim("room1", HASH_1, "socket-x"); // A
    const second = store.claim("room1", HASH_2, "socket-creator"); // B
    if (!first.ok || !second.ok || second.slot !== "B") {
      throw new Error("setup failed");
    }
    const result = store.recover("room1", HASH_3, "socket-creator");
    // The recovering session frees B AND takes A; whoever sat in A (here a
    // stale creator socket) is evicted — only creator-lineage can hold A.
    expect(result).toMatchObject({
      ok: true,
      slot: "A",
      freedSlot: "B",
      evictedSocketId: "socket-x",
    });
    expect(store.snapshot("room1")?.slots.B).toEqual({
      occupied: false,
      online: false,
    });
    // The old B token is dead.
    expect(store.resume("room1", HASH_2, "socket-creator").ok).toBe(false);
  });

  it("reset frees the partner seat, wipes its file meta, reports the live socket", () => {
    const { store } = makeStore();
    store.ensure("room1");
    claimBothSeats(store, "room1");
    store.setFile("room1", "B", {
      name: "movie.mkv",
      sizeBytes: 1,
      durationSeconds: 1,
    });
    const result = store.freePartnerSeat("room1");
    expect(result).toEqual({ freed: true, evictedSocketId: "socket-2" });
    expect(store.snapshot("room1")?.slots.B).toEqual({
      occupied: false,
      online: false,
    });
    expect(store.snapshot("room1")?.files.B).toBeNull();
    expect(store.claim("room1", HASH_3, "socket-3b").ok).toBe(true);
  });

  it("reset on an unclaimed partner seat is a no-op", () => {
    const { store } = makeStore();
    store.ensure("room1");
    expect(store.freePartnerSeat("room1")).toEqual({
      freed: false,
      evictedSocketId: null,
    });
  });
});

describe("MembershipStore — presence, files, chat", () => {
  it("disconnect keeps the claim but flips online off", () => {
    const { store } = makeStore();
    store.ensure("room1");
    claimBothSeats(store, "room1");
    expect(store.unbindLive("room1", "socket-2")).toBe("B");
    expect(store.snapshot("room1")?.slots.B).toEqual({
      occupied: true,
      online: false,
    });
    expect(store.unbindLive("room1", "socket-2")).toBeNull();
  });

  it("files are per-seat and overwritable", () => {
    const { store } = makeStore();
    store.ensure("room1");
    claimBothSeats(store, "room1");
    const meta = { name: "a.mkv", sizeBytes: 10, durationSeconds: 1.5 };
    store.setFile("room1", "A", meta);
    expect(store.snapshot("room1")?.files.A).toEqual(meta);
    store.setFile("room1", "A", { ...meta, name: "b.mkv" });
    expect(store.snapshot("room1")?.files.A?.name).toBe("b.mkv");
  });

  it("chat is capped at the history limit with a monotonic id", () => {
    const { store } = makeStore();
    store.ensure("room1");
    claimBothSeats(store, "room1");
    for (let i = 0; i < CHAT_HISTORY_LIMIT + 10; i += 1) {
      store.addChat("room1", "A", `msg-${i}`);
    }
    const snapshot: Membership = store.get("room1")!;
    expect(snapshot.chat.length).toBe(CHAT_HISTORY_LIMIT);
    expect(snapshot.chat[0]?.text).toBe(`msg-${10}`);
    expect(snapshot.chat.at(-1)?.id).toBe(CHAT_HISTORY_LIMIT + 10);
  });

  it("drop removes the membership record entirely", () => {
    const { store } = makeStore();
    store.ensure("room1");
    claimBothSeats(store, "room1");
    store.drop(["room1"]);
    expect(store.get("room1")).toBeUndefined();
    expect(store.snapshot("room1")).toBeNull();
  });

  it("touch extends the activity clock", () => {
    const { store, advance } = makeStore();
    store.ensure("room1");
    advance(5_000);
    store.touch("room1");
    const membership = store.get("room1");
    expect(membership?.lastActivityAt).toBe(1_005_000);
  });
});
describe("MembershipStore — playback anchor (M5)", () => {
  it("the first command creates the anchor; seq starts at 1", () => {
    const { store, advance } = makeStore();
    store.ensure("room1");
    advance(10_000);
    const result = store.applyCommand("room1", "A", {
      kind: "play",
      position: 12.5,
      rev: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.anchor).toEqual({
      state: "playing",
      position: 12.5,
      at: 1_010_000,
      seq: 1,
      by: "A",
    });
  });

  it("pause stores the position it was given; seek preserves the state", () => {
    const { store } = makeStore();
    store.ensure("room1");
    store.applyCommand("room1", "A", { kind: "play", position: 10, rev: 1 });
    const paused = store.applyCommand("room1", "B", {
      kind: "pause",
      position: 42.5,
      rev: 1,
    });
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    expect(paused.anchor.state).toBe("paused");
    expect(paused.anchor.position).toBe(42.5);
    expect(paused.anchor.by).toBe("B");
    const seeked = store.applyCommand("room1", "A", {
      kind: "seek",
      position: 77,
      rev: 2,
    });
    expect(seeked.ok).toBe(true);
    if (!seeked.ok) return;
    expect(seeked.anchor.state).toBe("paused"); // seek never flips play state
    expect(seeked.anchor.position).toBe(77);
  });

  it("the first command may be a seek — it anchors as paused at the target", () => {
    const { store } = makeStore();
    store.ensure("room1");
    const result = store.applyCommand("room1", "B", {
      kind: "seek",
      position: 300,
      rev: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.anchor.state).toBe("paused");
    expect(result.anchor.position).toBe(300);
  });

  it("a playing anchor advances with the clock; a paused one is frozen", () => {
    const { store, advance } = makeStore();
    store.ensure("room1");
    store.applyCommand("room1", "A", { kind: "play", position: 100, rev: 1 });
    advance(4_000);
    expect(store.expectedPositionAt("room1", 1_004_000)).toBe(104);
    advance(1_000);
    store.applyCommand("room1", "B", { kind: "pause", position: 105, rev: 1 });
    advance(60_000);
    expect(store.expectedPositionAt("room1", 1_065_000)).toBe(105);
  });

  it("stale revisions are rejected and leave the anchor untouched", () => {
    const { store } = makeStore();
    store.ensure("room1");
    store.applyCommand("room1", "A", { kind: "play", position: 10, rev: 500 });
    const stale = store.applyCommand("room1", "A", {
      kind: "pause",
      position: 99,
      rev: 500, // equal — not newer
    });
    expect(stale).toEqual({ ok: false, error: "stale_command" });
    const older = store.applyCommand("room1", "A", {
      kind: "pause",
      position: 99,
      rev: 499,
    });
    expect(older).toEqual({ ok: false, error: "stale_command" });
    const anchor = store.get("room1")?.playback;
    expect(anchor?.position).toBe(10);
    expect(anchor?.state).toBe("playing");
    expect(anchor?.seq).toBe(1);
  });

  it("revisions are independent per slot", () => {
    const { store } = makeStore();
    store.ensure("room1");
    store.applyCommand("room1", "A", { kind: "play", position: 1, rev: 900 });
    // B's first command may carry any revision — slots do not share counters.
    const result = store.applyCommand("room1", "B", {
      kind: "pause",
      position: 2,
      rev: 1,
    });
    expect(result.ok).toBe(true);
  });

  it("the system pause projects a playing anchor to NOW and outranks revisions", () => {
    const { store, advance } = makeStore();
    store.ensure("room1");
    store.applyCommand("room1", "A", { kind: "play", position: 0, rev: 1 });
    advance(7_500);
    const paused = store.applySystemPause("room1");
    expect(paused).not.toBeNull();
    expect(paused?.state).toBe("paused");
    expect(paused?.position).toBe(7.5);
    expect(paused?.by).toBe("system");
    expect(paused?.seq).toBe(2);
    // A system pause on an already-paused room is a no-op.
    expect(store.applySystemPause("room1")).toBeNull();
  });

  it("system pause is a no-op when nothing has ever played", () => {
    const { store } = makeStore();
    store.ensure("room1");
    // A seat disconnecting from an idle room must not invent a paused
    // anchor at 0:00 (that would show a false "partner lost" pause).
    expect(store.applySystemPause("room1")).toBeNull();
    expect(store.snapshot("room1")?.playback).toBeNull();
  });

  it("snapshot carries the anchor (null before the first command)", () => {
    const { store } = makeStore();
    store.ensure("room1");
    expect(store.snapshot("room1")?.playback).toBeNull();
    store.applyCommand("room1", "A", { kind: "play", position: 5, rev: 1 });
    const playback = store.snapshot("room1")?.playback;
    expect(playback?.state).toBe("playing");
    expect(playback?.position).toBe(5);
    expect(playback?.by).toBe("A");
  });

  it("commands for a dropped room are refused; clampPosition bounds input", () => {
    const { store } = makeStore();
    expect(
      store.applyCommand("ghost", "A", { kind: "play", position: 1, rev: 1 }),
    ).toEqual({ ok: false, error: "room_gone" });
    store.ensure("room1");
    const huge = store.applyCommand("room1", "A", {
      kind: "seek",
      position: 999_999,
      rev: 1,
    });
    expect(huge.ok).toBe(true);
    if (!huge.ok) return;
    expect(huge.anchor.position).toBe(172_800);
  });

  it("the playback mutators are synchronous — no promise, no await", () => {
    const { store } = makeStore();
    store.ensure("room1");
    const applied = store.applyCommand("room1", "A", {
      kind: "play",
      position: 0,
      rev: 1,
    });
    const paused = store.applySystemPause("room1");
    expect(applied).not.toBeInstanceOf(Promise);
    expect(paused).not.toBeInstanceOf(Promise);
  });
});