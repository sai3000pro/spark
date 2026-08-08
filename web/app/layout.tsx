import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Outfit } from "next/font/google";
import { Suspense } from "react";
import { DeviceFrame } from "@/components/shell/DeviceFrame";
import "./globals.css";

// Self-hosted by next/font rather than an @import from fonts.googleapis.com, so
// the demo still renders correctly with no network.
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], display: "swap" });
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
      className={`${outfit.variable} ${inter.variable} ${jetbrainsMono.variable} antialiased`}
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
