"use client";

import Link from "next/link";

import { NodeBadge } from "@/components/node-badge";

export default function LobbyPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold">Lobby</h1>
        <p className="mt-1 text-sm text-muted">
          Room codes and invitations arrive in M3 — for now this is your
          private screening setup.
        </p>
      </header>

      <NodeBadge label="lobby" />

      <nav className="flex flex-col gap-3">
        <Link
          href="/room"
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-btn-red px-6 font-semibold text-ink transition-colors hover:bg-btn-red-deep"
        >
          Enter the watch room
        </Link>
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