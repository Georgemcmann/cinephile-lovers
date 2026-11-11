/**
 * Thin REST client. M3 covers room creation only; joining/exchanging the
 * invite secret is a socket concern (M4) and deliberately has NO REST call
 * (review R2: no REST token exchange).
 *
 * The base URL is inlined at build time from NEXT_PUBLIC_API_URL; the
 * localhost fallback keeps `npm run dev` working without .env.local.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type CreatedRoom = {
  roomId: string;
  invitePath: string;
  inviteSecret: string;
  recoveryCode: string;
  expiresAt: string;
};

export type CreateRoomErrorKind =
  | "unreachable"
  | "rate_limited"
  | "server"
  | "invalid"
  | "unknown";

export class CreateRoomError extends Error {
  constructor(
    readonly kind: CreateRoomErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "CreateRoomError";
  }
}

export async function createRoom(): Promise<CreatedRoom> {
  let response: Response;
  try {
    // Generous timeout: free-tier hosts sleep, and the first request of the
    // day may be the one that wakes the server (review R8).
    response = await fetch(`${API_BASE}/api/rooms`, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new CreateRoomError(
      "unreachable",
      "Could not reach the server. It may be waking up — try again in a minute.",
    );
  }

  if (response.status === 429) {
    throw new CreateRoomError(
      "rate_limited",
      "Too many rooms from this network right now. Try again later.",
    );
  }
  if (!response.ok) {
    throw new CreateRoomError(
      "server",
      "The server could not create the room. Try again.",
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new CreateRoomError("invalid", "Unexpected server response.");
  }
  if (!isCreatedRoom(data)) {
    throw new CreateRoomError("invalid", "Unexpected server response.");
  }
  return data;
}

function isCreatedRoom(value: unknown): value is CreatedRoom {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.roomId === "string" &&
    v.roomId.length > 0 &&
    typeof v.invitePath === "string" &&
    typeof v.inviteSecret === "string" &&
    v.inviteSecret.length > 0 &&
    typeof v.recoveryCode === "string" &&
    typeof v.expiresAt === "string"
  );
}