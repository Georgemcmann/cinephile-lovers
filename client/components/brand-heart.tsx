/*
 * The brand heart, built from plain boxes so it renders identically in the
 * browser and inside next/og (Satori) without depending on SVG or an emoji
 * font. Server-compatible: no hooks, no client-only APIs.
 */
type BrandHeartProps = {
  size?: number;
  color?: string;
};

export function BrandHeart({
  size = 160,
  color = "#e32636",
}: BrandHeartProps) {
  const lobe = size * 0.56;
  const square = size * 0.56;
  const left = size * 0.22;
  const top = size * 0.2;

  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: size,
        height: size * 0.9,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: lobe,
          height: lobe,
          borderRadius: lobe / 2,
          backgroundColor: color,
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          width: lobe,
          height: lobe,
          borderRadius: lobe / 2,
          backgroundColor: color,
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          left,
          top,
          width: square,
          height: square,
          backgroundColor: color,
          transform: "rotate(45deg)",
          display: "flex",
        }}
      />
    </div>
  );
}
