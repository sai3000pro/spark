import type { Metadata } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import { Suspense } from "react";
import { DeviceFrame } from "@/components/system/DeviceFrame";
import "./globals.css";

// Self-hosted by next/font rather than an @import from fonts.googleapis.com, so
// the demo still renders correctly with no network. Two families on a real
// contrast axis: Fraunces (a warm editorial serif, optical size on) carries
// every headline; Instrument Sans carries the UI, labels and numbers.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});
const instrument = Instrument_Sans({
  variable: "--font-instrument",
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
    <html lang="en" className={`${fraunces.variable} ${instrument.variable} antialiased`}>
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
