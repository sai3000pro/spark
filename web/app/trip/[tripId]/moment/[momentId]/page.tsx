import { redirect } from "next/navigation";

/**
 * Old moment deep-links open the same moment's splat takeover on its trip's walk.
 * `?anchor=<trackId>` (the find → 3D handoff) is carried through.
 *
 * The tripId used to be dropped here, which sent every cross-trip search result
 * — components/search/ObjectSearch.tsx builds exactly this URL — to Waterloo
 * Park's walk with a moment id that did not exist in it.
 */
export default async function MomentPage({
  params,
  searchParams,
}: PageProps<"/trip/[tripId]/moment/[momentId]">) {
  const { tripId, momentId } = await params;
  const sp = await searchParams;
  const anchor = Array.isArray(sp.anchor) ? sp.anchor[0] : sp.anchor;
  redirect(
    `/trip/${encodeURIComponent(tripId)}?m=${encodeURIComponent(momentId)}` +
      (anchor ? `&anchor=${encodeURIComponent(anchor)}` : ""),
  );
}
