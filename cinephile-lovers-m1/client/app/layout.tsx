import type { Metadata, Viewport } from "next";

import { PersistentLayer } from "@/components/persistent-layer";

import "./globals.css";

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
    <html lang="en">
      <body>
        {/* PersistentLayer sits ABOVE the route tree: root layouts survive
            navigation in the App Router, so everything it owns (the video
            element, and later the socket and object URL) survives too. */}
        <PersistentLayer>{children}</PersistentLayer>
      </body>
    </html>
  );
}
