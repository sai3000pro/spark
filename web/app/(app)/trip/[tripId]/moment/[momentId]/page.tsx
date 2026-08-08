import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MomentDetail } from "@/components/moment/MomentDetail";
import { getMomentView } from "@/lib/tripData";

export default async function MomentPage({
  params,
}: PageProps<"/trip/[tripId]/moment/[momentId]">) {
  const { tripId, momentId } = await params;
  // getMomentView is scoped by tripId now, so a moment id from another trip is
  // already a miss — no second guard needed.
  const view = getMomentView(tripId, momentId);
  if (!view) notFound();

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-5 sm:px-5">
      {/* MomentDetail renders its own breadcrumb and title — this is the deepest
          screen in the app and it was already the one page with a single, correct
          heading. It gets no PageHeader on top of that. */}
      {/* useSearchParams (the ?anchor= deep link) needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <MomentDetail view={view} />
      </Suspense>
    </main>
  );
}

export async function generateMetadata({
  params,
}: PageProps<"/trip/[tripId]/moment/[momentId]">) {
  const { tripId, momentId } = await params;
  const view = getMomentView(tripId, momentId);
  return {
    title: view ? `${view.moment.title} — Spark` : "Moment not found",
    description: view?.moment.summary,
  };
}
