import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <p className="text-xs uppercase tracking-[0.35em] text-muted">
        A private screening for two
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">Cinephile Lovers</h1>
      <p className="text-lg text-muted">Two hearts. One screen.</p>
      <Link
        href="/lobby"
        className="mt-6 inline-flex min-h-[44px] items-center rounded-full border border-btn-red bg-btn-red px-8 font-semibold text-white transition-colors hover:border-btn-red-deep hover:bg-btn-red-deep"
      >
        Enter the lobby
      </Link>
      <p className="mt-8 max-w-sm text-xs leading-relaxed text-muted">
        Each of you plays your own copy of the movie. Files never leave your
        devices — the server only keeps the two of you in sync.
      </p>
    </main>
  );
}
