"use client";

import Link from "next/link";

import { FilePicker } from "@/components/file-picker";
import { NodeBadge } from "@/components/node-badge";
import { PlayerControls } from "@/components/player-controls";

export default function WatchRoomPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Watch room</h1>
        <p className="mt-1 text-sm text-muted">
          Local playback first: your file, your device, no uploads.
        </p>
      </header>

      <NodeBadge label="watch" />

      <FilePicker />
      <PlayerControls />

      <nav className="flex flex-col gap-3">
        <Link
          href="/lobby"
          className="inline-flex min-h-11 items-center justify-center rounded-full px-6 text-sm text-muted transition-colors hover:text-ink"
        >
          Back to lobby
        </Link>
      </nav>
    </main>
  );
}