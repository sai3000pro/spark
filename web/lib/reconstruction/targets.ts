/**
 * Where a clip goes to be reconstructed, and which of those are real right now.
 *
 * Three destinations, and the difference between them is not a preference —
 * it is which machine has to exist:
 *
 *   studio-live   the Reconstruction Studio on this laptop, training WHILE you
 *                 film. Needs the studio running with its live endpoint, which
 *                 needs a GPU. Genuinely progressive: the splat grows as frames
 *                 arrive. See lib/studio.ts and /api/capture/live-splat.
 *   studio-batch  the same studio, but handed the finished clip. Still local,
 *                 still free, just not live.
 *   kiri          KIRI Engine's cloud API. No GPU needed, costs a credit, and
 *                 the user brings the key. See ./kiri.ts.
 *
 * NOTHING IS OFFERED THAT IS NOT REACHABLE. Every option below is probed before
 * it is shown, because a choice that silently does nothing is worse than an
 * absent one — the whole point of picking a destination is knowing where it went.
 * Where an option is unavailable it still appears, greyed, with the reason: "no
 * GPU studio running here" is a fact someone can act on.
 */
import { budgetFor, type GpuTier } from "../gpu";
import { STUDIO_URL } from "../studio";

export type ReconTarget = "browser" | "studio-live" | "studio-batch" | "kiri";

export const RECON_TARGETS: ReconTarget[] = [
  "browser",
  "studio-live",
  "studio-batch",
  "kiri",
];

export function isReconTarget(v: unknown): v is ReconTarget {
  return typeof v === "string" && (RECON_TARGETS as string[]).includes(v);
}

/**
 * Is there actually a trainer to run in the browser?
 *
 * No. And that is the entire reason this constant exists rather than being
 * implied by the GPU probe.
 *
 * The probe in lib/gpu.ts answers "could this machine train a splat" — it
 * requests a real adapter, runs a compute shader and checks the arithmetic, so
 * on a decent laptop it returns a genuine yes. What it cannot answer is whether
 * this repo contains anything that would DO the training, and it does not: no
 * browser-side Gaussian-splat trainer is npm-installable, so Brush's WASM build
 * has to be sourced and vendored separately. Until it is, capability and
 * availability are two different facts and only one of them is true.
 *
 * Gating on the probe alone made the menu lie in the most expensive way it
 * could. "Reconstruct right here" appeared enabled on exactly the good machines,
 * accepted the clip, and the dispatcher answered "Saved. Reconstruction runs in
 * your browser" — a success message for work that would never start. The clip
 * was safe on disk, but the user had been told to keep a tab open and wait for
 * something that was not coming, and nothing anywhere would ever contradict it.
 *
 * Flip this to true in the same commit that lands the trainer, not before.
 */
const BROWSER_TRAINER_AVAILABLE = false;

export interface TargetOption {
  id: ReconTarget;
  label: string;
  detail: string;
  available: boolean;
  /** Why not, phrased for a person. Null when available. */
  blockedBecause: string | null;
}

export interface StudioProbe {
  reachable: boolean;
  /** The studio answers /api/live_splat, so progressive training is possible. */
  live: boolean;
}

/** Short: this runs while someone waits on a phone screen. */
const PROBE_MS = 1500;

/**
 * Is the studio there, and can it train live?
 *
 * Two questions, because they have different answers: a studio serving a finished
 * album has `/api/runs` but an older build may have no live endpoint at all. A
 * 404 is a real answer meaning "not supported"; a network error means "not there".
 */
export async function probeStudio(): Promise<StudioProbe> {
  const reachable = await ping(`${STUDIO_URL}/api/runs`);
  if (!reachable) return { reachable: false, live: false };

  // Any answer other than 404 means the route exists — a 400 for the nonsense
  // session id below is a perfectly good "yes, and that is not a session".
  const liveStatus = await status(`${STUDIO_URL}/api/live_splat?session=__probe__`);
  return { reachable: true, live: liveStatus !== null && liveStatus !== 404 };
}

async function ping(url: string): Promise<boolean> {
  return (await status(url)) !== null;
}

async function status(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(PROBE_MS) });
    return res.status;
  } catch {
    return null;
  }
}

/** The menu, as it actually stands on this machine at this moment. */
export function describeTargets(input: {
  studio: StudioProbe;
  hasKiriKey: boolean;
  kiriCredits: number | null;
  /**
   * KIRI's own words for refusing the stored key, when it has refused it.
   *
   * Separate from `kiriCredits` because "this key is not valid" and "this key
   * has nothing left" are different problems with different fixes, and a menu
   * that reported the second for the first would send someone hunting for a
   * billing page over a typo in `.env`.
   */
  kiriRejected?: string | null;
  /**
   * The viewer's own GPU, probed in ITS browser — so this is passed in by the
   * client rather than measured on the server, which has no GPU and is not the
   * machine that would do the work.
   */
  gpu?: { tier: GpuTier; blockedBecause: string | null } | null;
}): TargetOption[] {
  const { studio, hasKiriKey, kiriCredits, kiriRejected = null, gpu = null } = input;

  const outOfCredits = kiriCredits !== null && kiriCredits <= 0;
  const budget = gpu ? budgetFor(gpu.tier) : null;

  return [
    {
      // Listed first because it is the only option that needs nothing: no GPU
      // box on the network, no account, no key, no upload. On a machine that
      // can do it at all, it is the shortest path from a clip to a splat.
      id: "browser",
      label: "Reconstruct right here",
      detail: budget
        ? `In this tab, on your own GPU. About ${budget.estimate}.`
        : "In this tab, on your own GPU. Nothing to install.",
      available: BROWSER_TRAINER_AVAILABLE && !!gpu && gpu.tier !== "none",
      blockedBecause:
        !gpu
          ? // Deliberately not "still checking". The server has no GPU and is
            // not the machine that would do the work, so it cannot answer this
            // — only the browser that will actually train can, and on the phone
            // that browser is not the one holding the clip.
            "Offered on the laptop that receives the clip, not here."
          : gpu.tier === "none"
            ? (gpu.blockedBecause ?? "This machine cannot reconstruct in the browser.")
            : !BROWSER_TRAINER_AVAILABLE
              ? // The machine passed the probe; we are the ones not ready. Say
                // so in those terms — "your GPU is fine, the engine isn't here
                // yet" sends nobody hunting through their own driver settings
                // for a fault that is ours.
                "Your GPU can do this, but the in-browser engine isn't shipped yet. Use the studio or KIRI."
              : null,
    },
    {
      id: "studio-live",
      label: "Render live on the laptop",
      detail: "The splat builds while you film. Needs the GPU studio running.",
      available: studio.reachable && studio.live,
      blockedBecause: !studio.reachable
        ? "No reconstruction studio is running on the laptop."
        : !studio.live
          ? "The studio is running but this build has no live endpoint."
          : null,
    },
    {
      id: "studio-batch",
      label: "Render on the laptop after",
      detail: "Same studio, handed the finished clip. Free, and stays on your machine.",
      available: studio.reachable,
      blockedBecause: studio.reachable
        ? null
        : "No reconstruction studio is running on the laptop.",
    },
    {
      id: "kiri",
      label: "Send to KIRI",
      detail: "Reconstructed in the cloud. Costs one of your KIRI credits.",
      available: hasKiriKey && !outOfCredits && !kiriRejected,
      blockedBecause: !hasKiriKey
        ? "No KIRI key yet — add one on the laptop."
        : kiriRejected
          ? // Verbatim. kiri.ts already phrases its messages for a person, and
            // prefixing produced "KIRI rejected that key: KIRI did not accept
            // that key."
            kiriRejected
          : outOfCredits
            ? "That KIRI key has no credits left."
            : null,
    },
  ];
}

/**
 * What to fall back to when the chosen destination cannot be reached.
 *
 * Always something, and never silence: the clip is already stored by the time
 * this is consulted, so the worst honest outcome is "we kept it, nothing has
 * reconstructed it yet" — which is exactly what `null` means to the caller.
 */
export function fallbackFor(
  wanted: ReconTarget,
  options: TargetOption[],
): ReconTarget | null {
  if (options.find((o) => o.id === wanted)?.available) return wanted;
  // Live degrades to batch on the same machine before it degrades to the cloud,
  // because batch costs nothing and the user already chose "on the laptop".
  if (wanted === "studio-live" && options.find((o) => o.id === "studio-batch")?.available) {
    return "studio-batch";
  }
  // A browser that turned out not to be able to do it falls to the studio
  // rather than to the cloud: the user picked "on my own machine", and KIRI
  // spends a credit they may not have meant to spend.
  if (wanted === "browser") {
    const local = options.find((o) => o.id === "studio-batch");
    if (local?.available) return "studio-batch";
  }
  return null;
}
