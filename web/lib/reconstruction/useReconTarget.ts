"use client";

/**
 * The reconstruction-target preference, as an external store.
 *
 * Same shape and the same reasoning as lib/splat/useSplatRenderer.ts:
 * localStorage does not exist on the server, must not be read during render,
 * and can change from outside React, which is precisely what
 * `useSyncExternalStore` is for. `getServerSnapshot` returns the shipped
 * default so the server and the hydrating client agree, and a reader whose
 * choice IS the default never sees a swap.
 *
 * The pure half is ./preference.ts, kept React-free so it can be asserted under
 * tsx by scripts/verify-pipeline.ts.
 */
import { useSyncExternalStore } from "react";

import {
  DEFAULT_RECON_TARGET,
  readTargetPreference,
  writeTargetPreference,
} from "./preference";
import type { ReconTarget } from "./targets";

/**
 * Cached so `getSnapshot` returns a referentially stable value while nothing
 * has changed, and so the localStorage read stays off the render path after
 * the first one.
 */
let current: ReconTarget | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): ReconTarget {
  if (current === null) current = readTargetPreference();
  return current;
}

function getServerSnapshot(): ReconTarget {
  return DEFAULT_RECON_TARGET;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Persist, then wake every mounted picker — including ones in other panels. */
export function setReconTarget(next: ReconTarget): void {
  if (current === next) return;
  current = next;
  writeTargetPreference(next);
  for (const l of listeners) l();
}

export function useReconTarget(): ReconTarget {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
