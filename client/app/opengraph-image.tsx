import { ImageResponse } from "next/og";

import { BrandHeart } from "@/components/brand-heart";

export const alt = "Cinephile Lovers — two hearts, one screen";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/*
 * Link-preview card. Social platforms do not reliably render an SVG favicon
 * in a preview, so this is a real PNG with the same dark/red identity and
 * the heart mark. Rendered on demand by next/og.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#050505",
          color: "#f5f5f5",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 32,
            right: 32,
            bottom: 32,
            left: 32,
            display: "flex",
            border: "1px solid #303030",
            borderRadius: 28,
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 72px",
          }}
        >
          <BrandHeart size={132} />

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: 34,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 104,
                fontWeight: 700,
                letterSpacing: 10,
                lineHeight: 1,
                color: "#f5f5f5",
              }}
            >
              CINEPHILE
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 104,
                fontWeight: 700,
                letterSpacing: 10,
                lineHeight: 1,
                marginTop: 6,
                color: "#e32636",
              }}
            >
              LOVERS
            </div>
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 28,
              fontSize: 34,
              fontStyle: "italic",
              color: "#f04452",
            }}
          >
            Two hearts. One screen.
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 22,
              fontSize: 18,
              letterSpacing: 7,
              color: "#a3a3a3",
            }}
          >
            A PRIVATE SCREENING FOR TWO
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
