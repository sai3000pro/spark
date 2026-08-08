import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Outfit, Poppins } from "next/font/google";
import { Suspense } from "react";
import { DeviceFrame } from "@/components/shell/DeviceFrame";
import "./globals.css";

// Self-hosted by next/font rather than an @import from fonts.googleapis.com, so
// the demo still renders correctly with no network AT RUNTIME. Note the build
// itself fetches these from Google once and caches them, so a first build on a
// machine with no network will fail.
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], display: "swap" });

// The landing hero's face, from the brand sheet.
//
// `weight` is REQUIRED and not a style choice: Poppins is a static family in this
// Next version (nine discrete weights, `axes: null` in next's font-data.json),
// and omitting it is a hard build error rather than a silent fallback. Only the
// two weights the hero actually uses are loaded — ~24 KB.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
});
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Spark — relive the trip",
  description:
    "A companion robot that follows you, captures the moments worth keeping on its own, and remembers where you left things.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // Required by Next 16: the router only suspends a global
      // `scroll-behavior: smooth` during route transitions when this attribute
      // is present. Without it, every in-app navigation smooth-scrolls a full
      // page height instead of jumping. Ships with the CSS rule or not at all.
      data-scroll-behavior="smooth"
      className={`${outfit.variable} ${poppins.variable} ${inter.variable} ${jetbrainsMono.variable} antialiased`}
    >
      <body>
        {/* Each page renders its own <TopBar> so it can set the title and back
            target — the robot's status bar is part of the screen, not a chrome
            wrapper around it.

            DeviceFrame reads ?chrome=off via useSearchParams, which needs a
            Suspense boundary; the fallback renders the app unwrapped so there is
            never a blank frame. */}
        <Suspense fallback={<div className="flex min-h-screen flex-col">{children}</div>}>
          <DeviceFrame>{children}</DeviceFrame>
        </Suspense>
      </body>
    </html>
  );
}
