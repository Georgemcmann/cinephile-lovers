import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Inter, Playfair_Display } from "next/font/google";
import { headers } from "next/headers";

import { PersistentLayer } from "@/components/persistent-layer";

import "./globals.css";

/*
 * Display face for the landing hero (movie-poster voice). The variable
 * --font-display-src is mapped to the `font-display` Tailwind utility in
 * globals.css (@theme --font-display). Body copy keeps Inter via
 * --font-body-src -> --font-sans. Playfair Display (serif, normal +
 * italic) is loaded for the "Velvet Noir" hero variant only — it maps to
 * the `font-serif` utility via --font-serif-src; other pages are
 * unaffected unless they opt into font-serif.
 */
const display = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display-src",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body-src",
  display: "swap",
});

const serif = Playfair_Display({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-serif-src",
  display: "swap",
});

const SITE_NAME = "Cinephile Lovers";
const SITE_DESCRIPTION =
  "Two hearts. One screen. A private watch room for two — your movie never leaves your device.";

/*
 * Link previews need an ABSOLUTE og:image URL, which means a metadataBase.
 * Derive it from the request host so previews work on whatever domain the
 * app is deployed to (Pxxl, Vercel, a custom domain) without extra config.
 * NEXT_PUBLIC_SITE_URL wins when set, e.g. to pin the canonical origin.
 */
function metadataBaseFromHeaders(requestHeaders: Headers): URL {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      return new URL(configured);
    } catch {
      // Malformed env value: fall through to the request host.
    }
  }

  const host =
    requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    requestHeaders.get("host") ||
    "localhost:3000";
  const forwardedProto = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const isLocal = host.startsWith("localhost") || host.startsWith("127.");
  const proto =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : isLocal
        ? "http"
        : "https";

  return new URL(`${proto}://${host}`);
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const metadataBase = metadataBaseFromHeaders(requestHeaders);

  return {
    metadataBase,
    title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
      url: "/",
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#090909",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${serif.variable}`}
    >
      <body>
        {/* PersistentLayer sits ABOVE the route tree: root layouts survive
            navigation in the App Router, so everything it owns (the video
            element, and later the socket and object URL) survives too. */}
        <PersistentLayer>{children}</PersistentLayer>
      </body>
    </html>
  );
}