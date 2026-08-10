/**
 * The phone end of the handoff.
 *
 * Deliberately its own route, outside both the journal and aurora shells: it is
 * opened by a camera app on a device that has never seen this site, it is held
 * one-handed, and it has exactly one job.
 *
 * No capability detection happens here. The server can guess from the origin
 * whether the phone will have a secure context, but only the phone knows what
 * its browser actually implements — and the guess being wrong in either
 * direction is worse than not making it. So the client feature-detects. See
 * PhoneCapture.
 */
import { PhoneCapture } from "./PhoneCapture";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Record a capture · Spark",
  // The phone reached this page by scanning a code on a laptop. It should not
  // end up anywhere else's index.
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ handoffId: string }>;
}) {
  const { handoffId } = await params;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-8">
      <PhoneCapture handoffId={handoffId} />
    </main>
  );
}
