/**
 * The landing page: the scene, and only the scene.
 *
 * This is now a separate thing from the app itself. The hero fills exactly one
 * viewport and the scroll cue leads OUT to /album — the library is its own route
 * now (app/album), drawn in the journal register, rather than a second section
 * stacked beneath the hero. Keeping the landing to one screen is what makes it
 * read as a front door rather than a page you have to scroll past.
 *
 * Stays a Server Component. `data-hero` is the hook the app bar uses to go
 * transparent over the scene.
 */
import { LandingHero } from "@/components/hero/LandingHero";

export const metadata = {
  title: "Spark — you enjoy the journey",
  description:
    "Spark rolls right behind you, capturing spontaneous 3D memories you can step back into long after the trip is over.",
};

export default function HomePage() {
  return (
    <main data-hero className="flex-1">
      <LandingHero />
    </main>
  );
}
