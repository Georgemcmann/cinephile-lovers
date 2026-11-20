/**
 * FilmGrain — landing-only atmosphere overlays.
 *
 * Two fixed, pointer-events-none layers:
 * - .film-grain   : animated SVG turbulence tile (celluloid noise)
 * - .film-vignette: radial darkening that frames the content like a screen
 *
 * Pure CSS animation (no client JS), so this stays a server component.
 * z-index: grain (70) sits above everything including the vignette (30);
 * neither intercepts input.
 */
export function FilmGrain() {
  return (
    <>
      <div aria-hidden="true" className="film-vignette" />
      <div aria-hidden="true" className="film-grain" />
    </>
  );
}