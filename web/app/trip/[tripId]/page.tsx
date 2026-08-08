import { redirect } from "next/navigation";

/** The trip lives on the atlas now — the map IS the app. */
export default function TripPage() {
  redirect("/");
}
