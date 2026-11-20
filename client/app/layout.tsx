import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Inter, Playfair_Display } from "next/font/google";

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

export const metadata: Metadata = {
  title: "Cinephile Lovers",
  description: "Two hearts. One screen.",
};

export const viewport: Viewport = {
  themeColor: "#090909",
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