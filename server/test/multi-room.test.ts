import { spawn, type ChildProcess } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";

const PORT = 4201;
const ORIGIN = "http://localhost:3000";
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const ACK_MS = 5_000;

let server: ChildProcess | undefined;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${SERVER_URL}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await sleep(100);
  }
  throw new Error("server did not become healthy");
}

type CreatedRoom = {
  roomId: string;
  inviteSecret: string;
  recoveryCode: string;
};

async function createRoom(): Promise<CreatedRoom> {
  const response = await fetch(`${SERVER_URL}/api/rooms`, {
    method: "POST",
    headers: { Origin: ORIGIN },
  });
  if (response.status !== 201) {
    throw new Error(`room creation failed with ${response.status}`);
  }
  return (await response.json()) as CreatedRoom;
}

function connect(auth?: Record<string, string>): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { Origin: ORIGIN },
      ...(auth ? { auth } : {}),
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (error) =>
      reject(new Error(`connect_error: ${error.message}`)),
    );
  });
}

type Ack = { ok: true; [key: string]: unknown } | { ok: false; error: string };

async function ack(
  socket: Socket,
  event: string,
  payload: unknown,
): Promise<Ack> {
  try {
    return (await socket.timeout(ACK_MS).emitWithAck(event, payload)) as Ack;
  } catch {
    return { ok: false, error: "timeout" };
  }
}

async function join(
  socket: Socket,
  roomId: string,
  inviteSecret: string,
): Promise<{ token: string; slot: "A" | "B" }> {
  const response = await ack(socket, "room:join", { roomId, inviteSecret });
  if (!response.ok) {
    throw new Error(`join failed: ${response.error}`);
  }
  return response as unknown as { token: string; slot: "A" | "B" };
}

function nextEvent<T = unknown>(
  socket: Socket,
  event: string,
  predicate: (payload: T) => boolean = () => true,
  ms = 2_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timed out waiting for ${event}`));
    }, ms);
    function onEvent(payload: T): void {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    }
    socket.on(event, onEvent);
  });
}

function noEvent(socket: Socket, event: string, ms = 500): Promise<boolean> {
  return new Promise((resolve) => {
    let seen = false;
    const onEvent = () => {
      seen = true;
    };
    socket.on(event, onEvent);
    setTimeout(() => {
      socket.off(event, onEvent);
      resolve(!seen);
    }, ms);
  });
}

type Snapshot = {
  slots: { A: { occupied: boolean; online: boolean }; B: { occupied: boolean; online: boolean } };
  files: { A: { name: string } | null; B: { name: string } | null };
  chat: Array<{ text: string }>;
  playback: { state: string; position: number; seq: number } | null;
};

type HelloAck = {
  ok: true;
  you: { slot: "A" | "B" };
  snapshot: Snapshot;
};

describe("multi-room isolation and reconnect", () => {
  beforeAll(async () => {
    server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: "development",
        ROOM_TTL_HOURS: "1",
        ROOM_CREATE_RATE_LIMIT: "100",
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

  it("keeps two independent rooms isolated for chat, playback and reset", async () => {
    const roomA = await createRoom();
    const roomB = await createRoom();

    const a1 = await connect();
    const a2 = await connect();
    const b1 = await connect();
    const b2 = await connect();

    try {
      const joinA1 = await join(a1, roomA.roomId, roomA.inviteSecret);
      await join(a2, roomA.roomId, roomA.inviteSecret);
      const joinB1 = await join(b1, roomB.roomId, roomB.inviteSecret);
      const joinB2 = await join(b2, roomB.roomId, roomB.inviteSecret);
      expect(joinA1.slot).toBe("A");
      expect(joinB1.slot).toBe("A");
      expect(joinB2.slot).toBe("B");

      const chatForA2 = nextEvent<{ text: string }>(a2, "chat:message");
      const noChatInB1 = noEvent(b1, "chat:message");
      const noChatInB2 = noEvent(b2, "chat:message");
      expect(
        (await ack(a1, "chat:send", { text: "room A only" })).ok,
      ).toBe(true);
      expect((await chatForA2).text).toBe("room A only");
      expect(await noChatInB1).toBe(true);
      expect(await noChatInB2).toBe(true);

      const rev = Date.now();
      const echoForA1 = nextEvent<{ rev: number; seq: number }>(
        a1,
        "sync:command",
        (payload) => payload.rev === rev,
      );
      const syncForA2 = nextEvent<{ rev: number; seq: number }>(
        a2,
        "sync:command",
        (payload) => payload.rev === rev,
      );
      const noSyncInB1 = noEvent(b1, "sync:command");
      const noSyncInB2 = noEvent(b2, "sync:command");
      const command = await ack(a1, "sync:command", {
        kind: "play",
        position: 30,
        rev,
      });
      expect(command.ok).toBe(true);
      expect((await echoForA1).seq).toBe(1);
      expect((await syncForA2).seq).toBe(1);
      expect(await noSyncInB1).toBe(true);
      expect(await noSyncInB2).toBe(true);

      const helloB1 = (await ack(b1, "room:hello", {
        roomId: roomB.roomId,
      })) as unknown as HelloAck;
      expect(helloB1.ok).toBe(true);
      expect(helloB1.snapshot.chat).toEqual([]);
      expect(helloB1.snapshot.playback).toBeNull();

      const helloA1 = (await ack(a1, "room:hello", {
        roomId: roomA.roomId,
      })) as unknown as HelloAck;
      expect(helloA1.snapshot.chat.map((message) => message.text)).toEqual([
        "room A only",
      ]);
      expect(helloA1.snapshot.playback?.seq).toBe(1);

      const announced = nextEvent<{ files: Snapshot["files"] }>(
        a1,
        "file:state",
        (payload) => payload.files.B?.name === "partner-a.mp4",
      );
      await ack(a2, "file:announce", {
        name: "partner-a.mp4",
        sizeBytes: 5_000,
        durationSeconds: 60,
      });
      expect((await announced).files.B?.name).toBe("partner-a.mp4");

      const clearedFiles = nextEvent<{ files: Snapshot["files"] }>(
        a1,
        "file:state",
        (payload) => payload.files.B === null,
      );
      const reset = await ack(a1, "room:reset-slot", {
        roomId: roomA.roomId,
      });
      expect(reset.ok).toBe(true);
      expect((await clearedFiles).files.B).toBeNull();

      const helloB1After = (await ack(b1, "room:hello", {
        roomId: roomB.roomId,
      })) as unknown as HelloAck;
      expect(helloB1After.snapshot.slots.B.online).toBe(true);
      expect(helloB1After.snapshot.playback).toBeNull();

      // Recovery from a token that sat in B releases B AND its file metadata.
      const a3 = await connect();
      try {
        const joinA3 = await join(a3, roomA.roomId, roomA.inviteSecret);
        expect(joinA3.slot).toBe("B");

        const announcedB = nextEvent<{ files: Snapshot["files"] }>(
          a1,
          "file:state",
          (payload) => payload.files.B?.name === "recovered-b.mp4",
        );
        await ack(a3, "file:announce", {
          name: "recovered-b.mp4",
          sizeBytes: 2_000,
          durationSeconds: 90,
        });
        await announcedB;

        const clearedOnRecover = nextEvent<{ files: Snapshot["files"] }>(
          a3,
          "file:state",
          (payload) => payload.files.B === null,
        );
        const recovered = await ack(a3, "room:recover", {
          roomId: roomA.roomId,
          recoveryCode: roomA.recoveryCode,
        });
        expect(recovered.ok).toBe(true);
        expect((await clearedOnRecover).files.B).toBeNull();

        const helloA3 = (await ack(a3, "room:hello", {
          roomId: roomA.roomId,
        })) as unknown as HelloAck;
        expect(helloA3.you.slot).toBe("A");
        expect(helloA3.snapshot.files).toEqual({ A: null, B: null });
      } finally {
        a3.disconnect();
      }
    } finally {
      for (const socket of [a1, a2, b1, b2]) socket.disconnect();
    }
  });

  it("restores seat, presence, chat history and the playback anchor on resume", async () => {
    const room = await createRoom();
    const a = await connect();
    const b = await connect();

    try {
      await join(a, room.roomId, room.inviteSecret);
      const joinB = await join(b, room.roomId, room.inviteSecret);
      expect(joinB.slot).toBe("B");

      const chatForB = nextEvent<{ text: string }>(b, "chat:message");
      await ack(a, "chat:send", { text: "before the drop" });
      await chatForB;

      const fileForA = nextEvent<{ files: Snapshot["files"] }>(
        a,
        "file:state",
        (payload) => payload.files.B?.name === "movie.mp4",
      );
      await ack(b, "file:announce", {
        name: "movie.mp4",
        sizeBytes: 1_000,
        durationSeconds: 120,
      });
      await fileForA;

      const rev = Date.now();
      const playEcho = nextEvent<{ rev: number }>(
        a,
        "sync:command",
        (payload) => payload.rev === rev,
      );
      await ack(a, "sync:command", { kind: "play", position: 12, rev });
      await playEcho;

      const offlineForA = nextEvent<{ slots: Snapshot["slots"] }>(
        a,
        "room:state",
        (payload) => payload.slots.B.online === false,
      );
      b.disconnect();
      await offlineForA;

      const b2 = await connect({
        roomId: room.roomId,
        sessionToken: joinB.token,
      });
      const onlineForA = nextEvent<{ slots: Snapshot["slots"] }>(
        a,
        "room:state",
        (payload) => payload.slots.B.online === true,
      );

      try {
        const hello = (await ack(b2, "room:hello", {
          roomId: room.roomId,
        })) as unknown as HelloAck;
        expect(hello.ok).toBe(true);
        expect(hello.you.slot).toBe("B");
        expect(hello.snapshot.slots.B).toEqual({
          occupied: true,
          online: true,
        });
        expect(hello.snapshot.chat.map((message) => message.text)).toEqual([
          "before the drop",
        ]);
        expect(hello.snapshot.files.B?.name).toBe("movie.mp4");
        expect(hello.snapshot.playback).toMatchObject({
          state: "playing",
          position: 12,
          seq: 1,
        });
        expect((await onlineForA).slots.B.online).toBe(true);

        const chatForB2 = nextEvent<{ text: string }>(b2, "chat:message");
        const chatForA = nextEvent<{ text: string }>(a, "chat:message");
        await ack(b2, "chat:send", { text: "after the resume" });
        expect((await chatForB2).text).toBe("after the resume");
        expect((await chatForA).text).toBe("after the resume");
      } finally {
        b2.disconnect();
      }
    } finally {
      a.disconnect();
      b.disconnect();
    }
  });
});
