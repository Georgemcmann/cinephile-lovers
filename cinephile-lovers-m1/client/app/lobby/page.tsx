"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus } from "lucide-react";

import { NodeBadge } from "@/components/node-badge";
import { CreateRoomError, createRoom } from "@/lib/api";

const recoveryKey = (roomId: string) => `cl:recovery:${roomId}`;

/**
 * Lobby — M3 makes it functional: "Create a room" calls the backend and
 * navigates to /room/<id>#<secret>.
 *
 * - The invite secret travels in the URL fragment (brief §6); the room page
 *   captures it and scrubs the address bar.
 * - The recovery code takes a side-channel (sessionStorage) to the room
 *   page, which shows it exactly once.
 * - Joining works by opening the invite link — there is nothing to type,
 *   and no join-by-code input exists (secrets are never typed, only linked).
 */
export default function LobbyPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const room = await createRoom();
      sessionStorage.setItem(recoveryKey(room.roomId), room.recoveryCode);
      router.push(`/room/${room.roomId}#${room.inviteSecret}`);
    } catch (err) {
      setError(
        err instanceof CreateRoomError
          ? err.message
          : "Something went wrong. Try again.",
      );
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold">Lobby</h1>
        <p className="mt-1 text-sm text-muted">
          Create a room, send the invite link to your partner, and pick your
          copy of the movie.
        </p>
      </header>

      <NodeBadge label="lobby" />

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={handleCreate}
          disabled={busy}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-btn-red px-6 font-semibold text-ink transition-colors hover:bg-btn-red-deep disabled:opacity-50"
        >
          {busy ? (
            <>
              <LoaderCircle
                size={18}
                className="animate-spin"
                aria-hidden="true"
              />
              Creating the room…
            </>
          ) : (
            <>
              <Plus size={18} aria-hidden="true" />
              Create a room
            </>
          )}
        </button>
        {error ? (
          <p className="text-sm text-soft" role="alert">
            {error}
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-muted">
          Joining works by opening the invite link — there is nothing to
          type. The room key lives inside the link itself.
        </p>
      </div>

      <nav className="flex flex-col gap-3">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center justify-center rounded-full px-6 text-sm text-muted transition-colors hover:text-ink"
        >
          Back to start
        </Link>
      </nav>
    </main>
  );
}