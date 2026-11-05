import type { PuzzlePlankBox } from "@/components/common/puzzle-plank";
import {
  BOX_DEPTH,
  boxWorldSize,
  PuzzleBox,
} from "@/components/marketing/plank-3d/box";
import {
  DemandFrames,
  frameDelta,
} from "@/components/marketing/plank-3d/demand";
import {
  LIGHTING,
  type LightingPreset,
} from "@/components/marketing/plank-3d/palette";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import { ContactShadows } from "@react-three/drei";
import type {
  DomEvent,
  EventManager,
  RootState,
  RootStore,
} from "@react-three/fiber";
import { Canvas, events, useFrame, useThree } from "@react-three/fiber";
import { easing } from "maath";
import * as React from "react";
import * as THREE from "three";
import { framedContentHeight, layoutRow } from "./layout";
import { DEFAULT_WOOD_PARAMS, useWoodTexture } from "./wood-texture";

// ——— shelf constants ———
const SHELF_THICKNESS = 0.14;
const SHELF_DEPTH = 0.6;

// ——— camera constants ———
const FOV = 38;
// Camera sits slightly above the look-at point for a gentle downward gaze.
const CAMERA_Y_LIFT = 0.3;
// In-app planks render FACE-ON (no yaw) — the angled, depth-y look is reserved
// for the marketing hero background. Box depth + lighting still read as 3D.
const FIXED_YAW = 0;

// ——— world height of one box (delegates to the shared helper) ———
function boxWorldHeight(box: PuzzlePlankBox): number {
  return boxWorldSize(box).h;
}

/** Damps all light parameters toward the active theme preset. */
function Lights({
  preset,
  reducedMotion,
}: {
  preset: LightingPreset;
  reducedMotion: boolean;
}) {
  const key = React.useRef<THREE.DirectionalLight>(null);
  const ambient = React.useRef<THREE.AmbientLight>(null);
  const hemi = React.useRef<THREE.HemisphereLight>(null);
  const rim = React.useRef<THREE.DirectionalLight>(null);

  useFrame((state, rawDelta) => {
    if (!key.current || !ambient.current || !hemi.current || !rim.current)
      return;
    if (reducedMotion) {
      key.current.intensity = preset.keyIntensity;
      key.current.color.set(preset.keyColor);
      ambient.current.intensity = preset.ambientIntensity;
      ambient.current.color.set(preset.ambientColor);
      hemi.current.intensity = preset.hemiIntensity;
      rim.current.intensity = preset.rimIntensity;
      return;
    }
    const delta = frameDelta(rawDelta);
    // Demand frameloop: keep asking for frames until every light has settled.
    const moving = [
      easing.damp(key.current, "intensity", preset.keyIntensity, 0.3, delta),
      easing.dampC(key.current.color, preset.keyColor, 0.3, delta),
      easing.damp(
        ambient.current,
        "intensity",
        preset.ambientIntensity,
        0.3,
        delta,
      ),
      easing.dampC(ambient.current.color, preset.ambientColor, 0.3, delta),
      easing.damp(hemi.current, "intensity", preset.hemiIntensity, 0.3, delta),
      easing.damp(rim.current, "intensity", preset.rimIntensity, 0.3, delta),
    ].includes(true);
    if (moving) state.invalidate();
  });

  return (
    <>
      <directionalLight
        ref={key}
        position={[2.5, 5, 3.5]}
        intensity={preset.keyIntensity}
      />
      <ambientLight ref={ambient} intensity={preset.ambientIntensity} />
      <hemisphereLight
        ref={hemi}
        color="#ffffff"
        groundColor="#d9c4a8"
        intensity={preset.hemiIntensity}
      />
      <directionalLight
        ref={rim}
        position={[-3, 3.5, -2]}
        color="#b4dcf8"
        intensity={preset.rimIntensity}
      />
    </>
  );
}

function FirstFrame({ onFirstFrame }: { onFirstFrame: () => void }) {
  const fired = React.useRef(false);
  useFrame(() => {
    if (!fired.current) {
      fired.current = true;
      onFirstFrame();
    }
  });
  return null;
}

function Parallax({
  children,
  enabled,
}: {
  children: React.ReactNode;
  enabled: boolean;
}) {
  const group = React.useRef<THREE.Group>(null);
  const AMPLITUDE = 1.0;
  useFrame((state, delta) => {
    if (!group.current) return;
    const target = enabled
      ? [
          state.pointer.y * 0.03 * AMPLITUDE,
          state.pointer.x * 0.05 * AMPLITUDE,
          0,
        ]
      : [0, 0, 0];
    const moving = easing.dampE(
      group.current.rotation,
      target as [number, number, number],
      0.4,
      frameDelta(delta),
    );
    if (moving) state.invalidate();
  });
  return <group ref={group}>{children}</group>;
}

// Pointer NDC from the canvas's live client rect so picking survives
// CSS scale transforms.
function transformSafeEvents(store: RootStore): EventManager<HTMLElement> {
  return {
    ...events(store),
    compute(event: DomEvent, state: RootState) {
      const rect = state.gl.domElement.getBoundingClientRect();
      state.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      state.raycaster.setFromCamera(state.pointer, state.camera);
    },
  };
}

// Inner component: reads live canvas size, computes camera distance to
// cover-fit the row, and renders the single shelf + boxes.
function Arrangement({
  boxes,
  resolved,
  headingFont,
  lightingPreset,
  parallax,
  onFirstFrame,
  wideShelf,
}: {
  boxes: PuzzlePlankBox[];
  resolved: Array<{ c1: string; c2: string }>;
  headingFont: string;
  lightingPreset: LightingPreset;
  parallax: boolean;
  onFirstFrame: () => void;
  wideShelf: boolean;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  // Wood-grain texture for the shelf board, tinted from the theme shelf colour.
  const woodTexture = useWoodTexture(lightingPreset.shelfColor);

  const { slots, rowWidth } = React.useMemo(() => layoutRow(boxes), [boxes]);

  // Live per-box world heights: cover boxes aspect-correct after their image
  // loads (a portrait cover can resolve much taller than the 1.4 default), so
  // each box reports its rendered height and the camera framing follows it.
  // Without this the camera frames the default height and tall covers clip.
  const [boxHeights, setBoxHeights] = React.useState<number[]>([]);
  const reportHeight = React.useCallback((i: number, h: number) => {
    setBoxHeights((prev) => {
      if (prev[i] === h) return prev;
      const next = prev.slice();
      next[i] = h;
      return next;
    });
  }, []);

  // Max box world height across the row — drives framing.
  const maxBoxH = React.useMemo(
    () =>
      Math.max(...boxes.map((b, i) => boxHeights[i] ?? boxWorldHeight(b)), 0.5),
    [boxes, boxHeights],
  );

  // ——— cover-fit camera: frame the whole row with headroom ———
  const vFov = (FOV * Math.PI) / 180;
  const aspect = size.width / size.height;
  // Fits both axes: the tallest box + headroom and the row's full width, so a
  // near-square phone or tablet canvas never cuts the outer covers.
  const contentH = framedContentHeight({ maxBoxH, rowWidth, aspect });
  const dist = contentH / 2 / Math.tan(vFov / 2);

  // Camera y: look at the vertical center of the row (half maxBoxH above shelf),
  // with a small lift for the downward gaze.
  const lookAtY = maxBoxH / 2;
  const cameraY = lookAtY + CAMERA_Y_LIFT;

  React.useLayoutEffect(() => {
    camera.position.set(0, cameraY, dist);
    camera.lookAt(0, lookAtY, 0);
    camera.updateProjectionMatrix();
  }, [camera, size, dist, cameraY, lookAtY]);

  // Shelf board width: row + margin so no bare board-ends are visible close up.
  // wideShelf runs it across ~95% of the frame instead, like scene-physics.tsx
  // (face-on, so the visible width at the shelf plane is contentH * aspect).
  const shelfW = wideShelf
    ? Math.max(contentH * aspect * 0.95, rowWidth + 0.4)
    : rowWidth + 0.4;

  return (
    <>
      <FirstFrame onFirstFrame={onFirstFrame} />
      <Parallax enabled={parallax}>
        {/* Fixed yaw so boxes read as 3D without pointer-driven rotation */}
        <group rotation={[0, FIXED_YAW, 0]}>
          {/* Shelf board sits just below y=0 (box bases are at y=0) */}
          <mesh
            position={[
              0,
              -SHELF_THICKNESS / 2,
              SHELF_DEPTH / 2 - BOX_DEPTH / 2 - 0.1,
            ]}
          >
            <boxGeometry args={[shelfW, SHELF_THICKNESS, SHELF_DEPTH]} />
            <meshStandardMaterial
              map={woodTexture}
              roughness={DEFAULT_WOOD_PARAMS.roughness}
            />
          </mesh>

          {boxes.map((box, i) => (
            <PuzzleBox
              key={i}
              box={box}
              slot={{
                x: slots[i]?.x ?? 0,
                c1: resolved[i]?.c1 ?? "#146350",
                c2: resolved[i]?.c2 ?? "#0f3b30",
              }}
              index={i}
              headingFont={headingFont}
              sizeScale={1}
              onResolvedHeight={(h) => reportHeight(i, h)}
            />
          ))}

          {/* The boxes stand still, so the shadow is baked once instead of a
              depth render plus blur passes every frame. drei restarts its
              frame count on every re-render, so a box resolving its cover
              height or a theme change re-bakes it; parallax rotates the
              shadow camera together with the boxes. */}
          <ContactShadows
            frames={1}
            position={[0, 0.001, 0]}
            opacity={lightingPreset.shadowOpacity}
            scale={rowWidth + 1}
            blur={2.2}
            far={1.2}
            resolution={256}
          />
        </group>
      </Parallax>
    </>
  );
}

export interface PlankSceneProps {
  boxes: PuzzlePlankBox[];
  /** Pre-resolved per-box colors, parallel to boxes. */
  resolved: Array<{ c1: string; c2: string }>;
  headingFont: string;
  theme: "light" | "dark";
  reducedMotion: boolean;
  visible: boolean;
  onFirstFrame: () => void;
  eventSource: React.RefObject<HTMLDivElement | null>;
  /** Bumped to snap the physics boxes back to their resting layout (ignored by
   *  the static scene). */
  resetNonce?: number;
  /** Static scene: run the board across the frame like the physics scene, so
   *  an interactive shelf keeps its look when physics takes over. */
  wideShelf?: boolean;
}

export default function PlankScene(props: PlankSceneProps) {
  const lightingPreset = LIGHTING[props.theme];
  const coarse = useCoarsePointer();
  // Parallax follows a hovering pointer; a finger never hovers, so on touch
  // screens it would only sway the row now and then after a tap.
  const parallax = !props.reducedMotion && !coarse;
  return (
    <Canvas
      dpr={[1, coarse ? 1.5 : 2]}
      frameloop={props.visible ? "demand" : "never"}
      gl={{ alpha: true, antialias: true }}
      style={{ pointerEvents: "none", background: "transparent" }}
      camera={{ fov: FOV }}
      eventSource={props.eventSource as unknown as React.RefObject<HTMLElement>}
      events={transformSafeEvents}
      resize={{ offsetSize: true }}
    >
      <DemandFrames
        eventSource={props.eventSource}
        pointer={parallax}
        visible={props.visible}
        theme={props.theme}
      />
      <Lights preset={lightingPreset} reducedMotion={props.reducedMotion} />
      <Arrangement
        boxes={props.boxes}
        resolved={props.resolved}
        headingFont={props.headingFont}
        lightingPreset={lightingPreset}
        parallax={parallax}
        onFirstFrame={props.onFirstFrame}
        wideShelf={props.wideShelf ?? false}
      />
    </Canvas>
  );
}
