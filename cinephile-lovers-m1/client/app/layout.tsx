import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Inter } from "next/font/google";

import { PersistentLayer } from "@/components/persistent-layer";

import "./globals.css";

/*
 * Display face for the landing hero (movie-poster voice). The variable
 * --font-display-src is mapped to the `font-display` Tailwind utility in
 * globals.css (@theme --font-display). Body copy keeps Inter via
 * --font-body-src -> --font-sans.
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
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        {/* PersistentLayer sits ABOVE the route tree: root layouts survive
            navigation in the App Router, so everything it owns (the video
            element, and later the socket and object URL) survives too. */}
        <PersistentLayer>{children}</PersistentLayer>
      </body>
    </html>
  );
}