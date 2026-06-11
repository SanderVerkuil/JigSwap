import type { PlankBox } from "@/components/marketing/plank";
import { ContactShadows } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { easing } from "maath";
import * as React from "react";
import * as THREE from "three";
import { BOX_DEPTH, PuzzleBox, PX, type BoxSlot } from "./box";
import { LIGHTING, type LightingPreset } from "./palette";

const GAP = 0.34;
const SHELF_THICKNESS = 0.14;
const SHELF_DEPTH = 0.7;
const CAMERA_X = 0.35;

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
}

function layoutSlots(
  boxes: PlankBox[],
  resolved: SceneProps["resolved"],
): { slots: BoxSlot[]; worldWidth: number } {
  const widths = boxes.map((b) => (b.width ?? 116) * PX);
  const total = widths.reduce((a, b) => a + b, 0) + GAP * (boxes.length - 1);
  let cursor = -total / 2;
  const slots = widths.map((w, i) => {
    const slot = { x: cursor + w / 2, ...resolved[i] };
    cursor += w + GAP;
    return slot;
  });
  return { slots, worldWidth: total };
}

function FitCamera({ worldWidth }: { worldWidth: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  React.useLayoutEffect(() => {
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (size.width / size.height));
    const dist = (worldWidth / 2 + 0.5 + CAMERA_X) / Math.tan(hFov / 2);
    camera.position.set(CAMERA_X, 1.4, dist);
    camera.lookAt(0, 0.55, 0);
    camera.updateProjectionMatrix();
  }, [camera, size, worldWidth]);
  return null;
}

/** Damps all light parameters toward the active theme preset. */
function Lights({ preset, reducedMotion }: { preset: LightingPreset; reducedMotion: boolean }) {
  const key = React.useRef<THREE.DirectionalLight>(null);
  const ambient = React.useRef<THREE.AmbientLight>(null);
  const hemi = React.useRef<THREE.HemisphereLight>(null);
  const rim = React.useRef<THREE.DirectionalLight>(null);

  useFrame((_, delta) => {
    if (!key.current || !ambient.current || !hemi.current || !rim.current) return;
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
    easing.damp(ambient.current, "intensity", preset.ambientIntensity, 0.3, delta);
    easing.dampC(ambient.current.color, preset.ambientColor, 0.3, delta);
    easing.damp(hemi.current, "intensity", preset.hemiIntensity, 0.3, delta);
    easing.damp(rim.current, "intensity", preset.rimIntensity, 0.3, delta);
  });

  return (
    <>
      <directionalLight ref={key} position={[2.5, 4, 3]} intensity={preset.keyIntensity} />
      <ambientLight ref={ambient} intensity={preset.ambientIntensity} />
      <hemisphereLight ref={hemi} color="#ffffff" groundColor="#d9c4a8" intensity={preset.hemiIntensity} />
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
    <mesh position={[0, -SHELF_THICKNESS / 2, SHELF_DEPTH / 2 - BOX_DEPTH / 2 - 0.1]}>
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

export default function PlankScene(props: SceneProps) {
  const { slots, worldWidth } = layoutSlots(props.boxes, props.resolved);
  const preset = LIGHTING[props.theme];
  return (
    <Canvas
      dpr={[1, 2]}
      frameloop={props.visible ? "always" : "never"}
      gl={{ alpha: true, antialias: true }}
      style={{ pointerEvents: "none", background: "transparent" }}
      camera={{ fov: 35 }}
    >
      <FirstFrame onFirstFrame={props.onFirstFrame} />
      <FitCamera worldWidth={worldWidth} />
      <Lights preset={preset} reducedMotion={props.reducedMotion} />
      <Shelf worldWidth={worldWidth} color={preset.shelfColor} reducedMotion={props.reducedMotion} />
      {props.boxes.map((box, i) => (
        <PuzzleBox
          key={i}
          box={box}
          slot={slots[i]}
          index={i}
          headingFont={props.headingFont}
        />
      ))}
      <ContactShadows
        position={[0, 0.001, 0]}
        opacity={preset.shadowOpacity}
        scale={worldWidth + 2}
        blur={2.2}
        far={1.2}
        resolution={256}
      />
    </Canvas>
  );
}
