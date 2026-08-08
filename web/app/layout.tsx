import type { Metadata } from "next";
import { Schibsted_Grotesk, Fragment_Mono } from "next/font/google";
import { Suspense } from "react";
import { DeviceFrame } from "@/components/system/DeviceFrame";
import "./globals.css";

// Self-hosted by next/font rather than an @import from fonts.googleapis.com, so
// the demo still renders correctly with no network. One grotesk carries the
// whole voice — display through UI — and a typewriter mono carries the
// journal's specimen tags ([ KEPT ], [ 002 ], timestamps).
const grotesk = Schibsted_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});
const typewriter = Fragment_Mono({
  variable: "--font-typewriter",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Spark — a day, remembered in light",
  description:
    "A companion robot that follows you, keeps the moments worth keeping on its own, and pins them to a real map of your day as Gaussian splats you can step back into.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${grotesk.variable} ${typewriter.variable} antialiased`}>
      {/* One register everywhere now — the whole product is the journal. */}
      <body className="field-site">
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
