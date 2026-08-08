import { redirect } from "next/navigation";

/**
 * Old moment deep-links open the same moment's splat takeover on the atlas.
 * `?anchor=<trackId>` (the find → 3D handoff) is carried through.
 */
export default async function MomentPage({
  params,
  searchParams,
}: PageProps<"/trip/[tripId]/moment/[momentId]">) {
  const { momentId } = await params;
  const sp = await searchParams;
  const anchor = Array.isArray(sp.anchor) ? sp.anchor[0] : sp.anchor;
  redirect(`/?m=${momentId}${anchor ? `&anchor=${anchor}` : ""}`);
}
