import { redirect } from "next/navigation";

/**
 * The aurora library folded into the landing: its hero opens the combined page
 * and its albums are the landing's shelf. Old /library links land there. The
 * scene and album components live on under components/hero and
 * components/album, imported by the landing.
 */
export default function LibraryPage() {
  redirect("/#albums");
}
