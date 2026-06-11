import type { PlankBox } from "@/components/marketing/plank";
import { RoundedBox } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { easing } from "maath";
import * as React from "react";
import * as THREE from "three";
import { buildBoxArtSpec, createBoxArtTexture } from "./box-art";

// World scale: 1 unit = 100 CSS-plank pixels.
export const PX = 1 / 100;
export const BOX_DEPTH = 0.24;

export interface BoxSlot {
  x: number;
  /** Resolved hex colors for this box. */
  c1: string;
  c2: string;
}

const DRAG_RADIUS = 0.7; // max world-units a box can be pulled from its slot
const SPRING_STIFFNESS = 130;
const SPRING_DAMPING = 7; // underdamped → visible wobble on release

export function PuzzleBox({
  box,
  slot,
  index,
  headingFont,
  reducedMotion,
}: {
  box: PlankBox;
  slot: BoxSlot;
  index: number;
  headingFont: string;
  reducedMotion: boolean;
}) {
  const w = (box.width ?? 116) * PX;
  const defaultH = box.cover ? (box.width ?? 116) / 1.4 : (box.height ?? 144);
  const [h, setH] = React.useState(defaultH * PX);
  const [hovered, setHovered] = React.useState(false);

  const group = React.useRef<THREE.Group>(null);
  const drag = React.useRef<{
    active: boolean;
    plane: THREE.Plane;
    point: THREE.Vector3;
    target: THREE.Vector3;
    prev: THREE.Vector3;
    velocity: THREE.Vector3;
  }>({
    active: false,
    plane: new THREE.Plane(),
    point: new THREE.Vector3(),
    target: new THREE.Vector3(),
    prev: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
  });
  // manual underdamped spring state for tilt (x = pitch, z = roll)
  const tilt = React.useRef({ x: 0, z: 0, vx: 0, vz: 0 });

  const texture = React.useMemo(
    () =>
      createBoxArtTexture(
        buildBoxArtSpec(box, { c1: slot.c1, c2: slot.c2 }, defaultH),
        { heading: headingFont },
        (aspect) => setH(((box.width ?? 116) / aspect) * PX),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- texture keyed by art inputs only
    [box, slot.c1, slot.c2, headingFont],
  );
  React.useEffect(() => () => texture.dispose(), [texture]);
  React.useEffect(() => () => { document.body.style.cursor = ""; }, []);

  const home = React.useMemo(() => new THREE.Vector3(slot.x, h / 2, 0), [slot.x, h]);
  const lean = (index % 2 === 0 ? 1 : -1) * 0.015 + index * 0.002;
  const baseYaw = 0.06 * (index % 3 === 2 ? -1 : 1);

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (reducedMotion) return;
    e.stopPropagation();
    (e.target as unknown as Element).setPointerCapture(e.pointerId);
    const d = drag.current;
    d.active = true;
    // drag in the camera-facing plane through the box's home position
    const normal = new THREE.Vector3();
    e.camera.getWorldDirection(normal);
    d.plane.setFromNormalAndCoplanarPoint(normal, home);
    d.target.copy(group.current!.position);
    d.prev.copy(d.target);
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d.active) return;
    e.stopPropagation();
    if (e.ray.intersectPlane(d.plane, d.point)) {
      // rubber-band clamp around home
      const offset = d.point.sub(home);
      const len = offset.length();
      if (len > DRAG_RADIUS) offset.multiplyScalar(DRAG_RADIUS / len);
      d.target.copy(home).add(offset);
    }
  };

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current.active) return;
    e.stopPropagation();
    drag.current.active = false;
  };

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    if (reducedMotion) {
      g.position.copy(home);
      g.rotation.set(0, baseYaw, lean);
      return;
    }
    const d = drag.current;
    const delta = Math.min(dt, 1 / 30); // clamp tab-switch jumps

    // position: damp toward drag target / hover lift / home
    const dest = d.active
      ? d.target
      : hovered
        ? home.clone().setY(home.y + 0.07)
        : home;
    easing.damp3(g.position, dest, d.active ? 0.07 : 0.22, delta);

    // velocity estimate drives tilt while dragging
    d.velocity.copy(g.position).sub(d.prev).divideScalar(Math.max(delta, 1e-4));
    d.prev.copy(g.position);
    const t = tilt.current;
    const targetZ = d.active ? THREE.MathUtils.clamp(-d.velocity.x * 0.12, -0.3, 0.3) : 0;
    const targetX = d.active ? THREE.MathUtils.clamp(d.velocity.y * 0.1, -0.25, 0.25) : 0;
    // underdamped spring → wobble on release
    t.vz += (-SPRING_STIFFNESS * (t.z - targetZ) - SPRING_DAMPING * t.vz) * delta;
    t.z += t.vz * delta;
    t.vx += (-SPRING_STIFFNESS * (t.x - targetX) - SPRING_DAMPING * t.vx) * delta;
    t.x += t.vx * delta;
    g.rotation.set(t.x, baseYaw, lean + t.z);
  });

  return (
    <group
      ref={group}
      position={[slot.x, h / 2, 0]}
      rotation={[0, baseYaw, lean]}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (!reducedMotion) setHovered(true);
        document.body.style.cursor = reducedMotion ? "" : "grab";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "";
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <RoundedBox args={[w, h, BOX_DEPTH]} radius={0.015} smoothness={4}>
        <meshStandardMaterial color={slot.c2} roughness={0.55} metalness={0} />
      </RoundedBox>
      <mesh position={[0, 0, BOX_DEPTH / 2 + 0.001]}>
        <planeGeometry args={[w - 0.03, h - 0.03]} />
        <meshStandardMaterial map={texture} roughness={0.38} metalness={0} />
      </mesh>
    </group>
  );
}
