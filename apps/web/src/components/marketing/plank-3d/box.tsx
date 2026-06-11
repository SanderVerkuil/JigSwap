import type { PlankBox } from "@/components/marketing/plank";
import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as React from "react";
import * as THREE from "three";
import { buildBoxArtSpec, createBoxArtTexture } from "./box-art";

// World scale: 1 unit = 100 CSS-plank pixels.
export const PX = 1 / 100;
export const BOX_DEPTH = 0.24;

export interface BoxSlot {
  x: number;
  /** Optional y lift (float preset). Default 0. */
  y?: number;
  /** Optional z offset (float preset). Default 0. */
  z?: number;
  /** Resolved hex colors for this box. */
  c1: string;
  c2: string;
}

export function PuzzleBox({
  box,
  slot,
  index,
  headingFont,
  reducedMotion,
  bob,
  leanMultiplier = 1,
}: {
  box: PlankBox;
  slot: BoxSlot;
  index: number;
  headingFont: string;
  reducedMotion: boolean;
  bob: boolean;
  leanMultiplier?: number;
}) {
  const w = (box.width ?? 116) * PX;
  const defaultH = box.cover ? (box.width ?? 116) / 1.4 : (box.height ?? 144);
  const [h, setH] = React.useState(defaultH * PX);

  const group = React.useRef<THREE.Group>(null);

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

  const slotY = slot.y ?? 0;
  const slotZ = slot.z ?? 0;
  const lean =
    ((index % 2 === 0 ? 1 : -1) * 0.015 + index * 0.002) * leanMultiplier;
  const baseYaw = 0.06 * (index % 3 === 2 ? -1 : 1);
  const baseY = slotY + h / 2;

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    if (bob && !reducedMotion) {
      g.position.y =
        baseY + Math.sin(state.clock.elapsedTime * 0.8 + index * 1.7) * 0.025;
    } else {
      g.position.y = baseY;
    }
  });

  return (
    <group
      ref={group}
      position={[slot.x, baseY, slotZ]}
      rotation={[0, baseYaw, lean]}
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
