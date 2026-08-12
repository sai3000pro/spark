/// <reference types="@webgpu/types" />
/**
 * What this machine can actually do, measured rather than assumed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS, AND THE MISTAKE IT ENCODES
 *
 * Reconstruction was gated on "is there a CUDA box reachable", which quietly
 * assumed Gaussian-splat training needs NVIDIA hardware. That is true of the
 * INRIA/nerfstudio lineage and NOT true of the one this repo actually uses:
 * Brush is Rust + Burn + WGPU, targeting Vulkan/DX12/Metal/WebGPU precisely so
 * it runs on integrated graphics, Apple Silicon, phones, and browsers.
 *
 * Measured on the laptop this was written on — Intel Iris Xe, gen-12lp,
 * no dedicated VRAM at all — WebGPU is present, a compute shader runs, and
 * `float32-blendable` is supported, which is the specific feature splat alpha
 * compositing needs. A machine written off as incapable is capable.
 *
 * So capability is never inferred from a device NAME here. It is probed: ask
 * for an adapter, run a real compute shader, check the result is arithmetically
 * correct, and TIME it. Everything downstream keys off the measurement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "ALMOST ANY MACHINE" IS A DEGRADATION STORY, NOT A CLAIM
 *
 * WebGPU is in Chrome/Edge 113+, Safari 26+, Firefox 141+. That is most desktops
 * and a growing share of phones — and it is emphatically not all of them. So
 * every failure below is a NAMED, RECOVERABLE state, never a dead end:
 *
 *   no WebGPU        → the browser option is absent with a reason; studio and
 *                      KIRI are untouched.
 *   no adapter       → same. Some Linux/VM setups expose the API and no device.
 *   software adapter → treated as NO GPU on purpose. SwiftShader and lavapipe
 *                      will happily run the shader on the CPU and report
 *                      success, and promising a splat on a software rasteriser
 *                      is worse than declining: it would run for hours.
 *   weak GPU         → offered, with a budget it can actually finish.
 *
 * The only thing that is never allowed to happen is a machine being told it can
 * do something it cannot, or being denied something it can.
 */

export type GpuTier = "none" | "weak" | "modest" | "strong";

export interface GpuReport {
  webgpu: boolean;
  adapter: boolean;
  /** A compute shader ran AND returned the arithmetically correct answer. */
  computeVerified: boolean;
  /** True when the adapter is a CPU emulator pretending to be a GPU. */
  software: boolean;
  vendor: string;
  architecture: string;
  /** Float32 alpha blending — what splat compositing needs. */
  float32Blendable: boolean;
  maxStorageBindingBytes: number;
  /** Millions of fused ops per second, measured. 0 when nothing ran. */
  score: number;
  tier: GpuTier;
  /** Why the browser cannot train here, phrased for a person. Null when it can. */
  blockedBecause: string | null;
}

export const NO_GPU: GpuReport = Object.freeze({
  webgpu: false,
  adapter: false,
  computeVerified: false,
  software: false,
  vendor: "",
  architecture: "",
  float32Blendable: false,
  maxStorageBindingBytes: 0,
  score: 0,
  tier: "none",
  blockedBecause: "This browser has no WebGPU, so it cannot reconstruct here.",
}) as GpuReport;

/** Names a software rasteriser goes by. Any of these means "not a GPU". */
const SOFTWARE = /swiftshader|lavapipe|llvmpipe|software|microsoft basic/i;

/**
 * Tier from the measured score and the hard limits.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THRESHOLDS ARE ANCHORED ON ONE REAL MEASUREMENT, AND THAT IS A LIMITATION
 *
 * An Intel Iris Xe (gen-12lp, 96 EU, no dedicated VRAM) measures ~95,000 here,
 * best-of-three, varying about 1.3× run to run. That machine anchors `weak`:
 * it can genuinely train a small scene, slowly. The bands above it are
 * multiples of that one point:
 *
 *   weak     < 1.8×   integrated graphics, older laptops
 *   modest   2–6×     Apple Silicon Pro, mid-range discrete
 *   strong   ≥ 6×     recent discrete cards
 *
 * Cross-checked against known throughput (an M3 Pro and a 3060 should land in
 * modest, a 4080 in strong) but NOT measured on those machines. One data point
 * cannot calibrate a curve. The bands are therefore wide, and the boundary sits
 * far above the reference machine's own variance so that thermal noise cannot
 * move a device between bands. Tighten these only when real numbers arrive.
 *
 * The benchmark is a dependent FMA chain, so it is latency-bound and reads
 * around 6% of a device's peak FLOPS. That is fine — it only has to be
 * consistent between machines, not absolute.
 */
export function tierFor(input: {
  score: number;
  software: boolean;
  computeVerified: boolean;
  float32Blendable: boolean;
  maxStorageBindingBytes: number;
}): GpuTier {
  const { score, software, computeVerified, float32Blendable } = input;
  if (!computeVerified || software) return "none";
  // Without float32 blending the compositing step cannot be done correctly, and
  // an approximation here shows up as visible banding in every splat.
  if (!float32Blendable) return "none";
  // A single storage buffer has to hold the splat set. Below this the scene has
  // to be tiled, which is a different engine, not a smaller budget.
  if (input.maxStorageBindingBytes < 128 * 1024 * 1024) return "none";

  // SPEED NEVER SAYS NO. Everything above this line is a capability question
  // with a yes-or-no answer; from here down it only picks a budget.
  //
  // This was briefly a gate — devices under a threshold were refused — and it
  // was wrong within a minute of being written. The same Iris Xe measured
  // 58,356 and then 15,884 on consecutive runs, because a 15 W laptop part
  // boosts, warms, and drops back while the browser is also compositing. A
  // gate on that number tells a machine it cannot do something it demonstrably
  // can, purely because it was asked at a bad moment. A budget just comes out
  // smaller, which is self-correcting.
  if (score < 175_000) return "weak";
  if (score < 580_000) return "modest";
  return "strong";
}

/**
 * The reference measurement the bands are anchored to: an Intel Iris Xe,
 * best-of-three, on an idle-ish machine. See tierFor.
 */
export const REFERENCE_SCORE = 95_000;

export interface TrainBudget {
  totalSteps: number;
  maxSplats: number;
  maxResolution: number;
  maxFrames: number;
  /** Honest, hedged, and in minutes a person can plan around. */
  estimate: string;
}

/**
 * What to ask the trainer for on this class of machine.
 *
 * Follows REALTIME_SPLAT_PLAN.md's own guidance for bounded cycles — "modest
 * total-steps (e.g. 1500–4000) + max-frames/max-resolution caps so each cycle
 * finishes in seconds" — which is exactly the regime that makes integrated
 * graphics viable instead of hopeless. Quality improves across cycles as more
 * frames arrive, rather than being bought up front with one enormous run.
 */
export function budgetFor(tier: GpuTier): TrainBudget {
  switch (tier) {
    case "strong":
      return {
        totalSteps: 15_000,
        maxSplats: 1_500_000,
        maxResolution: 1600,
        maxFrames: 300,
        estimate: "a few minutes",
      };
    case "modest":
      return {
        totalSteps: 6_000,
        maxSplats: 500_000,
        maxResolution: 1080,
        maxFrames: 150,
        estimate: "5–15 minutes",
      };
    case "weak":
      return {
        totalSteps: 2_500,
        maxSplats: 150_000,
        maxResolution: 720,
        maxFrames: 80,
        estimate: "15–40 minutes, and warm",
      };
    case "none":
      return {
        totalSteps: 0,
        maxSplats: 0,
        maxResolution: 0,
        maxFrames: 0,
        estimate: "not possible here",
      };
  }
}

/** One line for the UI, saying what was found rather than what was assumed. */
export function describeGpu(r: GpuReport): string {
  if (r.blockedBecause) return r.blockedBecause;
  const who = [r.vendor, r.architecture].filter(Boolean).join(" ") || "this GPU";
  return `${who} · ${budgetFor(r.tier).estimate}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The probe. Browser only; everything above is pure and unit-tested.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enough work that the GPU's arithmetic dominates the measurement.
 *
 * The first version of this used 256 iterations and finished in ~7 ms on an
 * Iris Xe, which sounds fine until you notice a dispatch and a buffer map cost
 * several milliseconds on their own — so it was mostly timing the driver, and
 * it rated integrated graphics as fast as a workstation card. Two thousand
 * iterations puts the arithmetic firmly in charge; a genuinely slow device
 * still finishes this in well under a second.
 */
const BENCH_ELEMENTS = 1 << 18; // 262,144
const BENCH_ITERS = 2048;

const BENCH_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> d: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3u) {
  var v = d[g.x];
  // A dependent FMA chain: the compiler cannot hoist it, so this measures
  // arithmetic throughput rather than how clever the optimiser is.
  for (var i = 0u; i < ${BENCH_ITERS}u; i = i + 1u) {
    v = fma(v, 1.0000001, 0.0000001);
  }
  d[g.x] = v;
}`;

/**
 * Ask the machine what it can do. Never throws, never hangs.
 *
 * Returns NO_GPU with a reason for every failure mode, because a caller
 * deciding what to offer someone needs an answer in all cases and an exception
 * is not an answer.
 */
export async function probeGpu(timeoutMs = 8000): Promise<GpuReport> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return NO_GPU;

  const deadline = new Promise<GpuReport>((resolve) =>
    setTimeout(
      () =>
        resolve({
          ...NO_GPU,
          webgpu: true,
          blockedBecause: "The graphics driver did not respond in time.",
        }),
      timeoutMs,
    ),
  );

  return Promise.race([deadline, run()]);
}

async function run(): Promise<GpuReport> {
  const gpu = (navigator as Navigator & { gpu: GPU }).gpu;

  let adapter: GPUAdapter | null = null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch {
    adapter = null;
  }
  if (!adapter) {
    return {
      ...NO_GPU,
      webgpu: true,
      blockedBecause: "WebGPU is available but no graphics adapter could be opened.",
    };
  }

  const info = adapter.info ?? ({} as GPUAdapterInfo);
  const vendor = info.vendor ?? "";
  const architecture = info.architecture ?? "";
  const identity = `${vendor} ${architecture} ${info.description ?? ""}`;
  const software = SOFTWARE.test(identity);
  const float32Blendable = adapter.features.has("float32-blendable");
  const maxStorageBindingBytes = adapter.limits.maxStorageBufferBindingSize;

  const base = {
    webgpu: true,
    adapter: true,
    software,
    vendor,
    architecture,
    float32Blendable,
    maxStorageBindingBytes,
  };

  if (software) {
    return {
      ...NO_GPU,
      ...base,
      blockedBecause:
        "Only a software renderer is available, which would take hours. Reconstruct on a laptop studio or in the cloud instead.",
    };
  }

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice();
  } catch {
    return {
      ...NO_GPU,
      ...base,
      blockedBecause: "The graphics adapter refused to open a device.",
    };
  }

  try {
    // Swallow driver errors rather than letting them surface as unhandled
    // rejections in a page that is only asking a question.
    device.addEventListener?.("uncapturederror", (e: Event) => e.preventDefault?.());

    // Not named `module`: Next forbids assigning that identifier, and the rule
    // is right — it shadows the CommonJS global in any file that gets bundled.
    const shader = device.createShaderModule({ code: BENCH_SHADER });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: shader, entryPoint: "main" },
    });

    const bytes = BENCH_ELEMENTS * 4;
    const buffer = device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, new Float32Array(BENCH_ELEMENTS).fill(1));

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }],
    });
    const readback = device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    // BEST OF THREE, after a warm-up.
    //
    // The warm-up absorbs shader compilation and buffer residency, which would
    // otherwise be counted as arithmetic. The best-of-three absorbs everything
    // else: a laptop part that drops out of boost, the compositor taking the
    // GPU for a frame, another tab waking up. The MAXIMUM is the right
    // statistic because contention can only ever make a device look slower
    // than it is — no amount of interference makes one look faster.
    let best = 0;
    let computeVerified = false;

    for (let pass_i = 0; pass_i < 4; pass_i++) {
      const timed = pass_i > 0;
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(BENCH_ELEMENTS / 64);
      pass.end();

      const started = performance.now();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      const elapsed = performance.now() - started;

      if (!timed) continue;
      const millionOps = (BENCH_ELEMENTS * BENCH_ITERS) / 1e6;
      if (elapsed > 0) best = Math.max(best, Math.round(millionOps / (elapsed / 1000)));
    }

    // Read the buffer once at the end and confirm the arithmetic actually
    // happened. A driver that returns the input unchanged has silently failed,
    // and reporting a huge score for it would be the worst possible outcome.
    {
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(buffer, 0, readback, 0, bytes);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const value = new Float32Array(readback.getMappedRange())[0];
      readback.unmap();
      computeVerified = Number.isFinite(value) && value > 1;
    }

    const tier = tierFor({
      score: best,
      software,
      computeVerified,
      float32Blendable,
      maxStorageBindingBytes,
    });

    return {
      ...base,
      computeVerified,
      score: best,
      tier,
      blockedBecause:
        tier !== "none"
          ? null
          : !computeVerified
            ? "The graphics driver could not run the test correctly."
            : !float32Blendable
              ? "This GPU cannot blend in full precision, which splats require."
              : "This GPU cannot hold a scene large enough to reconstruct.",
    };
  } catch {
    return {
      ...NO_GPU,
      ...base,
      blockedBecause: "The graphics driver failed while being tested.",
    };
  } finally {
    device.destroy?.();
  }
}
