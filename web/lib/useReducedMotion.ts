"use client";

/**
 * Does this visitor want motion held back?
 *
 * globals.css already neutralises CSS animation under the preference, so this is
 * only for motion CSS cannot see: a WebGL scene rendering its own frames, or a
 * rAF loop moving an element by writing custom properties. Both exist here — the
 * globe, and the hero blob's fling.
 *
 * `useSyncExternalStore` rather than an effect + state so the first client render
 * already has the right answer and the media query is subscribed, not polled.
 *
 * THE SERVER SNAPSHOT IS `false`, WHICH IS A CLAIM, NOT A GUESS. The server
 * cannot know the preference, so anything rendered from this value would
 * hydration-mismatch for a visitor who has it set. That is safe here only because
 * every caller uses it to decide whether to START motion — never to choose what
 * to render. Keep it that way: if a caller ever needs it in markup, it has to
 * render the reduced form on the server and correct after mount, not read this.
 */
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
