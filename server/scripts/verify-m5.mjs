/**
 * M5 playback-sync protocol verification.
 *
 * Runs against a RUNNING server (default http://localhost:4000) and drives
 * two real socket.io clients through the shared-anchor lifecycle:
 *
 *   clock ping -> play/pause/seek broadcast (echo included) -> stale revision
 *   guard -> scrub/status partner-only indicators -> payload guards ->
 *   hello snapshot resync -> system pause on partner loss (and its absence
 *   in an idle room) -> WebSocket Origin enforcement.
 *
 * Exit code 0 = every scenario passed.
 */
import { io } from "socket.io-client";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:4000";
const ORIGIN = "http://localhost:3000";
const ACK_MS = 5_000;

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect(options = {}) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { Origin: ORIGIN },
      ...options,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (err) => {
      reject(Object.assign(new Error(err.message), { code: err.message }));
    });
  });
}

async function ack(socket, event, payload) {
  try {
    return await socket.timeout(ACK_MS).emitWithAck(event, payload);
  } catch {
    return { ok: false, error: "timeout" };
  }
}

function waitForCommand(socket, predicate, ms = ACK_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("sync:command", onCommand);
      reject(new Error("timed out waiting for sync:command"));
    }, ms);
    function onCommand(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off("sync:command", onCommand);
      resolve(payload);
    }
    socket.on("sync:command", onCommand);
  });
}

function waitForEvent(socket, event, predicate = () => true, ms = ACK_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timed out waiting for ${event}`));
    }, ms);
    function onEvent(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    }
    socket.on(event, onEvent);
  });
}

function collect(socket, event, ms) {
  return new Promise((resolve) => {
    const items = [];
    function onEvent(payload) {
      items.push(payload);
    }
    socket.on(event, onEvent);
    setTimeout(() => {
      socket.off(event, onEvent);
      resolve(items);
    }, ms);
  });
}

async function createRoom() {
  const response = await fetch(`${SERVER_URL}/api/rooms`, { method: "POST" });
  if (response.status !== 201) throw new Error(`create room -> ${response.status}`);
  return response.json();
}

async function joinRoom(socket, roomId, inviteSecret) {
  const joined = await ack(socket, "room:join", { roomId, inviteSecret });
  if (!joined.ok) throw new Error(`join failed: ${joined.error}`);
  return joined;
}

async function main() {
  console.log(`M5 sync verification against ${SERVER_URL}\n`);

  const { roomId, inviteSecret } = await createRoom();
  const a = await connect();
  const b = await connect();
  const joinA = await joinRoom(a, roomId, inviteSecret);
  const joinB = await joinRoom(b, roomId, inviteSecret);

  // --- clock ping
  const tClient = Date.now();
  const ping = await ack(a, "sync:ping", { tClient });
  check("a. sync:ping acks a server timestamp", ping.ok === true && Number.isFinite(ping.tServer));
  check("a. ping server time is plausible", ping.ok && Math.abs(ping.tServer - Date.now()) < 5_000);

  // --- play: broadcast to BOTH seats (echo is the sender's suppression key)
  const revA1 = Date.now();
  const aEcho = waitForCommand(a, (payload) => payload.rev === revA1);
  const bPlay = waitForCommand(b, (payload) => payload.rev === revA1);
  const playAck = await ack(a, "sync:command", { kind: "play", position: 12.5, rev: revA1 });
  const [echo, played] = await Promise.all([aEcho, bPlay]);
  check("b. play ack carries seq/at", playAck.ok === true && playAck.seq === 1 && Number.isFinite(playAck.at));
  check("b. sender receives its own broadcast (echo)", echo.by === "A" && echo.kind === "play");
  check("b. partner receives playing anchor at position", played.state === "playing" && played.position === 12.5 && played.seq === 1);

  // --- pause from B
  const revB1 = Date.now();
  const bPauseEcho = waitForCommand(b, (payload) => payload.rev === revB1);
  const aPause = waitForCommand(a, (payload) => payload.rev === revB1);
  const pauseAck = await ack(b, "sync:command", { kind: "pause", position: 25, rev: revB1 });
  const [pauseEcho, paused] = await Promise.all([bPauseEcho, aPause]);
  check("c. pause ack accepted", pauseAck.ok === true && pauseAck.seq === 2);
  check("c. pause echoed to sender", pauseEcho.state === "paused" && pauseEcho.by === "B");
  check("c. partner sees paused anchor at 25", paused.state === "paused" && paused.position === 25);

  // --- seek while paused stays paused
  const revB2 = Date.now() + 1;
  const aSeek = waitForCommand(a, (payload) => payload.rev === revB2);
  const seekAck = await ack(b, "sync:command", { kind: "seek", position: 100, rev: revB2 });
  const seeked = await aSeek;
  check("d. seek ack accepted", seekAck.ok === true && seekAck.seq === 3);
  check("d. seek preserves paused state", seeked.state === "paused" && seeked.position === 100);

  // --- stale revision rejected, no broadcast
  const noiseWhileStale = collect(a, "sync:command", 350);
  const stale = await ack(a, "sync:command", { kind: "pause", position: 1, rev: revA1 });
  const staleNoise = await noiseWhileStale;
  check("e. older/equal revision -> stale_command", stale.ok === false && stale.error === "stale_command");
  check("e. stale command broadcasts nothing", staleNoise.length === 0);

  // --- invalid payloads are refused and never broadcast
  const noiseWhileInvalid = collect(a, "sync:command", 350);
  const badPosition = await ack(a, "sync:command", { kind: "play", position: -1, rev: Date.now() });
  const badRev = await ack(a, "sync:command", { kind: "play", position: 1, rev: 0 });
  const badKind = await ack(a, "sync:command", { kind: "stop", position: 1, rev: Date.now() });
  const badCeiling = await ack(a, "sync:command", { kind: "seek", position: 200_000, rev: Date.now() });
  const invalidNoise = await noiseWhileInvalid;
  check(
    "f. invalid command payloads rejected",
    badPosition.error === "invalid_payload" &&
      badRev.error === "invalid_payload" &&
      badKind.error === "invalid_payload" &&
      badCeiling.error === "invalid_payload",
  );
  check("f. invalid commands broadcast nothing", invalidNoise.length === 0);

  // --- scrub/status go to the PARTNER only
  const bScrub = waitForEvent(b, "sync:scrub");
  const senderScrubNoise = collect(a, "sync:scrub", 350);
  await ack(a, "sync:scrub", { position: 42.5 });
  const scrub = await bScrub;
  check("g. scrub relayed to partner with slot", scrub.position === 42.5 && scrub.by === "A");
  check("g. scrub is not echoed to sender", (await senderScrubNoise).length === 0);

  const aStatus = waitForEvent(a, "sync:status");
  await ack(b, "sync:status", { buffering: true });
  const status = await aStatus;
  check("h. buffering status relayed to partner", status.buffering === true && status.by === "B");
  const badStatus = await ack(b, "sync:status", { buffering: "yes" });
  check("h. invalid status payload rejected", badStatus.error === "invalid_payload");

  // --- snapshot resync: hello carries the latest anchor
  const helloB = await ack(b, "room:hello", { roomId });
  check(
    "i. hello snapshot carries the anchor",
    helloB.ok &&
      helloB.snapshot.playback.state === "paused" &&
      helloB.snapshot.playback.position === 100 &&
      helloB.snapshot.playback.seq === 3,
  );

  // --- unauthenticated socket cannot use sync events
  const stray = await connect();
  const strayCommand = await ack(stray, "sync:command", { kind: "play", position: 1, rev: 1 });
  const strayPing = await ack(stray, "sync:ping", { tClient: Date.now() });
  check(
    "j. sync events require a seat",
    strayCommand.error === "unauthorized" && strayPing.error === "unauthorized",
  );
  stray.disconnect();

  // --- system pause when a seat drops mid-playback
  const revPlay2 = Date.now();
  const bPlaying = waitForCommand(b, (payload) => payload.rev === revPlay2);
  await ack(b, "sync:command", { kind: "play", position: 10, rev: revPlay2 });
  await bPlaying;

  a.disconnect();
  const premature = await collect(b, "sync:command", 2_000);
  check("k. shared pause waits for the grace window", premature.length === 0);
  let systemPause;
  try {
    systemPause = await waitForCommand(b, (payload) => payload.by === "system", 5_000);
  } catch {
    systemPause = null;
  }
  check(
    "k. dropped seat pauses shared playback",
    systemPause !== null &&
      systemPause.kind === "pause" &&
      systemPause.state === "paused" &&
      systemPause.rev === 0 &&
      systemPause.position >= 10,
  );
  const afterPause = await ack(b, "room:hello", { roomId });
  check(
    "k. system pause is persisted in the snapshot",
    afterPause.ok && afterPause.snapshot.playback.by === "system",
  );
  b.disconnect();

  // --- an idle-room disconnect must NOT invent a paused anchor
  const idle = await createRoom();
  const i1 = await connect();
  const i2 = await connect();
  await joinRoom(i1, idle.roomId, idle.inviteSecret);
  await joinRoom(i2, idle.roomId, idle.inviteSecret);
  i1.disconnect();
  const idleNoise = await collect(i2, "sync:command", 5_000);
  const idleHello = await ack(i2, "room:hello", { roomId: idle.roomId });
  check("l. idle disconnect emits no system pause", idleNoise.length === 0);
  check("l. idle room has no anchor", idleHello.ok && idleHello.snapshot.playback === null);
  i2.disconnect();

  // --- Origin allowlist is enforced on the WS upgrade
  let badOriginRefused = false;
  try {
    const bad = await connect({ extraHeaders: { Origin: "https://evil.example" } });
    bad.disconnect();
  } catch {
    badOriginRefused = true;
  }
  check("m. disallowed Origin cannot open a WebSocket", badOriginRefused);

  let missingOriginRefused = false;
  try {
    const bare = await connect({ extraHeaders: {} });
    bare.disconnect();
  } catch {
    missingOriginRefused = true;
  }
  check("m. missing Origin cannot open a WebSocket", missingOriginRefused);

  console.log(`\n${failures === 0 ? "ALL M5 SYNC SCENARIOS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
