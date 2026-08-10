/**
 * The aurora landing: the scene, and only the scene. Served at /hero.
 *
 * MOVED OFF `/`, WHICH IT COLLIDED WITH. This and app/page.tsx — the journal
 * landing — both resolved to `/`, which Next refuses to build: two parallel
 * pages cannot own one path. The journal keeps `/` because that is the design
 * the companion work was built against (the sleeping mark beside the wordmark,
 * the flingable blob on the kept-moments belt). Nothing here was deleted, so
 * swapping the two is a rename if this scene should be the front door instead.
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
