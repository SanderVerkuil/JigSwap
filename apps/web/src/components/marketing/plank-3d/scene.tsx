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
import { BOX_DEPTH, BOX_SCALE, PuzzleBox, PX, type BoxSlot } from "./box";
import { LIGHTING, type LightingPreset } from "./palette";

const SHELF_THICKNESS = 0.14;
const SHELF_DEPTH = 0.6;

// ——— shelf rows ———
// Vertical distance between shelf-board top surfaces. The tallest boxes are
// ~1.15 world units (144 px × BOX_SCALE × max jitter), leaving a visible air
// gap under each board like a real bookcase.
const ROW_PITCH = 1.45;
// Tallest box in world units — drives the framed content height.
const MAX_BOX_H = 1.44 * BOX_SCALE * 1.1;
// Slight per-row x shift so columns don't grid-align across rows
// (real shelves never line up).
const ROW_X_OFFSETS = [0, 0.55, -0.45];
// Deterministic per-instance footprint variation — repeated boxes read as
// different copies. Indexed, never Math.random, so renders are stable.
const SIZE_JITTER = [1, 0.92, 1.06, 0.88, 1.02, 0.95, 1.1, 0.9];
// Deterministic gap rhythm between neighbouring boxes on a row.
const GAP_PATTERN = [0.34, 0.5, 0.28, 0.44, 0.58, 0.3];
// Hard cap per row so ultra-wide viewports can't explode the draw count.
const MAX_PER_ROW = 14;
// Spotlights are expensive per-fragment: light only the bottom row, every
// other slot, capped — the upper rows live off key/ambient/hemi light.
const MAX_SPOTS = 6;

// ——— camera constants ———
const FOV = 38;
const CAMERA_X = 0.15;
// Headroom added above the box stack when computing the framed height.
const CONTENT_HEADROOM = 0.65;
// Camera sits slightly above the look-at point for a gentle downward gaze,
// like standing in front of a bookcase.
const CAMERA_Y_LIFT = 0.8;

// ——— yaw / perspective constants ———
// Negative yaw rotates the shelf so its right end swings toward +z (toward the
// camera). Math: (1,0,0) → (cos θ, 0, −sin θ). With θ = −27° that becomes
// (cos −27°, 0, +sin 27°) — right end moves forward. ✓
const SHELF_YAW = -(27 * Math.PI) / 180;

// The yawed shelf covers only cos(27°) ≈ 0.891 of its length on screen, so we
// distribute slots over a wider span; SPAN_PERSPECTIVE_ALLOWANCE adds extra
// room for the near end which projects larger due to perspective.
const SPAN_PERSPECTIVE_ALLOWANCE = 1.2;

// Group offset: pull composition slightly left and back so the near-right
// boxes don't overwhelm the frame after the yaw.
const GROUP_OFFSET_X = -0.3;
const GROUP_OFFSET_Z = -0.7;

// ——— fog constants ———
// FOG_NEAR ≈ camera distance; FOG_FAR adds a haze window so both row ends
// dissolve toward the page background color and the shelf reads as endless.
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
    o.position.set(x, 0.5, 0);
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
        position={[x + 0.15, 2.1, 1.0]}
        target={target}
        angle={0.45}
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

// One rendered box on a shelf row: the source box, its slot (x + resolved
// colors), the deterministic footprint jitter and a lean/yaw seed.
interface RowInstance {
  box: PlankBox;
  slot: BoxSlot;
  sizeScale: number;
  index: number;
}

/**
 * Fill one shelf row by cycling its box list left → right until the span is
 * covered (or MAX_PER_ROW). All variation (size jitter, gap rhythm) is
 * index-derived so the layout is deterministic per (row, span).
 */
function buildRowInstances(
  rowBoxes: PlankBox[],
  rowResolved: Array<{ c1: string; c2: string }>,
  rowIndex: number,
  span: number,
): RowInstance[] {
  if (rowBoxes.length === 0) return [];
  const out: RowInstance[] = [];
  let cursor = -span / 2;
  for (let i = 0; cursor < span / 2 && out.length < MAX_PER_ROW; i++) {
    const src = i % rowBoxes.length;
    const sizeScale = SIZE_JITTER[(i * 3 + rowIndex * 2) % SIZE_JITTER.length];
    const w = (rowBoxes[src].width ?? 116) * PX * BOX_SCALE * sizeScale;
    const colors = rowResolved[src] ?? { c1: "#8b5cf6", c2: "#6d28d9" };
    out.push({
      box: rowBoxes[src],
      slot: { x: cursor + w / 2, c1: colors.c1, c2: colors.c2 },
      sizeScale,
      // Decorrelate lean/yaw between vertical neighbours across rows.
      index: i * 3 + rowIndex,
    });
    cursor += w + GAP_PATTERN[(i * 2 + rowIndex) % GAP_PATTERN.length];
  }
  // If MAX_PER_ROW capped the fill before the span was covered (ultra-wide
  // viewports), slide the whole row right so it stays flush with the near
  // (camera-side) end; the bare stretch of board lands at the far end, deep
  // in the fog, instead of in plain view.
  const shortfall = span / 2 - cursor;
  if (shortfall > 0) {
    for (const inst of out) inst.slot.x += shortfall;
  }
  return out;
}

// Inner component that reads live canvas size via useThree, computes camera
// distance and visible world width, distributes box slots across shelf rows,
// and positions the camera — all in one place so the math stays consistent.
function Arrangement({
  rows,
  resolved,
  headingFont,
  lightingPreset,
  reducedMotion,
  onFirstFrame,
}: {
  rows: PlankBox[][];
  resolved: Array<Array<{ c1: string; c2: string }>>;
  headingFont: string;
  lightingPreset: LightingPreset;
  reducedMotion: boolean;
  onFirstFrame: () => void;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  const rowCount = Math.max(rows.length, 1);

  // ——— vertical framing: shelf stack height drives the camera ———
  // Stack spans from the bottom board (y ≈ 0) to the top of the top row's
  // tallest box; frame it with a little headroom.
  const stackH = ROW_PITCH * (rowCount - 1) + MAX_BOX_H;
  const lookAtY = stackH / 2 - 0.1;
  const cameraY = lookAtY + CAMERA_Y_LIFT;

  // ——— cover-fit by height, with minimum visible width for narrow canvases ———
  const vFov = (FOV * Math.PI) / 180;
  const aspect = size.width / size.height;
  const MIN_VIS_W = 3.2; // never show less than ~3 boxes worth of shelf
  const contentH = Math.max(stackH + CONTENT_HEADROOM, MIN_VIS_W / aspect);
  const dist = contentH / 2 / Math.tan(vFov / 2);

  // ——— visible world width at z = 0 ———
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const visW = 2 * dist * Math.tan(hFov / 2);

  // ——— position camera ———
  React.useLayoutEffect(() => {
    camera.position.set(CAMERA_X, cameraY, dist);
    camera.lookAt(0, lookAtY, 0);
    camera.updateProjectionMatrix();
  }, [camera, size, dist, cameraY, lookAtY]);

  // ——— fog distance bounds ———
  const fogNear = dist + FOG_NEAR_OFFSET;
  const fogFar = dist + FOG_FAR_OFFSET;

  // ——— row span: run past both screen edges so rows dissolve into the fog ———
  // The yawed shelf covers only cos(SHELF_YAW) of its length on screen, so we
  // distribute slots over a wider span; SPAN_PERSPECTIVE_ALLOWANCE adds extra
  // room for the near end which projects larger due to perspective.
  const span =
    ((visW + 0.6) / Math.cos(-SHELF_YAW)) * SPAN_PERSPECTIVE_ALLOWANCE;

  const rowInstances = React.useMemo(
    () =>
      rows.map((rowBoxes, r) =>
        buildRowInstances(rowBoxes, resolved[r] ?? [], r, span),
      ),
    [rows, resolved, span],
  );

  // Shelf boards extend past both edges, never showing end-caps.
  const shelfWidth = span + 2;

  return (
    <>
      <FirstFrame onFirstFrame={onFirstFrame} />
      <fog attach="fog" args={[lightingPreset.fogColor, fogNear, fogFar]} />
      <Haze preset={lightingPreset} reducedMotion={reducedMotion} />
      <Parallax enabled={!reducedMotion}>
        {/* Yaw group: rotates all shelf rows + boxes + lights as a unit.
            SHELF_YAW is negative so (1,0,0) → (cos θ, 0, −sin θ) with θ < 0
            gives −sin θ > 0, i.e. the right end moves toward +z (the camera). */}
        <group
          position={[GROUP_OFFSET_X, 0, GROUP_OFFSET_Z]}
          rotation={[0, SHELF_YAW, 0]}
        >
          {rowInstances.map((instances, r) => (
            <group
              key={r}
              position={[
                ROW_X_OFFSETS[r % ROW_X_OFFSETS.length],
                r * ROW_PITCH,
                0,
              ]}
            >
              <Shelf
                worldWidth={shelfWidth}
                color={lightingPreset.shelfColor}
                reducedMotion={reducedMotion}
              />
              {instances.map((inst, k) => (
                <PuzzleBox
                  key={k}
                  box={inst.box}
                  slot={inst.slot}
                  index={inst.index}
                  sizeScale={inst.sizeScale}
                  headingFont={headingFont}
                />
              ))}
              {/* Gallery spots + contact shadows only on the bottom row: the
                  ground row anchors the composition; upper rows stay cheap. */}
              {r === 0 &&
                instances
                  .filter((_, k) => k % 2 === 0)
                  .slice(0, MAX_SPOTS)
                  .map((inst, k) => (
                    <BoxSpot
                      key={k}
                      x={inst.slot.x}
                      preset={lightingPreset}
                      reducedMotion={reducedMotion}
                    />
                  ))}
              {r === 0 && (
                <ContactShadows
                  position={[0, 0.001, 0]}
                  opacity={lightingPreset.shadowOpacity}
                  scale={shelfWidth}
                  blur={2.2}
                  far={1.2}
                  resolution={256}
                />
              )}
            </group>
          ))}
        </group>
      </Parallax>
    </>
  );
}

export interface SceneProps {
  /** Shelf rows, bottom row first; each row carries its own box list. */
  rows: PlankBox[][];
  /** Pre-resolved per-box colors + heading font (resolved in index.tsx,
   *  where the marketing DOM scope is available). Parallel to `rows`. */
  resolved: Array<Array<{ c1: string; c2: string }>>;
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
        rows={props.rows}
        resolved={props.resolved}
        headingFont={props.headingFont}
        lightingPreset={lightingPreset}
        reducedMotion={props.reducedMotion}
        onFirstFrame={props.onFirstFrame}
      />
    </Canvas>
  );
}
