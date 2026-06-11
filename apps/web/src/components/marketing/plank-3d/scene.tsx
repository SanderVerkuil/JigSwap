import type { PlankBox } from "@/components/marketing/plank";
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
import { BOX_DEPTH, PuzzleBox, PX, type BoxSlot } from "./box";
import { LIGHTING, type LightingPreset } from "./palette";

const SHELF_THICKNESS = 0.14;
const SHELF_DEPTH = 0.7;

// ——— camera constants ———
const FOV = 38;
const CAMERA_X = 0.15;
const CAMERA_Y = 1.5;
const LOOK_AT_Y = 0.62;

// Vertical content range to frame: boxes ~1.44–1.7 tall + shelf + headroom.
// Bumped from 2.1 → 2.4 to give near-right boxes more breathing room.
const CONTENT_H = 2.4;

// ——— yaw / perspective constants ———
// Negative yaw rotates the shelf so its right end swings toward +z (toward the
// camera). Math: (1,0,0) → (cos θ, 0, −sin θ). With θ = −27° that becomes
// (cos −27°, 0, +sin 27°) — right end moves forward. ✓
const SHELF_YAW = -(27 * Math.PI) / 180;

// The yawed shelf covers only cos(27°) ≈ 0.891 of its length on screen, so we
// distribute slots over a wider span; SPAN_PERSPECTIVE_ALLOWANCE adds extra
// room for the near end which projects larger due to perspective.
const SPAN_PERSPECTIVE_ALLOWANCE = 1.2;

// Group offset: pull composition slightly left and back so the near-right box
// doesn't overwhelm the frame after the yaw.
const GROUP_OFFSET_X = -0.3;
const GROUP_OFFSET_Z = -0.2;

// ——— fog constants ———
// FOG_NEAR ≈ camera distance; FOG_FAR adds ~5 units of haze window so the
// far-left end dissolves toward the page background color.
const FOG_NEAR_OFFSET = 0; // added to computed dist
const FOG_FAR_OFFSET = 5; // additional depth beyond near

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
      // snap instead of fading
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
        position={[2.5, 4, 3]}
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
        position={[-3, 2.5, -2]}
        color="#8b5cf6"
        intensity={preset.rimIntensity}
      />
    </>
  );
}

function Shelf({
  worldWidth,
  color,
  reducedMotion,
}: {
  worldWidth: number;
  color: string;
  reducedMotion: boolean;
}) {
  const mat = React.useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, delta) => {
    if (!mat.current) return;
    if (reducedMotion) {
      mat.current.color.set(color);
    } else {
      easing.dampC(mat.current.color, color, 0.3, delta);
    }
  });
  return (
    <mesh
      position={[
        0,
        -SHELF_THICKNESS / 2,
        SHELF_DEPTH / 2 - BOX_DEPTH / 2 - 0.1,
      ]}
    >
      <boxGeometry args={[worldWidth, SHELF_THICKNESS, SHELF_DEPTH]} />
      <meshStandardMaterial ref={mat} color={color} roughness={0.7} />
    </mesh>
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
  const AMPLITUDE = 1.4;
  useFrame((state, delta) => {
    if (!group.current) return;
    const target = enabled
      ? [
          state.pointer.y * 0.04 * AMPLITUDE,
          state.pointer.x * 0.07 * AMPLITUDE,
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

// Pointer NDC from the canvas's live client rect so picking survives the
// CSS scale transforms the hero applies around the canvas.
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

function BoxSpot({
  x,
  preset,
  reducedMotion,
}: {
  x: number;
  preset: LightingPreset;
  reducedMotion: boolean;
}) {
  const light = React.useRef<THREE.SpotLight>(null);
  const target = React.useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(x, 0.7, 0);
    return o;
  }, [x]);
  useFrame((_, delta) => {
    if (!light.current) return;
    if (reducedMotion) {
      light.current.intensity = preset.spotIntensity;
      light.current.color.set(preset.spotColor);
      return;
    }
    easing.damp(light.current, "intensity", preset.spotIntensity, 0.3, delta);
    easing.dampC(light.current.color, preset.spotColor, 0.3, delta);
  });
  return (
    <>
      <primitive object={target} />
      <spotLight
        ref={light}
        position={[x + 0.15, 2.6, 1.1]}
        target={target}
        angle={0.5}
        penumbra={0.85}
        decay={1.2}
        intensity={preset.spotIntensity}
      />
    </>
  );
}

/** Damps the scene fog color toward the active preset's fogColor token. */
function Haze({
  preset,
  reducedMotion,
}: {
  preset: LightingPreset;
  reducedMotion: boolean;
}) {
  const scene = useThree((s) => s.scene);
  useFrame((_, delta) => {
    const fog = scene.fog as THREE.Fog | null;
    if (!fog || !(fog instanceof THREE.Fog)) return;
    if (reducedMotion) {
      fog.color.set(preset.fogColor);
      return;
    }
    easing.dampC(fog.color, preset.fogColor, 0.3, delta);
  });
  return null;
}

// Inner component that reads live canvas size via useThree, computes camera
// distance and visible world width, distributes box slots, and positions the
// camera — all in one place so the math stays consistent.
function Arrangement({
  boxes,
  resolved,
  headingFont,
  lightingPreset,
  reducedMotion,
  onFirstFrame,
}: {
  boxes: PlankBox[];
  resolved: Array<{ c1: string; c2: string }>;
  headingFont: string;
  lightingPreset: LightingPreset;
  reducedMotion: boolean;
  onFirstFrame: () => void;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  // ——— cover-fit by height, with minimum visible width for narrow canvases ———
  const vFov = (FOV * Math.PI) / 180;
  const aspect = size.width / size.height;
  const MIN_VIS_W = 3.2; // never show less than ~3 boxes worth of shelf
  const contentH = Math.max(CONTENT_H, MIN_VIS_W / aspect);
  const dist = contentH / 2 / Math.tan(vFov / 2);

  // ——— visible world width at z = 0 ———
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const visW = 2 * dist * Math.tan(hFov / 2);

  // ——— position camera ———
  React.useLayoutEffect(() => {
    camera.position.set(CAMERA_X, CAMERA_Y, dist);
    camera.lookAt(0, LOOK_AT_Y, 0);
    camera.updateProjectionMatrix();
  }, [camera, size, dist]);

  // ——— fog distance bounds ———
  const fogNear = dist + FOG_NEAR_OFFSET;
  const fogFar = dist + FOG_FAR_OFFSET;

  // ——— box slot distribution across visW + overshoot ———
  // The yawed shelf covers only cos(SHELF_YAW) of its length on screen, so we
  // distribute slots over a wider span; SPAN_PERSPECTIVE_ALLOWANCE adds extra
  // room for the near end which projects larger due to perspective.
  const widths = boxes.map((b) => (b.width ?? 116) * PX);
  const n = boxes.length;
  const totalBoxWidths = widths.reduce((a, b) => a + b, 0);
  const span =
    ((visW + 0.6) / Math.cos(-SHELF_YAW)) * SPAN_PERSPECTIVE_ALLOWANCE;
  const rawGap = n > 1 ? (span - totalBoxWidths) / (n - 1) : 0;
  const gap = Math.max(0.25, Math.min(1.15, rawGap));

  // If clamping made the row narrower than span, center it; otherwise start
  // from the left edge of the span.
  const rowWidth = totalBoxWidths + gap * Math.max(n - 1, 0);
  const startX = -rowWidth / 2;

  const slots: BoxSlot[] = [];
  let cursor = startX;
  for (let i = 0; i < n; i++) {
    slots.push({ x: cursor + widths[i] / 2, ...resolved[i] });
    cursor += widths[i] + gap;
  }

  // Shelf extends past both edges, never shows end-caps.
  const shelfWidth = span + 2;

  return (
    <>
      <FirstFrame onFirstFrame={onFirstFrame} />
      <fog attach="fog" args={[lightingPreset.fogColor, fogNear, fogFar]} />
      <Haze preset={lightingPreset} reducedMotion={reducedMotion} />
      <Parallax enabled={!reducedMotion}>
        {/* Yaw group: rotates shelf + boxes + lights as a unit.
            SHELF_YAW is negative so (1,0,0) → (cos θ, 0, −sin θ) with θ < 0
            gives −sin θ > 0, i.e. the right end moves toward +z (the camera). */}
        <group
          position={[GROUP_OFFSET_X, 0, GROUP_OFFSET_Z]}
          rotation={[0, SHELF_YAW, 0]}
        >
          <Shelf
            worldWidth={shelfWidth}
            color={lightingPreset.shelfColor}
            reducedMotion={reducedMotion}
          />
          {boxes.map((box, i) => (
            <PuzzleBox
              key={i}
              box={box}
              slot={slots[i]}
              index={i}
              headingFont={headingFont}
            />
          ))}
          {slots.map((slot, i) => (
            <BoxSpot
              key={i}
              x={slot.x}
              preset={lightingPreset}
              reducedMotion={reducedMotion}
            />
          ))}
          <ContactShadows
            position={[0, 0.001, 0]}
            opacity={lightingPreset.shadowOpacity}
            scale={shelfWidth}
            blur={2.2}
            far={1.2}
            resolution={256}
          />
        </group>
      </Parallax>
    </>
  );
}

export interface SceneProps {
  boxes: PlankBox[];
  /** Pre-resolved per-box colors + heading font (resolved in index.tsx,
   *  where the marketing DOM scope is available). */
  resolved: Array<{ c1: string; c2: string }>;
  headingFont: string;
  theme: "light" | "dark";
  reducedMotion: boolean;
  visible: boolean;
  onFirstFrame: () => void;
  eventSource: React.RefObject<HTMLDivElement | null>;
}

export default function PlankScene(props: SceneProps) {
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
