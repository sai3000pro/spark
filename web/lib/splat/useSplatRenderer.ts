"use client";

/**
 * The renderer preference, as an external store.
 *
 * localStorage is exactly the thing `useSyncExternalStore` exists for: a value
 * that does not exist on the server, must not be read during render, and can
 * change from outside React. Reading it in an effect and calling setState is
 * the shape that looks obvious and cascades an extra render on every mount —
 * and, worse, tears when two viewers are open at once.
 *
 * `getServerSnapshot` returns the deployment default, so the server and the
 * hydrating client agree; React then re-renders with the real stored value. A
 * reader whose choice is the default never sees a swap at all.
 *
 * The pure half of this lives in lib/splat/renderer.ts and stays free of React
 * so scripts/verify-pipeline.ts can assert it under tsx.
 */
import { useSyncExternalStore } from "react";
import {
  DEFAULT_SPLAT_RENDERER,
  readRendererPreference,
  writeRendererPreference,
  type SplatRenderer,
} from "./renderer";

/**
 * Cached because `getSnapshot` must return a referentially stable value for as
 * long as nothing changed — re-reading localStorage on every call would return
 * an equal string, which is fine, but the cache also keeps the read off the
 * render path after the first one.
 */
let current: SplatRenderer | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): SplatRenderer {
  if (current === null) current = readRendererPreference();
  return current;
}

function getServerSnapshot(): SplatRenderer {
  return DEFAULT_SPLAT_RENDERER;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Persist, then wake every viewer — including any others already open. */
export function setSplatRenderer(next: SplatRenderer): void {
  if (current === next) return;
  current = next;
  writeRendererPreference(next);
  for (const l of listeners) l();
}

export function useSplatRenderer(): SplatRenderer {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
