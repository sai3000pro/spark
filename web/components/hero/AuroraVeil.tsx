"use client";

/**
 * The aurora, computed — not a photograph of one.
 *
 * A fullscreen fragment shader (three via R3F) folds two octave stacks of
 * value noise into hanging curtains: one field sways the curtain domain
 * horizontally, the other lifts and drops the luminance along it, and fine
 * striations run down the folds the way real aurora rays do. Colors are the
 * journal's own pressed pigments — lagoon into mist, with a brass breath at
 * the crown — and the canvas composites over the pine sky with
 * `mix-blend-mode: screen`, so the black background is neutral and the light
 * is additive, which is how light works.
 *
 * Economy: antialias off, dpr capped, `low-power`, and the frameloop drops to
 * a single demanded frame when the hero scrolls away or the visitor prefers
 * reduced motion — the curtains simply hang still.
 */
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type * as THREE from "three";

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(11.7, 5.3);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv;

    // The curtain domain sways slowly, like wind through a hanging sheet.
    float sway = fbm(vec2(uv.x * 1.7 + uTime * 0.028, uTime * 0.016)) - 0.5;
    // Curtains bow with height — the top of a ray leans further than its hem.
    float x = uv.x * 3.1 + sway * 1.3 + (uv.y - 0.4) * (fbm(vec2(uv.x * 1.1, uTime * 0.01)) - 0.5) * 0.9;

    // The sheet: strongly anisotropic — the field barely varies vertically,
    // so the luminance draws as tall hanging streaks, not clouds.
    float sheet = fbm(vec2(x * 1.7, uv.y * 0.18 - uTime * 0.045));
    sheet = smoothstep(0.32, 0.84, sheet);

    // Fine rays running down the folds.
    float rays = 0.52 + 0.48 * sin(x * 17.0 + fbm(vec2(x * 0.8, uTime * 0.055)) * 7.0);

    // Curtains hang from the top; the hem near the middle sky glows
    // brightest and the light thins as it climbs — like the real thing.
    float hem = smoothstep(0.12, 0.38, uv.y);
    float climb = 1.0 - smoothstep(0.38, 1.0, uv.y) * 0.72;
    float band = hem * climb;

    float a = sheet * rays * band;

    vec3 lagoon = vec3(0.278, 0.427, 0.451);
    vec3 mist   = vec3(0.663, 0.741, 0.725);
    vec3 brass  = vec3(0.835, 0.706, 0.451);

    // Cap the mist mix so the curtains stay teal light, never white smoke.
    vec3 col = mix(lagoon * 1.15, mist, smoothstep(0.25, 1.0, sheet) * 0.62);
    // The hem warms faintly toward brass, the journal's accent.
    col = mix(col, brass, 0.16 * smoothstep(0.38, 0.16, uv.y));

    // Screen-blended over the page: black is neutral, light adds.
    gl_FragColor = vec4(col * a * 1.15, 1.0);
  }
`;

function Veil({ animate }: { animate: boolean }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  // A fixed seed-time so the static frame (reduced motion, first paint) is a
  // composed set of curtains rather than the noise field's flat origin.
  const uniforms = useMemo(() => ({ uTime: { value: 26.0 } }), []);
  useFrame((_, delta) => {
    if (animate && mat.current) mat.current.uniforms.uTime.value += delta;
  });
  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={VERT}
        fragmentShader={FRAG}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

const subscribeMotion = (cb: () => void) => {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export function AuroraVeil({ className = "" }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  // Server snapshot says "still", so the first client frame is the calm one.
  const prefersStill = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
  const animate = !prefersStill;
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    if (host.current) io.observe(host.current);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={host} aria-hidden className={className} style={{ mixBlendMode: "screen" }}>
      <Canvas
        dpr={[1, 1.6]}
        gl={{ antialias: false, alpha: false, powerPreference: "low-power" }}
        frameloop={animate && visible ? "always" : "demand"}
        style={{ width: "100%", height: "100%" }}
      >
        <Veil animate={animate && visible} />
      </Canvas>
    </div>
  );
}
