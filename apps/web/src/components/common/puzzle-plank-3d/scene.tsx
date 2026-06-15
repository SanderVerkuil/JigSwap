import type { PuzzlePlankBox } from "@/components/common/puzzle-plank";
import {
  BOX_DEPTH,
  boxWorldSize,
  PuzzleBox,
} from "@/components/marketing/plank-3d/box";
import {
  LIGHTING,
  type LightingPreset,
} from "@/components/marketing/plank-3d/palette";
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
import { layoutRow } from "./layout";

// ——— shelf constants ———
const SHELF_THICKNESS = 0.14;
const SHELF_DEPTH = 0.6;

// ——— camera constants ———
const FOV = 38;
// Headroom added above the tallest box when computing the framed height.
const CONTENT_HEADROOM = 0.4;
// Minimum visible world width so a 1-2 box row isn't hugely zoomed.
const MIN_VIS_W = 2.0;
// Camera sits slightly above the look-at point for a gentle downward gaze.
const CAMERA_Y_LIFT = 0.3;
// Fixed yaw so boxes read as 3D (no parallax-driven component here).
const FIXED_YAW = -(12 * Math.PI) / 180;

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

  useFrame((_, delta) => {
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
    easing.damp(key.current, "intensity", preset.keyIntensity, 0.3, delta);
    easing.dampC(key.current.color, preset.keyColor, 0.3, delta);
    easing.damp(
      ambient.current,
      "intensity",
      preset.ambientIntensity,
      0.3,
      delta,
    );
    easing.dampC(ambient.current.color, preset.ambientColor, 0.3, delta);
    easing.damp(hemi.current, "intensity", preset.hemiIntensity, 0.3, delta);
    easing.damp(rim.current, "intensity", preset.rimIntensity, 0.3, delta);
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
        color="#8b5cf6"
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
    easing.dampE(
      group.current.rotation,
      target as [number, number, number],
      0.4,
      delta,
    );
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
  reducedMotion,
  onFirstFrame,
}: {
  boxes: PuzzlePlankBox[];
  resolved: Array<{ c1: string; c2: string }>;
  headingFont: string;
  lightingPreset: LightingPreset;
  reducedMotion: boolean;
  onFirstFrame: () => void;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  const { slots, rowWidth } = React.useMemo(() => layoutRow(boxes), [boxes]);

  // Max box world height across the row — drives framing.
  const maxBoxH = React.useMemo(
    () => Math.max(...boxes.map(boxWorldHeight), 0.5),
    [boxes],
  );

  // ——— cover-fit camera: frame the row with headroom ———
  const vFov = (FOV * Math.PI) / 180;
  const aspect = size.width / size.height;
  // Framed height = tallest box + headroom; clamped so narrow viewports
  // don't zoom in beyond MIN_VIS_W world units.
  const framedH = maxBoxH + CONTENT_HEADROOM;
  const contentH = Math.max(framedH, MIN_VIS_W / aspect);
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
  const shelfW = rowWidth + 0.4;

  return (
    <>
      <FirstFrame onFirstFrame={onFirstFrame} />
      <Parallax enabled={!reducedMotion}>
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
              color={lightingPreset.shelfColor}
              roughness={0.7}
            />
          </mesh>

          {boxes.map((box, i) => (
            <PuzzleBox
              key={i}
              box={box}
              slot={{
                x: slots[i]?.x ?? 0,
                c1: resolved[i]?.c1 ?? "#6048e8",
                c2: resolved[i]?.c2 ?? "#494e92",
              }}
              index={i}
              headingFont={headingFont}
              sizeScale={1}
            />
          ))}

          <ContactShadows
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
}

export default function PlankScene(props: PlankSceneProps) {
  const lightingPreset = LIGHTING[props.theme];
  return (
    <Canvas
      dpr={[1, 2]}
      frameloop={props.visible ? "always" : "never"}
      gl={{ alpha: true, antialias: true }}
      style={{ pointerEvents: "none", background: "transparent" }}
      camera={{ fov: FOV }}
      eventSource={props.eventSource as unknown as React.RefObject<HTMLElement>}
      events={transformSafeEvents}
      resize={{ offsetSize: true }}
    >
      <Lights preset={lightingPreset} reducedMotion={props.reducedMotion} />
      <Arrangement
        boxes={props.boxes}
        resolved={props.resolved}
        headingFont={props.headingFont}
        lightingPreset={lightingPreset}
        reducedMotion={props.reducedMotion}
        onFirstFrame={props.onFirstFrame}
      />
    </Canvas>
  );
}
