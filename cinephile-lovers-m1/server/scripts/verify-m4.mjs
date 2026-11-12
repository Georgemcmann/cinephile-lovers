/**
 * M4 socket integration verification (docs/milestone-4.md).
 *
 * Boots nothing itself: point it at a RUNNING server (default
 * http://localhost:4000) and it walks the full two-party membership
 * lifecycle with real socket.io clients:
 *
 *   create → join A → join B → third refused → bad secrets → resume with
 *   takeover (session:replaced) → creator reset (session:terminated) →
 *   re-join of the freed seat → garbage handshake refused → recovery
 *   reclaims A and kills the old creator token → chat + history →
 *   file announce/same-file state → join rate limit → payload guards.
 *
 * Exit code 0 = every scenario passed.
 */
import { io } from "socket.io-client";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:4000";
const ACK_MS = 5_000;

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect(options = {}) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, {
      transports: ["websocket"],
      reconnection: false,
      // The server enforces the Origin allowlist on the WebSocket upgrade
      // itself; Node clients do not send a browser Origin automatically.
      extraHeaders: { Origin: "http://localhost:3000" },
      ...options,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (err) => {
      reject(Object.assign(new Error(err.message), { code: err.message }));
    });
  });
}

async function ack(socket, event, payload) {
  // socket.io-client: emitWithAck resolves with the ack payload directly
  // and REJECTS on timeout (it is not a [err, response] tuple).
  try {
    return await socket.timeout(ACK_MS).emitWithAck(event, payload);
  } catch {
    return { ok: false, error: "timeout" };
  }
}

function waitFor(socket, event, ms = ACK_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${event}`)),
      ms,
    );
    socket.once(event, (data) => {
      clearTimeout(timer);
      // Events like session:replaced carry NO payload, so wrap the receipt
      // in an object — the caller must be able to tell "arrived" from data.
      resolve({ received: true, data });
    });
  });
}

const ROOM_ID_SHAPE = /^[A-Za-z0-9_-]{10,64}$/;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

async function main() {
  console.log(`M4 socket verification against ${SERVER_URL}\n`);

  // --- a) REST create
  const created = await fetch(`${SERVER_URL}/api/rooms`, { method: "POST" });
  check("a. POST /api/rooms → 201", created.status === 201);
  const room = await created.json();
  check("a. roomId/secret shapes", ROOM_ID_SHAPE.test(room.roomId) && room.inviteSecret.length === 43);
  const { roomId, inviteSecret, recoveryCode } = room;

  // --- b) creator joins via secret
  const c1 = await connect();
  const join1 = await ack(c1, "room:join", { roomId, inviteSecret });
  check("b. creator join ok", join1.ok === true);
  check("b. slot A, role creator, 256-bit token", join1.ok && join1.slot === "A" && join1.role === "creator" && TOKEN_SHAPE.test(join1.token));
  check("b. snapshot: A online, B open", join1.ok && join1.snapshot.slots.A.occupied && join1.snapshot.slots.A.online && !join1.snapshot.slots.B.occupied);

  // --- c) partner joins via the SAME secret
  const c2 = await connect();
  const join2 = await ack(c2, "room:join", { roomId, inviteSecret });
  check("c. partner join ok", join2.ok === true && join2.slot === "B" && join2.role === "partner");

  // --- d) third socket refused — secret is dead once both seats are claimed
  const c3 = await connect();
  const join3 = await ack(c3, "room:join", { roomId, inviteSecret });
  check("d. third join → room_full", join3.ok === false && join3.error === "room_full");
  c3.disconnect();

  // --- f) bad secret and unknown room return the SAME error code
  const probe = await connect();
  const badSecret = await ack(probe, "room:join", { roomId, inviteSecret: "A".repeat(43) });
  const unknownRoom = await ack(probe, "room:join", { roomId: "AAAAAAAAAAAAAAAAAAAAAA", inviteSecret });
  check("f. bad secret → invalid_invite", badSecret.error === "invalid_invite");
  check("f. unknown room → invalid_invite (identical shape)", unknownRoom.error === "invalid_invite");
  probe.disconnect();

  // --- e) resume: newest socket wins, old socket gets session:replaced
  const replacedPromise = waitFor(c2, "session:replaced");
  const c2b = await connect({ auth: { roomId, sessionToken: join2.token } });
  const replaced = await replacedPromise;
  check("e. old socket received session:replaced", replaced.received);
  await sleep(60); // eviction delay (25 ms) + close
  check("e. old socket disconnected by server", c2.connected === false);
  const hello2b = await ack(c2b, "room:hello", { roomId });
  check("e. resume acks slot B + full snapshot", hello2b.ok && hello2b.you.slot === "B" && hello2b.snapshot.chat.length === 0);

  // --- g) creator resets the partner seat → session:terminated { reset }
  const terminatedPromise = waitFor(c2b, "session:terminated");
  const reset1 = await ack(c1, "room:reset-slot", { roomId });
  const terminated = await terminatedPromise;
  check("g. reset acks freed", reset1.ok && reset1.freed === true);
  check("g. partner got session:terminated reason=reset", terminated?.data?.reason === "reset");
  await sleep(60);
  check("g. partner socket closed", c2b.connected === false);
  const c2c = await connect();
  const rejoin = await ack(c2c, "room:join", { roomId, inviteSecret });
  check("g. freed seat re-claimable via link", rejoin.ok && rejoin.slot === "B");
  const c2cHello = await ack(c2c, "room:hello", { roomId });
  check("g. hello: B online again", c2cHello.ok && c2cHello.snapshot.slots.B.online);

  // --- m) garbage handshake token is refused
  let refused = false;
  try {
    await connect({ auth: { roomId, sessionToken: "G".repeat(43) } });
  } catch (err) {
    refused = err.code === "bad_session";
  }
  check("m. garbage session token → connect_error bad_session", refused);

  // --- h) recovery reclaims the creator seat, old creator token dies
  const c1Replaced = waitFor(c1, "session:replaced");
  const c4 = await connect();
  const recover = await ack(c4, "room:recover", { roomId, recoveryCode });
  check("h. recovery ok, claims A/creator", recover.ok && recover.slot === "A" && recover.role === "creator");
  check("h. stale creator tab evicted with session:replaced", (await c1Replaced).received);
  await sleep(60);
  check("h. stale creator socket closed", c1.connected === false);
  let deadToken = false;
  try {
    await connect({ auth: { roomId, sessionToken: join1.token } });
  } catch (err) {
    deadToken = err.code === "bad_session";
  }
  check("h. old creator token is dead after recovery", deadToken);

  // --- i) chat both directions + history for a rejoining device
  await ack(c4, "chat:send", { text: "hello from the creator seat" });
  const chatForPartner = waitFor(c2c, "chat:message");
  await ack(c4, "chat:send", { text: "second message" });
  const seen = await chatForPartner;
  check("i. partner receives chat:message with server metadata", seen?.data?.from === "A" && typeof seen.data.id === "number" && typeof seen.data.at === "string");
  await ack(c2c, "chat:send", { text: "reply from the partner seat" });
  await sleep(100);
  const c4Hello = await ack(c4, "room:hello", { roomId });
  check("i. hello carries chat history in order", c4Hello.ok && c4Hello.snapshot.chat.map((m) => m.text).join("|") === "hello from the creator seat|second message|reply from the partner seat");

  // --- j) file announce → file:state broadcast to BOTH seats
  const partnerFileState = waitFor(c2c, "file:state");
  const announce = await ack(c4, "file:announce", { name: "movie.mkv", sizeBytes: 2_400_000_000, durationSeconds: 8_883.5 });
  const partnerFiles = await partnerFileState;
  check("j. announce acked", announce.ok === true);
  check("j. partner got file:state with A's meta", partnerFiles?.data?.files.A?.name === "movie.mkv" && partnerFiles?.data?.files.B === null);
  await ack(c2c, "file:announce", { name: "other-name.mkv", sizeBytes: 2_400_000_000, durationSeconds: 8_884.1 });
  const c4Files = (await ack(c4, "room:hello", { roomId })).snapshot.files;
  check("j. both seats' metadata stored (same-file check input)", c4Files.A.sizeBytes === 2_400_000_000 && c4Files.B.sizeBytes === 2_400_000_000);

  // --- l) payload guards
  const longText = await ack(c4, "chat:send", { text: "x".repeat(501) });
  const emptyText = await ack(c4, "chat:send", { text: "   " });
  check("l. 501-char chat rejected", longText.error === "invalid_payload");
  check("l. whitespace-only chat rejected", emptyText.error === "invalid_payload");

  // --- k) join rate limit per socket (10/min) — spam a full room
  const spam = await connect();
  let sawRateLimited = false;
  for (let i = 0; i < 11; i += 1) {
    const response = await ack(spam, "room:join", { roomId, inviteSecret });
    if (!response.ok && response.error === "rate_limited") {
      sawRateLimited = true;
      break;
    }
  }
  check("k. 11th join from one socket → rate_limited", sawRateLimited);
  spam.disconnect();

  for (const socket of [c1, c2, c2b, c2c, c4]) socket.disconnect();
  console.log(failures === 0 ? "\nALL M4 SOCKET SCENARIOS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verification crashed:", err.message);
  process.exit(1);
});