"use client";

import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import {
  Canvas,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import {
  CuboidCollider,
  Physics,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import * as React from "react";
import * as THREE from "three";
import { reconcileBodyRefs } from "./body-refs";
import { clampThrowVelocity } from "./drag-math";
import { loadArt, type BoxArt } from "./play-art";
import {
  BOX_DEPTH_PER_WIDTH,
  easeOut,
  eyeAt,
  PX,
  stageFrustum,
  toWorld,
  type PlayLayout,
} from "./play-layout";

// The shelf in 3D, loaded only when someone presses Play (three.js, rapier's WASM). Its first frame
// is the flat row: every box front on the pixels the row drew it on, seen from so far off that no
// depth shows. Then the eye comes in and up (stageFrustum keeps the fronts pinned) so the sides and
// tops grow in, and the boxes can be grabbed and thrown. Returning glides each box back to its spot
// and flattens the view again before the row takes over.

// rapier's RigidBodyType, by value: Dynamic = 0, KinematicPositionBased = 2.
const RB_DYNAMIC = 0 as Parameters<RapierRigidBody["setBodyType"]>[0];
const RB_KINEMATIC = 2 as Parameters<RapierRigidBody["setBodyType"]>[0];

// A puzzle box is about 38 cm across and a world unit 100 CSS px, so real gravity would be about 40
// units/s²; a little less keeps throws readable.
const GRAVITY = 30;
// How far the ledge stands out in front of the boxes, and its depth behind the deepest box.
const LEDGE_OVERHANG = 0.04;
const LEDGE_SPARE_DEPTH = 0.2;

// The shell's motion stays under 300ms (DESIGN.md, Motion): depth grows in, boxes glide home, the
// view flattens, each on the house's strong ease-out.
const DEPTH_IN_S = 0.28;
const GLIDE_S = 0.28;
const DEPTH_OUT_S = 0.2;

// Daylight from above and a little to the right; at night the same street under warm lamps. The
// fronts are unlit (MeshBasic), so the covers keep exactly the colours the row showed.
const LIGHTS = {
  light: { ambient: 1.8, key: 1.7, keyColor: "#fff6ea" },
  dark: { ambient: 1.3, key: 1.2, keyColor: "#ffe3b3" },
} as const;

export interface PlaySceneProps {
  layout: PlayLayout;
  theme: "light" | "dark";
  /** False while the shelf is scrolled out of view: no frames, no physics. */
  visible: boolean;
  /** Bumped to glide every box back and return the shelf to flat. */
  returnNonce: number;
  onFirstFrame: () => void;
  /** The boxes are back on their spots and the view is flat again. */
  onReturned: () => void;
}

interface Slot {
  position: [number, number, number];
  size: [number, number, number];
}

function placeCamera(
  camera: THREE.PerspectiveCamera,
  layout: PlayLayout,
  depth: number,
) {
  const eye = eyeAt(layout, depth);
  const near = eye.z * 0.5;
  const far = eye.z + 60;
  const f = stageFrustum(layout, eye, near);
  camera.position.set(eye.x, eye.y, eye.z);
  camera.quaternion.identity();
  camera.updateMatrixWorld();
  camera.projectionMatrix.makePerspective(
    f.left,
    f.right,
    f.top,
    f.bottom,
    near,
    far,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

// One box's six faces, in BoxGeometry's order: +x, -x, +y, -y, +z (front), -z.
function boxMaterials(art: BoxArt): THREE.Material[] {
  const plain = new THREE.MeshStandardMaterial({
    color: art.body,
    roughness: 0.7,
  });
  const side = (map?: THREE.Texture) =>
    map
      ? new THREE.MeshStandardMaterial({ map, roughness: 0.6 })
      : new THREE.MeshStandardMaterial({ color: art.body, roughness: 0.6 });
  return [
    side(art.sides?.right),
    side(art.sides?.left),
    side(art.sides?.top),
    plain,
    new THREE.MeshBasicMaterial({ map: art.front }),
    plain,
  ];
}

function Ledge({ layout, depth }: { layout: PlayLayout; depth: number }) {
  // The row's own ledge, end to end: a box pushed past an end falls.
  const { ledge } = layout;
  const [x, y] = toWorld(layout, ledge.x + ledge.w / 2, ledge.y + ledge.h / 2);
  const size: [number, number, number] = [ledge.w * PX, ledge.h * PX, depth];
  const position: [number, number, number] = [x, y, LEDGE_OVERHANG - depth / 2];
  const materials = React.useMemo(() => {
    const plank = new THREE.Color(layout.plank);
    const flat = (c: THREE.Color) => new THREE.MeshBasicMaterial({ color: c });
    // Front as the row's ledge; its top catches the light, its ends don't.
    const top = flat(plank.clone().lerp(new THREE.Color("#ffffff"), 0.2));
    const end = flat(plank.clone().multiplyScalar(0.85));
    return [end, end, top, end, flat(plank), end];
  }, [layout.plank]);
  React.useEffect(
    () => () => materials.forEach((m) => m.dispose()),
    [materials],
  );
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider
        args={[size[0] / 2, size[1] / 2, size[2] / 2]}
        position={position}
      />
      <mesh position={position} material={materials}>
        <boxGeometry args={size} />
      </mesh>
    </RigidBody>
  );
}

function Stage({
  layout,
  returnNonce,
  onFirstFrame,
  onReturned,
}: Omit<PlaySceneProps, "theme" | "visible">) {
  const art = React.use(loadArt(layout));
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const canvas = useThree((s) => s.gl.domElement);
  const raycaster = useThree((s) => s.raycaster);
  const pointer = useThree((s) => s.pointer);

  const slots: Slot[] = React.useMemo(
    () =>
      layout.boxes.map((box) => {
        const [x, y] = toWorld(layout, box.x + box.w / 2, box.y + box.h / 2);
        const w = box.w * PX;
        const h = box.h * PX;
        const d = w * BOX_DEPTH_PER_WIDTH;
        return { position: [x, y, -d / 2], size: [w, h, d] };
      }),
    [layout],
  );
  const ledgeDepth =
    Math.max(0, ...slots.map((s) => s.size[2])) + LEDGE_SPARE_DEPTH;
  const ledgeTop = toWorld(layout, 0, layout.ledge.y)[1];

  const materials = React.useMemo(() => art.map(boxMaterials), [art]);
  React.useEffect(
    () => () => {
      materials.flat().forEach((m) => m.dispose());
      art.forEach((a) => a.dispose());
    },
    [art, materials],
  );

  const [bodies] = React.useState(() =>
    reconcileBodyRefs<RapierRigidBody>([], layout.boxes.length),
  );

  // The view's depth, 0 (flat) to 1, and the motion driving it.
  const depth = React.useRef(0);
  const motion = React.useRef<{
    from: number;
    to: number;
    t: number;
    seconds: number;
    done?: () => void;
  } | null>(null);
  const glide = React.useRef<{
    t: number;
    from: Array<{ p: THREE.Vector3; q: THREE.Quaternion }>;
  } | null>(null);
  const firstFrame = React.useRef(false);
  // The box being held: it rides a vertical plane through it, facing the viewer (left and right
  // slide it along the shelf, up and down lift it); its last moves set the throw on release.
  const dragging = React.useRef<{
    index: number;
    offset: THREE.Vector3;
    plane: THREE.Plane;
    samples: Array<{ p: THREE.Vector3; t: number }>;
  } | null>(null);

  React.useLayoutEffect(() => {
    placeCamera(camera, layout, depth.current);
  }, [camera, layout]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30);
    if (!firstFrame.current) {
      firstFrame.current = true;
      onFirstFrame();
      // The depth grows in from the next frame on, over the matched flat one.
      motion.current = { from: 0, to: 1, t: 0, seconds: DEPTH_IN_S };
      invalidate();
      return;
    }

    const g = glide.current;
    if (g) {
      g.t = Math.min(1, g.t + dt / GLIDE_S);
      const e = easeOut(g.t);
      bodies.forEach((ref, i) => {
        const body = ref.current;
        const from = g.from[i];
        if (!body || !from) return;
        const to = new THREE.Vector3(...slots[i].position);
        body.setNextKinematicTranslation(from.p.clone().lerp(to, e));
        body.setNextKinematicRotation(
          from.q.clone().slerp(new THREE.Quaternion(), e),
        );
      });
      if (g.t >= 1) {
        glide.current = null;
        motion.current = {
          from: depth.current,
          to: 0,
          t: 0,
          seconds: DEPTH_OUT_S,
          done: onReturned,
        };
      }
      invalidate();
    }

    const m = motion.current;
    if (m) {
      m.t = Math.min(1, m.t + dt / m.seconds);
      depth.current = m.from + (m.to - m.from) * easeOut(m.t);
      placeCamera(camera, layout, depth.current);
      if (m.t >= 1) {
        motion.current = null;
        m.done?.();
      } else invalidate();
    }
  });

  // Return: every box glides (kinematic) from wherever it is to its spot, upright.
  React.useEffect(() => {
    if (!returnNonce) return;
    dragging.current = null;
    glide.current = {
      t: 0,
      from: bodies.map((ref) => {
        const body = ref.current;
        if (!body) return { p: new THREE.Vector3(), q: new THREE.Quaternion() };
        body.setBodyType(RB_KINEMATIC, true);
        const p = body.translation();
        const q = body.rotation();
        return {
          p: new THREE.Vector3(p.x, p.y, p.z),
          q: new THREE.Quaternion(q.x, q.y, q.z, q.w),
        };
      }),
    };
    invalidate();
    // Only an explicit return starts a glide, never a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnNonce]);

  // ——— drag and throw ———
  const hit = React.useCallback(
    (clientX: number, clientY: number, plane: THREE.Plane) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    },
    [camera, canvas, pointer, raycaster],
  );

  React.useEffect(() => {
    const release = (throwIt: boolean) => {
      const held = dragging.current;
      if (!held) return;
      dragging.current = null;
      canvas.style.removeProperty("touch-action");
      const body = bodies[held.index]?.current;
      if (!body) return;
      body.setBodyType(RB_DYNAMIC, true);
      const [a, b] = held.samples.slice(-2);
      const dt = a && b ? (b.t - a.t) / 1000 : 0;
      const v =
        throwIt && dt > 0
          ? clampThrowVelocity([
              (b.p.x - a.p.x) / dt,
              (b.p.y - a.p.y) / dt,
              (b.p.z - a.p.z) / dt,
            ])
          : [0, 0, 0];
      body.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
    };
    const onMove = (e: PointerEvent) => {
      const held = dragging.current;
      if (!held) return;
      const at = hit(e.clientX, e.clientY, held.plane);
      const body = bodies[held.index]?.current;
      if (!at || !body) return;
      const target = at.sub(held.offset);
      // Never down into or through the ledge.
      target.y = Math.max(target.y, ledgeTop + slots[held.index].size[1] / 2);
      body.setNextKinematicTranslation(target);
      held.samples.push({ p: target.clone(), t: e.timeStamp });
      if (held.samples.length > 4) held.samples.shift();
      invalidate();
    };
    const onUp = () => release(true);
    // The browser takes the gesture (pinch, OS): drop the box where it is, no throw.
    const onCancel = () => release(false);
    // touch-action is latched at touchstart, before a drag begins, so the page would still claim a
    // vertical drag: cancel the scroll while a box is held.
    const onTouchMove = (e: TouchEvent) => {
      if (dragging.current) e.preventDefault();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.style.removeProperty("touch-action");
    };
  }, [bodies, canvas, hit, invalidate, ledgeTop, slots]);

  const grab = (e: ThreeEvent<PointerEvent>, index: number) => {
    e.stopPropagation();
    // Boxes gliding home can't be caught.
    if (glide.current || motion.current?.done) return;
    const body = bodies[index]?.current;
    if (!body) return;
    const p = body.translation();
    const center = new THREE.Vector3(p.x, p.y, p.z);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 0, 1),
      center,
    );
    const at = hit(e.nativeEvent.clientX, e.nativeEvent.clientY, plane);
    if (!at) return;
    body.setBodyType(RB_KINEMATIC, true);
    canvas.style.setProperty("touch-action", "none");
    dragging.current = {
      index,
      offset: at.sub(center),
      plane,
      samples: [],
    };
  };

  const half = (layout.height / 2) * PX;
  return (
    <>
      <Ledge layout={layout} depth={ledgeDepth} />
      <RigidBody type="fixed" colliders={false}>
        {/* Front and back keep the boxes on the shelf's depth; the floor, out of sight below the
            stage, catches any that leave the ledge's ends. */}
        <CuboidCollider
          args={[200, 50, 0.05]}
          position={[0, 0, LEDGE_OVERHANG + 0.05]}
        />
        <CuboidCollider
          args={[200, 50, 0.05]}
          position={[0, 0, LEDGE_OVERHANG - ledgeDepth - 0.05]}
        />
        <CuboidCollider args={[200, 0.1, 10]} position={[0, -half - 3, 0]} />
      </RigidBody>
      {slots.map((slot, i) => (
        <RigidBody
          key={i}
          ref={bodies[i]}
          type="dynamic"
          colliders={false}
          position={slot.position}
          restitution={0.1}
          friction={0.8}
          linearDamping={0.3}
          angularDamping={0.4}
        >
          <CuboidCollider
            args={[slot.size[0] / 2, slot.size[1] / 2, slot.size[2] / 2]}
          />
          <mesh material={materials[i]} onPointerDown={(e) => grab(e, i)}>
            <boxGeometry args={slot.size} />
          </mesh>
        </RigidBody>
      ))}
    </>
  );
}

export default function PlayScene({
  layout,
  theme,
  visible,
  returnNonce,
  onFirstFrame,
  onReturned,
}: PlaySceneProps) {
  const coarse = useCoarsePointer();
  const light = LIGHTS[theme];
  return (
    <Canvas
      // Untoned output, so an unlit cover is exactly the row's picture.
      flat
      dpr={[1, coarse ? 1.5 : 2]}
      frameloop={visible ? "demand" : "never"}
      gl={{ alpha: true, antialias: true }}
      camera={{ manual: true }}
      resize={{ offsetSize: true }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={light.ambient} />
      <directionalLight
        position={[2, 6, 4]}
        intensity={light.key}
        color={light.keyColor}
      />
      {/* "independent": rapier steps on its own frames and asks the demand canvas for one while
          any body is awake, so drawing stops once every box is at rest. */}
      {/* Until rapier's WASM and the art have loaded nothing is drawn, and the flat row stays. */}
      <React.Suspense fallback={null}>
        <Physics
          gravity={[0, -GRAVITY, 0]}
          paused={!visible}
          updateLoop="independent"
        >
          <Stage
            layout={layout}
            returnNonce={returnNonce}
            onFirstFrame={onFirstFrame}
            onReturned={onReturned}
          />
        </Physics>
      </React.Suspense>
    </Canvas>
  );
}
