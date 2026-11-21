import { ImageResponse } from "next/og";

import { BrandHeart } from "@/components/brand-heart";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/* Apple touch icon: the heart mark on the app's near-black tile. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#090909",
        }}
      >
        <BrandHeart size={104} />
      </div>
    ),
    { ...size },
  );
}
