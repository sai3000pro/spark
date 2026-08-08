import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MomentDetail } from "@/components/moment/MomentDetail";
import { TopBar } from "@/components/shell/TopBar";
import { timecode } from "@/lib/format";
import { getMomentView } from "@/lib/tripData";

export default async function MomentPage({
  params,
}: PageProps<"/trip/[tripId]/moment/[momentId]">) {
  const { tripId, momentId } = await params;
  const view = getMomentView(momentId);
  if (!view || view.tripId !== tripId) notFound();

  return (
    <>
      <TopBar
        backHref={`/trip/${tripId}`}
        title={view.tripTitle}
        subtitle={`${timecode(view.moment.tStart)} · ${view.moment.place.label}`}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-5 sm:px-5">
        {/* useSearchParams (the ?anchor= deep link) needs a Suspense boundary. */}
        <Suspense fallback={null}>
          <MomentDetail view={view} />
        </Suspense>
      </main>
    </>
  );
}

export async function generateMetadata({
  params,
}: PageProps<"/trip/[tripId]/moment/[momentId]">) {
  const { momentId } = await params;
  const view = getMomentView(momentId);
  return {
    title: view ? `${view.moment.title} — Spark` : "Moment not found",
    description: view?.moment.summary,
  };
}
