import type { PlankBox } from "@/components/marketing/plank";
import { RoundedBox } from "@react-three/drei";
import * as React from "react";
import * as THREE from "three";
import {
  buildBoxArtSpec,
  createBoxArtTexture,
  type CoverEdges,
} from "./box-art";

// World scale: 1 unit = 100 CSS-plank pixels.
export const PX = 1 / 100;
export const BOX_DEPTH = 0.24;

export interface BoxSlot {
  x: number;
  /** Resolved hex colors for this box. */
  c1: string;
  c2: string;
}

export function PuzzleBox({
  box,
  slot,
  index,
  headingFont,
}: {
  box: PlankBox;
  slot: BoxSlot;
  index: number;
  headingFont: string;
}) {
  const w = (box.width ?? 116) * PX;
  const defaultH = box.cover ? (box.width ?? 116) / 1.4 : (box.height ?? 144);
  const [h, setH] = React.useState(defaultH * PX);
  const [edges, setEdges] = React.useState<CoverEdges | null>(null);

  const texture = React.useMemo(
    () =>
      createBoxArtTexture(
        buildBoxArtSpec(box, { c1: slot.c1, c2: slot.c2 }, defaultH),
        { heading: headingFont },
        (aspect) => setH(((box.width ?? 116) / aspect) * PX),
        box.cover ? (e) => setEdges(e) : undefined,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- texture keyed by art inputs only
    [box, slot.c1, slot.c2, headingFont],
  );
  React.useEffect(() => () => texture.dispose(), [texture]);

  // Build CanvasTextures from the strip canvases when edges arrive.
  const stripTextures = React.useMemo(() => {
    if (!edges) return null;
    const make = (canvas: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    return {
      left: make(edges.leftStrip),
      right: make(edges.rightStrip),
      top: make(edges.topStrip),
    };
  }, [edges]);

  React.useEffect(
    () => () => {
      if (!stripTextures) return;
      stripTextures.left.dispose();
      stripTextures.right.dispose();
      stripTextures.top.dispose();
    },
    [stripTextures],
  );

  const lean = (index % 2 === 0 ? 1 : -1) * 0.015 + index * 0.002;
  const baseYaw = 0.06 * (index % 3 === 2 ? -1 : 1);
  const baseY = h / 2;

  // Body color: use edge average for cover boxes when available, otherwise slot.c2.
  const bodyColor = edges ? edges.body : slot.c2;

  return (
    <group position={[slot.x, baseY, 0]} rotation={[0, baseYaw, lean]}>
      <RoundedBox args={[w, h, BOX_DEPTH]} radius={0.015} smoothness={4}>
        <meshStandardMaterial
          color={bodyColor}
          roughness={0.55}
          metalness={0}
        />
      </RoundedBox>
      <mesh position={[0, 0, BOX_DEPTH / 2 + 0.001]}>
        <planeGeometry args={[w - 0.03, h - 0.03]} />
        <meshStandardMaterial map={texture} roughness={0.38} metalness={0} />
      </mesh>
      {/* Cover-edge bleed strips — only for cover-art boxes once edges load */}
      {stripTextures && (
        <>
          {/* Right side: image right-edge slice wrapped onto the right face */}
          <mesh position={[w / 2 + 0.001, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[BOX_DEPTH - 0.03, h - 0.03]} />
            <meshStandardMaterial
              map={stripTextures.right}
              roughness={0.55}
              metalness={0}
            />
          </mesh>
          {/* Left side: image left-edge slice wrapped onto the left face */}
          <mesh
            position={[-w / 2 - 0.001, 0, 0]}
            rotation={[0, -Math.PI / 2, 0]}
          >
            <planeGeometry args={[BOX_DEPTH - 0.03, h - 0.03]} />
            <meshStandardMaterial
              map={stripTextures.left}
              roughness={0.55}
              metalness={0}
            />
          </mesh>
          {/* Top: image top-edge slice wrapped onto the top face */}
          <mesh
            position={[0, h / 2 + 0.001, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[w - 0.03, BOX_DEPTH - 0.03]} />
            <meshStandardMaterial
              map={stripTextures.top}
              roughness={0.55}
              metalness={0}
            />
          </mesh>
        </>
      )}
    </group>
  );
}
