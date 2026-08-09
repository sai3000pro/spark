"use client";

/**
 * The real capture, rendered by @mkkellogg/gaussian-splats-3d 0.4.7.
 *
 * A standalone viewer with its own canvas, its own camera and its own three.js
 * (0.160.1, from a CDN — see lib/splat/gs3d.ts for why that is a second,
 * isolated instance and what it means). React owns the host div and the label
 * overlay; the library owns everything inside the host.
 *
 * It has to be self-contained, because the R3F path next door can't be reused:
 * mixing objects across two three.js instances fails in ways that look
 * intermittent. So the pieces the synthetic preview gets from drei — clickable
 * anchors, hover labels, the camera flight that lands you in front of a found
 * object — are rebuilt here against the CDN instance. They read identically
 * because they come from the same anchor data (lib/splat/syntheticCloud.ts) and
 * the same lerp.
 */
import { useEffect, useRef, useState } from "react";
import { loadGS3D, type GS3DViewer, type ThreeModule } from "@/lib/splat/gs3d";
import { colorForLabel } from "@/lib/mock/labels";
import { CANVAS_BG } from "@/lib/theme";
import type { CloudResult } from "@/lib/splat/syntheticCloud";
import type { SplatView } from "@/lib/types";

type Anchor = CloudResult["anchors"][number];

interface Props {
  url: string;
  /** Framing for this capture. Absent = the defaults below, which suit a room. */
  view?: SplatView;
  /** Same anchors the synthetic preview uses, so both modes agree on where things are. */
  anchors: Anchor[];
  focusTrackId: string | null;
  onSelectObject: (trackId: string | null) => void;
  /** Download percentage, for the stage's own chip. The library's UI is switched off. */
  onProgress: (percent: number) => void;
  /** The scene is built and drawing. Download hitting 100% is NOT this. */
  onReady: () => void;
  /** Anything went wrong — the caller falls back to the synthetic cloud. */
  onFail: () => void;
}

/** Anchor hit radius. Bigger than the drawn sphere; these are small targets. */
const PICK_RADIUS = 0.26;
/** Matches the R3F CameraRig exactly, so the two modes fly the same way. */
const LERP = 0.075;
const STAND_BACK_M = 2.4;
const STAND_UP_M = 1.05;

export function GS3DStage({
  url,
  view,
  anchors,
  focusTrackId,
  onSelectObject,
  onProgress,
  onReady,
  onFail,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  // Read by the animation loop and the pointer handlers without re-running the
  // effect that owns the viewer — re-creating a 1.8M-splat scene because a
  // label changed would be a catastrophe of a re-render.
  const focusRef = useRef(focusTrackId);
  const hoverRef = useRef<string | null>(null);
  const selectRef = useRef(onSelectObject);
  useEffect(() => {
    focusRef.current = focusTrackId;
    hoverRef.current = hovered;
    selectRef.current = onSelectObject;
  });

  const active = focusTrackId ?? hovered;
  const activeAnchor = anchors.find((a) => a.trackId === active) ?? null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let viewer: GS3DViewer | null = null;
    let raf = 0;
    let detach: (() => void) | null = null;

    (async () => {
      try {
        const { Viewer, THREE } = await loadGS3D();
        if (cancelled) return;

        // ── Anchors, built with the CDN three ──────────────────────────────
        const anchorScene = new THREE.Scene();
        const meshes = new Map<string, InstanceType<ThreeModule["Mesh"]>>();
        const geometry = new THREE.SphereGeometry(0.14, 16, 16);
        const ring = new THREE.RingGeometry(0.4, 0.48, 32);
        const materials: InstanceType<ThreeModule["MeshBasicMaterial"]>[] = [];

        for (const a of anchors) {
          const material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(colorForLabel(a.label)),
            transparent: true,
            opacity: 0.8,
          });
          materials.push(material);
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(a.pos[0], a.pos[1], a.pos[2]);
          mesh.userData.trackId = a.trackId;
          anchorScene.add(mesh);
          meshes.set(a.trackId, mesh);

          const halo = new THREE.Mesh(
            ring,
            new THREE.MeshBasicMaterial({
              color: new THREE.Color(colorForLabel(a.label)),
              transparent: true,
              opacity: 0.85,
              side: THREE.DoubleSide,
            }),
          );
          halo.rotation.set(-Math.PI / 2, 0, 0);
          halo.visible = false;
          mesh.add(halo);
          mesh.userData.halo = halo;
        }

        // ── The viewer ─────────────────────────────────────────────────────
        viewer = new Viewer({
          rootElement: host,
          threeScene: anchorScene,
          selfDrivenMode: true,
          useBuiltInControls: true,
          // Defaults to true in 0.4.7 and that path needs COOP/COEP cross-origin
          // isolation, which this app does not set. Leaving it on throws here.
          sharedMemoryForWorkers: false,
          // MUST stay off. With it on, the sort worker returns splatRenderCount
          // 0 for every frame — updateRenderIndexes sets instanceCount to 0 and
          // the scene renders as a flawless black rectangle with no error
          // anywhere. The library defaults this to false; opting in is a trap.
          gpuAcceleratedSort: false,
          dynamicScene: false,
          // The library's own spinner is a hard tonal clash with the journal;
          // the stage draws its own chip off onProgress instead.
          showLoadingUI: false,
          cameraUp: view?.cameraUp ?? [0, 1, 0],
          initialCameraPosition: view?.cameraPosition ?? [0, 1.6, 5],
          initialCameraLookAt: view?.cameraLookAt ?? [0, 1, 0],
        });
        if (cancelled) {
          await viewer.dispose().catch(() => {});
          viewer = null;
          return;
        }

        // BEFORE addSplatScene, not after. `selfDrivenMode` only arms the render
        // loop; start() runs it. The library's own examples start it after the
        // load resolves, but a large capture spends minutes building its buffer
        // after the download hits 100% — and nothing draws until the loop turns
        // over, so `progressiveLoad` shows you nothing. Started here, the splats
        // appear as they stream.
        viewer.start();

        // The pine plate the journal's one dark surface sits on, not the
        // library's default void.
        viewer.renderer.setClearColor(new THREE.Color(CANVAS_BG), 1);

        const scale = view?.sceneScale ?? 1;
        const [rx, ry, rz] = view?.sceneRotationDeg ?? [0, 0, 0];
        const quat = new THREE.Quaternion().setFromEuler(
          new THREE.Euler((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180),
        );

        await viewer.addSplatScene(url, {
          progressiveLoad: true,
          splatAlphaRemovalThreshold: view?.alphaRemovalThreshold ?? 5,
          position: view?.scenePosition ?? [0, 0, 0],
          rotation: [quat.x, quat.y, quat.z, quat.w],
          scale: [scale, scale, scale],
          showLoadingUI: false,
          onProgress: (percent) => {
            if (!cancelled) onProgress(percent);
          },
        });
        if (cancelled) return;
        onReady();

        // ── Picking ────────────────────────────────────────────────────────
        const raycaster = new THREE.Raycaster();
        raycaster.params.Points = { threshold: PICK_RADIUS };
        const ndc = new THREE.Vector2();
        const pickables = [...meshes.values()];

        const pick = (e: PointerEvent | MouseEvent): string | null => {
          const rect = host.getBoundingClientRect();
          ndc.set(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1,
          );
          raycaster.setFromCamera(ndc, viewer!.camera);
          const hit = raycaster.intersectObjects(pickables, false)[0];
          return (hit?.object.userData.trackId as string | undefined) ?? null;
        };

        const onMove = (e: PointerEvent) => {
          const id = pick(e);
          if (id !== hoverRef.current) setHovered(id);
          host.style.cursor = id ? "pointer" : "";
        };
        const onClick = (e: MouseEvent) => {
          const id = pick(e);
          if (id) selectRef.current(id === focusRef.current ? null : id);
        };
        const onLeave = () => setHovered(null);

        host.addEventListener("pointermove", onMove);
        host.addEventListener("click", onClick);
        host.addEventListener("pointerleave", onLeave);
        detach = () => {
          host.removeEventListener("pointermove", onMove);
          host.removeEventListener("click", onClick);
          host.removeEventListener("pointerleave", onLeave);
          host.style.cursor = "";
          geometry.dispose();
          ring.dispose();
          for (const m of materials) m.dispose();
        };

        // ── The loop: anchor states, the label, and the camera flight ──────
        const world = new THREE.Vector3();
        const goalTarget = new THREE.Vector3();
        const goalPos = new THREE.Vector3();
        let flyingTo: string | null = null;
        let flying = false;

        const tick = () => {
          raf = requestAnimationFrame(tick);
          const v = viewer;
          if (!v) return;

          const focus = focusRef.current;
          const hot = focus ?? hoverRef.current;

          for (const [trackId, mesh] of meshes) {
            const on = trackId === hot;
            mesh.scale.setScalar(on ? 1.36 : 1);
            (mesh.material as InstanceType<ThreeModule["MeshBasicMaterial"]>).opacity = on ? 1 : 0.8;
            (mesh.userData.halo as InstanceType<ThreeModule["Mesh"]>).visible = trackId === focus;
          }

          // Start a flight when the focus changes; stop when we arrive, so the
          // user's own orbiting isn't fought over afterwards.
          if (focus !== flyingTo) {
            flyingTo = focus;
            flying = false;
            const a = focus ? anchors.find((x) => x.trackId === focus) : null;
            if (a) {
              goalTarget.set(a.pos[0], a.pos[1], a.pos[2]);
              const outward = new THREE.Vector3(goalTarget.x, 0, goalTarget.z);
              if (outward.lengthSq() < 0.01) outward.set(0, 0, 1);
              outward.normalize().multiplyScalar(STAND_BACK_M);
              goalPos.copy(goalTarget).add(outward).add(new THREE.Vector3(0, STAND_UP_M, 0));
              flying = true;
            }
          }
          if (flying) {
            v.controls.target.lerp(goalTarget, LERP);
            v.camera.position.lerp(goalPos, LERP);
            v.controls.update();
            if (v.camera.position.distanceTo(goalPos) < 0.03) flying = false;
          }

          // The label rides the active anchor. Projected here rather than
          // rendered per frame in React — this runs at 60fps.
          const el = labelRef.current;
          if (el) {
            const a = hot ? anchors.find((x) => x.trackId === hot) : null;
            if (!a) {
              el.style.opacity = "0";
            } else {
              world.set(a.pos[0], a.pos[1], a.pos[2]).project(v.camera);
              const behind = world.z > 1;
              el.style.opacity = behind ? "0" : "1";
              el.style.transform = `translate(-50%, -160%) translate(${
                (world.x * 0.5 + 0.5) * host.clientWidth
              }px, ${(-world.y * 0.5 + 0.5) * host.clientHeight}px)`;
            }
          }
        };
        raf = requestAnimationFrame(tick);
      } catch (err) {
        console.warn("[splat] gaussian-splats-3d failed to load, falling back:", err);
        if (!cancelled) onFail();
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      detach?.();
      // Async, and it takes the sort worker and the splat buffer with it. Without
      // this a 1.8M-gaussian capture survives every ←/→ step between moments.
      viewer?.dispose().catch(() => {});
      viewer = null;
    };
    // `anchors` is derived from `moment` upstream and changes with the url; the
    // handler props are read through refs so they never re-mount the viewer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, view, anchors]);

  return (
    <div className="absolute inset-0">
      <div ref={hostRef} className="absolute inset-0" />

      {/* The label overlay — same vellum slip the synthetic preview pins up,
          positioned imperatively by the loop above. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          ref={labelRef}
          className="absolute left-0 top-0 whitespace-nowrap rounded-[6px] bg-vellum/95 px-2 py-1 opacity-0"
          style={{ boxShadow: "var(--ring-ink), 0 4px 12px rgb(6 10 11 / 0.4)", transition: "opacity 0.12s linear" }}
        >
          <span className="text-[11px] font-bold text-ink">{activeAnchor?.label ?? ""}</span>
          <span className="fnote tnum ml-1.5 text-[9px] text-ink-faint">
            {activeAnchor ? `${Math.round(activeAnchor.confidence * 100)}%` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
