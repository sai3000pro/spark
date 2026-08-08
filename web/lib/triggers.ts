/** Human-readable trigger descriptions, shared by the timeline and moment views. */
import type { Trigger } from "./types";

export function describeTrigger(t: Trigger): string {
  switch (t.kind) {
    case "novel_object":
      return `first ${t.label} of the trip`;
    case "face_count":
      return `${t.value} people in frame`;
    case "dwell":
      return `stopped for ${Math.round(t.seconds)}s`;
    case "audio_energy":
      return `voices at ${Math.round(t.value * 100)}%`;
    case "laughter":
      return "laughter";
    case "speech_keyword":
      return `heard “${t.phrase}”`;
    case "scene_change":
      return `scene changed ${Math.round(t.value * 100)}%`;
  }
}

/** Which layer a trigger came from — audio triggers are the strongest and cheapest. */
export const TRIGGER_LAYER: Record<Trigger["kind"], "vision" | "audio" | "motion"> = {
  novel_object: "vision",
  face_count: "vision",
  scene_change: "vision",
  audio_energy: "audio",
  laughter: "audio",
  speech_keyword: "audio",
  dwell: "motion",
};

export const LAYER_COLOR: Record<"vision" | "audio" | "motion", string> = {
  vision: "#52cfe6",
  audio: "#f9b072",
  motion: "#9085e9",
};
