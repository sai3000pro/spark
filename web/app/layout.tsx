import type { Metadata } from "next";
import { Bricolage_Grotesque, Space_Grotesk, Space_Mono } from "next/font/google";
import { Suspense } from "react";
import { DeviceFrame } from "@/components/system/DeviceFrame";
import "./globals.css";

// Self-hosted by next/font rather than an @import from fonts.googleapis.com, so
// the demo still renders correctly with no network. Bricolage carries the
// chunky title-card display; Space Grotesk is the UI voice; Space Mono speaks
// every timestamp and tag in uppercase.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
});
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});
const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Spark — the day, on a map",
  description:
    "A companion robot that follows you, captures the moments worth keeping on its own, and pins them to the map of your day as Gaussian splats you can step back into.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${spaceGrotesk.variable} ${spaceMono.variable} antialiased`}
    >
      <body>
        {/* DeviceFrame reads ?chrome=off via useSearchParams, which needs a
            Suspense boundary; the fallback renders the app unwrapped so there is
            never a blank frame. */}
        <Suspense fallback={<div className="flex min-h-screen flex-col">{children}</div>}>
          <DeviceFrame>{children}</DeviceFrame>
        </Suspense>
      </body>
    </html>
  );
}
