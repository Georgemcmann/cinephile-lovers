/*
 * A one-line dedication for the landing page. Presentational only, so each
 * hero variant can place it inside its own composition.
 */
export function PereNote({ className = "" }: { className?: string }) {
  return (
    <p
      className={`font-serif text-lg italic tracking-[0.24em] text-soft sm:text-xl ${className}`}
    >
      HI PEREEEEE
      <span aria-hidden="true" className="ml-2 text-accent">
        ♥
      </span>
    </p>
  );
}
