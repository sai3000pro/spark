import { redirect } from "next/navigation";

/**
 * The globe view is retired: the day lives on the paper survey map now.
 * Old /globe links (and the app bar's Map tab) land on the walk. The globe
 * components stay in components/globe/ if it ever earns its way back.
 */
export default function GlobePage() {
  redirect("/walk");
}
