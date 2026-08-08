import type { Metadata } from "next";
import { Archivo, Martian_Mono } from "next/font/google";
import { Suspense } from "react";
import { DeviceFrame } from "@/components/system/DeviceFrame";
import "./globals.css";

// Self-hosted by next/font rather than an @import from fonts.googleapis.com, so
// the demo still renders correctly with no network. Archivo is the ONE family —
// width 125 + weight 800 is the display voice, width 100 the UI voice — and
// Martian Mono speaks every timestamp, coordinate and provenance chip.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});
const martian = Martian_Mono({
  variable: "--font-martian",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Spark — a day, remembered in light",
  description:
    "A companion robot that follows you, keeps the moments worth keeping on its own, and pins them to a real map of your day as Gaussian splats you can step back into.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${martian.variable} antialiased`}>
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
