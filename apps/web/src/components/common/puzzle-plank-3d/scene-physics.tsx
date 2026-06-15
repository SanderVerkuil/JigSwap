"use client";

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
import {
  CuboidCollider,
  Physics,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import { easing } from "maath";
import * as React from "react";
import * as THREE from "three";
import { clampThrowVelocity } from "./drag-math";
import { layoutRow } from "./layout";
import type { PlankSceneProps } from "./scene";

// @dimforge/rapier3d-compat is a transitive peer; we reference its enum
// values via numeric constants to avoid a direct (unresolvable) import.
// RigidBodyType: Dynamic=0, Fixed=1, KinematicPositionBased=2
const RB_DYNAMIC = 0 as Parameters<RapierRigidBody["setBodyType"]>[0];
const RB_KINEMATIC_POS = 2 as Parameters<RapierRigidBody["setBodyType"]>[0];

// ——— shelf constants (mirrors scene.tsx) ———
const SHELF_THICKNESS = 0.14;
const SHELF_DEPTH = 0.6;

// ——— camera constants (mirrors scene.tsx) ———
const FOV = 38;
const CONTENT_HEADROOM = 0.4;
const MIN_VIS_W = 2.0;
const CAMERA_Y_LIFT = 0.3;
// In-app planks render FACE-ON (no yaw) — the camera looks straight on. The
// angled, depth-y look is reserved for the marketing hero background.
const FIXED_YAW = 0;

// ——— drag ring-buffer size ———
const DRAG_BUF = 4;

// ——— world height helper ———
function boxWorldHeight(box: PuzzlePlankBox): number {
  return boxWorldSize(box).h;
}

// ——— Lights (identical to scene.tsx) ———
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

// transformSafeEvents: pointer NDC computed from the canvas's live client rect.
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

// ——— Drag hook — inline because it needs access to scene state ———
interface DragState {
  bodyIndex: number;
  grabOffset: THREE.Vector3; // offset from body origin to grab point
  dragPlane: THREE.Plane; // camera-parallel plane through the grab point
  buf: Array<{ pos: THREE.Vector3; t: number }>; // ring buffer for velocity
  bufIdx: number;
  canvas: HTMLCanvasElement;
}

function useBoxDrag(rigidBodyRefs: React.RefObject<RapierRigidBody | null>[]): {
  onPointerDown: (e: React.PointerEvent<HTMLElement>, index: number) => void;
} {
  const { camera, raycaster, pointer } = useThree();
  const dragState = React.useRef<DragState | null>(null);
  const canvas = useThree((s) => s.gl.domElement);

  // Pointer-move on window during drag
  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const ds = dragState.current;
      if (!ds) return;

      // Recompute NDC from canvas bounds (same as transformSafeEvents)
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);

      // intersectPlane returns null when the ray is parallel to the plane; the
      // pre-allocated target is always truthy, so we must guard the RETURN value.
      const hit = raycaster.ray.intersectPlane(
        ds.dragPlane,
        new THREE.Vector3(),
      );
      if (!hit) return;

      const body = rigidBodyRefs[ds.bodyIndex]?.current;
      if (!body) return;

      const targetPos = hit.clone().sub(ds.grabOffset);
      body.setNextKinematicTranslation(targetPos);

      // Push into ring buffer
      const idx = ds.bufIdx % DRAG_BUF;
      ds.buf[idx] = { pos: targetPos.clone(), t: e.timeStamp };
      ds.bufIdx++;
    };

    const onUp = (e: PointerEvent) => {
      const ds = dragState.current;
      if (!ds) return;

      const body = rigidBodyRefs[ds.bodyIndex]?.current;
      if (body) {
        // Compute velocity from ring buffer (last two valid samples)
        const count = Math.min(ds.bufIdx, DRAG_BUF);
        if (count >= 2) {
          const newest = ds.buf[(ds.bufIdx - 1) % DRAG_BUF];
          const older = ds.buf[(ds.bufIdx - 2) % DRAG_BUF];
          if (newest && older) {
            const dt = (newest.t - older.t) / 1000;
            if (dt > 0) {
              const rawVel: [number, number, number] = [
                (newest.pos.x - older.pos.x) / dt,
                (newest.pos.y - older.pos.y) / dt,
                (newest.pos.z - older.pos.z) / dt,
              ];
              const vel = clampThrowVelocity(rawVel);
              body.setBodyType(RB_DYNAMIC, true);
              body.setLinvel({ x: vel[0], y: vel[1], z: vel[2] }, true);
            } else {
              body.setBodyType(RB_DYNAMIC, true);
              body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            }
          } else {
            body.setBodyType(RB_DYNAMIC, true);
          }
        } else {
          body.setBodyType(RB_DYNAMIC, true);
        }
      }

      // Restore scroll on touch
      canvas.style.removeProperty("touch-action");
      try {
        ds.canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Capture may already be gone (e.g. after a cancel); ignore.
      }
      dragState.current = null;
    };

    // The browser fires pointercancel (NOT pointerup) when it steals the gesture
    // (pinch-zoom, OS interruption). Without this, touchAction would stay "none"
    // and the page would be stuck unscrollable. Drop the box in place, no throw.
    const onCancel = () => {
      const ds = dragState.current;
      if (!ds) return;
      const body = rigidBodyRefs[ds.bodyIndex]?.current;
      if (body) {
        body.setBodyType(RB_DYNAMIC, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      canvas.style.removeProperty("touch-action");
      dragState.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      // Defensive: if we unmount mid-drag, never leave the page unscrollable.
      canvas.style.removeProperty("touch-action");
    };
  }, [camera, canvas, pointer, raycaster, rigidBodyRefs]);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLElement>, index: number) => {
      e.stopPropagation();
      const body = rigidBodyRefs[index]?.current;
      if (!body) return;

      // Capture the pointer on the CANVAS (e.target is a three.js Object3D, not a
      // DOM node) so moves/ups fire even when the cursor leaves the canvas.
      try {
        canvas.setPointerCapture(e.nativeEvent.pointerId);
      } catch {
        // Capture is best-effort; the window-level listeners cover the drag anyway.
      }

      // Prevent page scroll while dragging
      canvas.style.setProperty("touch-action", "none");

      // Switch to kinematic so we drive the position
      body.setBodyType(RB_KINEMATIC_POS, true);

      // Compute grab point in world space via raycaster
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);

      // Drag plane through the body, VERTICAL (contains world-up) and facing the
      // camera horizontally. Using the camera's full forward made a tilted plane
      // where cursor moves mapped to a confusing diagonal; flattening the normal
      // to the horizontal decouples the axes: left/right slides the box along the
      // shelf, up/down lifts it.
      const bodyPos = body.translation();
      const bodyVec = new THREE.Vector3(bodyPos.x, bodyPos.y, bodyPos.z);
      const camForward = new THREE.Vector3();
      camera.getWorldDirection(camForward);
      camForward.y = 0;
      if (camForward.lengthSq() < 1e-6) camForward.set(0, 0, 1); // near top-down fallback
      camForward.normalize();
      const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        camForward,
        bodyVec,
      );

      // Grab offset = hit point - body center (so box doesn't jump to cursor).
      // Guard the RETURN value: null when the ray is parallel to the plane.
      const hit = raycaster.ray.intersectPlane(dragPlane, new THREE.Vector3());
      if (!hit) {
        // Degenerate grab — revert the kinematic switch + scroll lock, don't drag.
        body.setBodyType(RB_DYNAMIC, true);
        canvas.style.removeProperty("touch-action");
        return;
      }
      const grabOffset = hit.sub(bodyVec);

      dragState.current = {
        bodyIndex: index,
        grabOffset,
        dragPlane,
        buf: [],
        bufIdx: 0,
        canvas: canvas,
      };
    },
    [camera, canvas, pointer, raycaster, rigidBodyRefs],
  );

  return { onPointerDown };
}

// ——— Physics Arrangement ———
function PhysicsArrangement({
  boxes,
  resolved,
  headingFont,
  lightingPreset,
  onFirstFrame,
  resetNonce = 0,
}: {
  boxes: PuzzlePlankBox[];
  resolved: Array<{ c1: string; c2: string }>;
  headingFont: string;
  lightingPreset: LightingPreset;
  onFirstFrame: () => void;
  resetNonce?: number;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  const { slots, rowWidth } = React.useMemo(() => layoutRow(boxes), [boxes]);

  const maxBoxH = React.useMemo(
    () => Math.max(...boxes.map(boxWorldHeight), 0.5),
    [boxes],
  );

  // ——— cover-fit camera with yaw baked in ———
  // Instead of wrapping content in a rotated group, we orbit the camera
  // around the y-axis by FIXED_YAW so boxes appear at the same 12° angle
  // as in the static scene while physics bodies live in world space.
  const vFov = (FOV * Math.PI) / 180;
  const aspect = size.width / size.height;
  const framedH = maxBoxH + CONTENT_HEADROOM;
  const contentH = Math.max(framedH, MIN_VIS_W / aspect);
  const dist = contentH / 2 / Math.tan(vFov / 2);
  const lookAtY = maxBoxH / 2;
  const cameraY = lookAtY + CAMERA_Y_LIFT;

  React.useLayoutEffect(() => {
    // Orbit camera by FIXED_YAW around y-axis while targeting the shelf center
    const camX = Math.sin(-FIXED_YAW) * dist;
    const camZ = Math.cos(-FIXED_YAW) * dist;
    camera.position.set(camX, cameraY, camZ);
    camera.lookAt(0, lookAtY, 0);
    camera.updateProjectionMatrix();
  }, [camera, size, dist, cameraY, lookAtY]);

  const shelfW = rowWidth + 0.4;

  // Per-box rigid body refs for the drag hook
  const rigidBodyRefs = React.useMemo(
    () => boxes.map(() => React.createRef<RapierRigidBody>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boxes.length],
  );

  const { onPointerDown } = useBoxDrag(
    rigidBodyRefs as React.RefObject<RapierRigidBody | null>[],
  );

  // Reset: snap every box back to its resting layout slot (upright, still). Driven
  // by resetNonce so it fires only on an explicit reset, never on data refreshes.
  React.useEffect(() => {
    if (!resetNonce) return; // 0 = initial mount, nothing to reset
    boxes.forEach((box, i) => {
      const body = rigidBodyRefs[i]?.current;
      const slot = slots[i];
      if (!body || !slot) return;
      const { h } = boxWorldSize(box);
      body.setTranslation({ x: slot.x, y: h / 2, z: 0 }, true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
    // Intentionally only resetNonce — boxes/slots/refs are stable for a given layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  return (
    <>
      <FirstFrame onFirstFrame={onFirstFrame} />

      {/* Fixed shelf board */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[shelfW / 2, SHELF_THICKNESS / 2, SHELF_DEPTH / 2]}
          position={[
            0,
            -SHELF_THICKNESS / 2,
            SHELF_DEPTH / 2 - BOX_DEPTH / 2 - 0.1,
          ]}
        />
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
      </RigidBody>

      {/* Invisible ground plane to catch fallen boxes */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[shelfW * 3, 0.05, SHELF_DEPTH * 3]}
          position={[0, -(SHELF_THICKNESS + maxBoxH * 2), 0]}
        />
      </RigidBody>

      {/* Invisible side walls to keep boxes on the shelf */}
      <RigidBody type="fixed" colliders={false}>
        {/* Left wall */}
        <CuboidCollider
          args={[0.05, maxBoxH, SHELF_DEPTH]}
          position={[-(shelfW / 2 + 0.05), maxBoxH / 2, 0]}
        />
        {/* Right wall */}
        <CuboidCollider
          args={[0.05, maxBoxH, SHELF_DEPTH]}
          position={[shelfW / 2 + 0.05, maxBoxH / 2, 0]}
        />
        {/* Back wall */}
        <CuboidCollider
          args={[shelfW / 2, maxBoxH, 0.05]}
          position={[0, maxBoxH / 2, -(SHELF_DEPTH / 2 + 0.05)]}
        />
        {/* Front wall */}
        <CuboidCollider
          args={[shelfW / 2, maxBoxH, 0.05]}
          position={[0, maxBoxH / 2, SHELF_DEPTH / 2 + 0.05]}
        />
      </RigidBody>

      {/* Dynamic puzzle boxes */}
      {boxes.map((box, i) => {
        const { w, h } = boxWorldSize(box);
        const slot = slots[i];
        if (!slot) return null;
        return (
          <RigidBody
            key={i}
            ref={rigidBodyRefs[i]}
            type="dynamic"
            position={[slot.x, h / 2, 0]}
            colliders={false}
            restitution={0.1}
            friction={0.8}
            // Lower damping so boxes respond livelier to grabs/throws and tumble
            // more naturally (higher damping felt sluggish/static).
            linearDamping={0.3}
            angularDamping={0.4}
          >
            <CuboidCollider args={[w / 2, h / 2, BOX_DEPTH / 2]} />
            <group
              onPointerDown={(e) =>
                onPointerDown(
                  e as unknown as React.PointerEvent<HTMLElement>,
                  i,
                )
              }
            >
              <PuzzleBox
                box={box}
                slot={{
                  x: slot.x,
                  c1: resolved[i]?.c1 ?? "#6048e8",
                  c2: resolved[i]?.c2 ?? "#494e92",
                }}
                index={i}
                headingFont={headingFont}
                sizeScale={1}
                anchored={false}
              />
            </group>
          </RigidBody>
        );
      })}

      <ContactShadows
        position={[0, 0.001, 0]}
        opacity={lightingPreset.shadowOpacity}
        scale={rowWidth + 1}
        blur={2.2}
        far={1.2}
        resolution={256}
      />
    </>
  );
}

export default function PlankScenePhysics(props: PlankSceneProps) {
  const lightingPreset = LIGHTING[props.theme];
  return (
    <Canvas
      dpr={[1, 2]}
      frameloop={props.visible ? "always" : "never"}
      gl={{ alpha: true, antialias: true }}
      style={{ pointerEvents: "auto", background: "transparent" }}
      camera={{ fov: FOV }}
      eventSource={props.eventSource as unknown as React.RefObject<HTMLElement>}
      events={transformSafeEvents}
      resize={{ offsetSize: true }}
    >
      <Lights preset={lightingPreset} reducedMotion={props.reducedMotion} />
      <Physics
        gravity={[0, -9.81, 0]}
        paused={!props.visible || props.reducedMotion}
      >
        <PhysicsArrangement
          boxes={props.boxes}
          resolved={props.resolved}
          headingFont={props.headingFont}
          lightingPreset={lightingPreset}
          onFirstFrame={props.onFirstFrame}
          resetNonce={props.resetNonce}
        />
      </Physics>
    </Canvas>
  );
}
