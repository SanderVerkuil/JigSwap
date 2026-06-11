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

const GAP = 0.34;
const SHELF_THICKNESS = 0.14;
const SHELF_DEPTH = 0.7;

// ——— layout preset config ———

interface PresetConfig {
  fov: number;
  cameraX: number;
  cameraY: number;
  lookAtY: number;
  fitMargin: number;
  shelf: boolean;
  parallax: number;
  bob: boolean;
}

const PRESETS: Record<string, PresetConfig> = {
  side: {
    fov: 35,
    cameraX: 0.35,
    cameraY: 1.4,
    lookAtY: 0.55,
    fitMargin: 0.5,
    shelf: true,
    parallax: 1,
    bob: false,
  },
  stage: {
    fov: 30,
    cameraX: 0,
    cameraY: 1.0,
    lookAtY: 0.6,
    fitMargin: 0.3,
    shelf: true,
    parallax: 0.6,
    bob: false,
  },
  backdrop: {
    fov: 42,
    cameraX: 0.8,
    cameraY: 1.6,
    lookAtY: 0.6,
    fitMargin: 0.7,
    shelf: true,
    parallax: 1.4,
    bob: false,
  },
  float: {
    fov: 35,
    cameraX: 0.2,
    cameraY: 0.9,
    lookAtY: 0.7,
    fitMargin: 0.6,
    shelf: false,
    parallax: 1.8,
    bob: true,
  },
};

export interface SceneProps {
  boxes: PlankBox[];
  /** Pre-resolved per-box colors + heading font (resolved in index.tsx,
   *  where the marketing DOM scope is available). */
  resolved: Array<{ c1: string; c2: string }>;
  headingFont: string;
  theme: "light" | "dark";
  reducedMotion: boolean;
  visible: boolean;
  preset: "side" | "stage" | "backdrop" | "float";
  onFirstFrame: () => void;
  eventSource: React.RefObject<HTMLDivElement | null>;
}

function layoutSlots(
  boxes: PlankBox[],
  resolved: SceneProps["resolved"],
  preset: SceneProps["preset"],
): { slots: BoxSlot[]; worldWidth: number } {
  const widths = boxes.map((b) => (b.width ?? 116) * PX);
  const total =
    widths.reduce((a, b) => a + b, 0) + GAP * Math.max(boxes.length - 1, 0);
  let cursor = -total / 2;
  const isFloat = preset === "float";
  const slots: BoxSlot[] = widths.map((w, i) => {
    const x = cursor + w / 2;
    cursor += w + GAP;
    const base = { x, ...resolved[i] };
    if (isFloat) {
      return {
        ...base,
        y: 0.18 + (i % 3) * 0.16,
        z: i % 2 === 0 ? -0.12 : 0.1,
      };
    }
    return base;
  });
  return { slots, worldWidth: total };
}

function FitCamera({
  worldWidth,
  config,
}: {
  worldWidth: number;
  config: PresetConfig;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  React.useLayoutEffect(() => {
    // fov is set from the Canvas camera prop; read it here for the fit math
    const vFov = (config.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (size.width / size.height));
    const dist =
      (worldWidth / 2 + config.fitMargin + config.cameraX) / Math.tan(hFov / 2);
    camera.position.set(config.cameraX, config.cameraY, dist);
    camera.lookAt(0, config.lookAtY, 0);
    camera.updateProjectionMatrix();
  }, [camera, size, worldWidth, config]);
  return null;
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
      <boxGeometry args={[worldWidth + 0.8, SHELF_THICKNESS, SHELF_DEPTH]} />
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
  amplitude,
}: {
  children: React.ReactNode;
  enabled: boolean;
  amplitude: number;
}) {
  const group = React.useRef<THREE.Group>(null);
  useFrame((state, delta) => {
    if (!group.current) return;
    const target = enabled
      ? [
          state.pointer.y * 0.04 * amplitude,
          state.pointer.x * 0.07 * amplitude,
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

export default function PlankScene(props: SceneProps) {
  const config = PRESETS[props.preset] ?? PRESETS.side;
  const { slots, worldWidth } = layoutSlots(
    props.boxes,
    props.resolved,
    props.preset,
  );
  const lightingPreset = LIGHTING[props.theme];
  const leanMultiplier = props.preset === "float" ? 3 : 1;
  return (
    <Canvas
      dpr={[1, 2]}
      frameloop={props.visible ? "always" : "never"}
      gl={{ alpha: true, antialias: true }}
      style={{ pointerEvents: "none", background: "transparent" }}
      camera={{ fov: config.fov }}
      eventSource={props.eventSource as unknown as React.RefObject<HTMLElement>}
      events={transformSafeEvents}
      resize={{ offsetSize: true }}
    >
      <FirstFrame onFirstFrame={props.onFirstFrame} />
      <FitCamera worldWidth={worldWidth} config={config} />
      <Lights preset={lightingPreset} reducedMotion={props.reducedMotion} />
      <Parallax enabled={!props.reducedMotion} amplitude={config.parallax}>
        {config.shelf && (
          <Shelf
            worldWidth={worldWidth}
            color={lightingPreset.shelfColor}
            reducedMotion={props.reducedMotion}
          />
        )}
        {props.boxes.map((box, i) => (
          <PuzzleBox
            key={i}
            box={box}
            slot={slots[i]}
            index={i}
            headingFont={props.headingFont}
            reducedMotion={props.reducedMotion}
            bob={config.bob}
            leanMultiplier={leanMultiplier}
          />
        ))}
        <ContactShadows
          position={[0, 0.001, 0]}
          opacity={lightingPreset.shadowOpacity}
          scale={worldWidth + 2}
          blur={props.preset === "float" ? 2.8 : 2.2}
          far={1.2}
          resolution={256}
        />
      </Parallax>
    </Canvas>
  );
}
