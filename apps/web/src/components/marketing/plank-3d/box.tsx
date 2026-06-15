import type { PlankBox } from "@/components/marketing/plank";
import { RoundedBox } from "@react-three/drei";
import * as React from "react";
import * as THREE from "three";
import {
  boxArtCacheKey,
  buildBoxArtSpec,
  createBoxArtTexture,
  type ArtFonts,
  type CoverEdges,
} from "./box-art";

// World scale: 1 unit = 100 CSS-plank pixels.
export const PX = 1 / 100;
// Multi-row shelf: boxes render at ~74% of their CSS-plank footprint so
// stacked rows fit the hero without any single box dominating the frame.
export const BOX_SCALE = 0.74;
export const BOX_DEPTH = 0.18;

/** World-space {w,h} of a box's front face (pre-aspect-correction), mirroring
 *  the scaling PuzzleBox applies. Used by the bounded scene's framing and the
 *  physics scene's colliders so they never drift from the visual size. */
export function boxWorldSize(
  box: Pick<PlankBox, "width" | "height" | "cover">,
  sizeScale = 1,
): { w: number; h: number } {
  const widthPx = box.width ?? 116;
  const worldScale = PX * BOX_SCALE * sizeScale;
  const hPx = box.cover ? widthPx / 1.4 : (box.height ?? 144);
  return { w: widthPx * worldScale, h: hPx * worldScale };
}

export interface BoxSlot {
  x: number;
  /** Resolved hex colors for this box. */
  c1: string;
  c2: string;
}

// ——— shared box-art texture cache ———
// Shelf rows repeat the incoming box list to look endless, so the same art is
// needed by several PuzzleBox instances at once. Cache CanvasTextures by art
// identity and refcount them; cover-load callbacks (aspect correction,
// edge-bleed strips) fan out to every subscribed instance.

interface ArtEntry {
  texture: THREE.CanvasTexture;
  refs: number;
  aspect: number | null;
  edges: CoverEdges | null;
  aspectSubs: Set<(aspect: number) => void>;
  edgeSubs: Set<(edges: CoverEdges) => void>;
}

const artCache = new Map<string, ArtEntry>();

function acquireArt(
  box: PlankBox,
  colors: { c1: string; c2: string },
  fonts: ArtFonts,
  defaultHPx: number,
): { key: string; entry: ArtEntry } {
  const spec = buildBoxArtSpec(box, colors, defaultHPx);
  const key = boxArtCacheKey(spec, fonts);
  let entry = artCache.get(key);
  if (!entry) {
    const next: ArtEntry = {
      texture: null as unknown as THREE.CanvasTexture,
      refs: 0,
      aspect: null,
      edges: null,
      aspectSubs: new Set(),
      edgeSubs: new Set(),
    };
    next.texture = createBoxArtTexture(
      spec,
      fonts,
      (aspect) => {
        next.aspect = aspect;
        next.aspectSubs.forEach((fn) => fn(aspect));
      },
      box.cover
        ? (edges) => {
            next.edges = edges;
            next.edgeSubs.forEach((fn) => fn(edges));
          }
        : undefined,
    );
    artCache.set(key, next);
    entry = next;
  }
  entry.refs++;
  return { key, entry };
}

function releaseArt(key: string) {
  const entry = artCache.get(key);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    entry.texture.dispose();
    artCache.delete(key);
  }
}

export function PuzzleBox({
  box,
  slot,
  index,
  headingFont,
  sizeScale = 1,
  anchored = true,
  fixedSize = false,
}: {
  box: PlankBox;
  slot: BoxSlot;
  index: number;
  headingFont: string;
  /** Deterministic per-instance footprint variation (texture is shared). */
  sizeScale?: number;
  /**
   * When true (default), the group self-positions at [slot.x, h/2, 0] with a
   * per-box yaw — the static scene's behaviour.
   * When false, the group is at local origin with no rotation so that a parent
   * <RigidBody> owns the world transform and a centered CuboidCollider matches.
   */
  anchored?: boolean;
  /**
   * When true, skip the post-load cover aspect-correction and render at the
   * deterministic boxWorldSize height. The physics scene needs this so the
   * rendered box matches its (statically-sized) CuboidCollider — otherwise a
   * cover with aspect ≠ 1.4 ends up a different size than its physics body.
   */
  fixedSize?: boolean;
}) {
  const widthPx = box.width ?? 116;
  const worldScale = PX * BOX_SCALE * sizeScale;
  const { w } = boxWorldSize(box, sizeScale);
  const defaultHPx = box.cover ? widthPx / 1.4 : (box.height ?? 144);

  const { key, entry } = React.useMemo(
    () =>
      acquireArt(
        box,
        { c1: slot.c1, c2: slot.c2 },
        { heading: headingFont },
        defaultHPx,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- art keyed by box identity + colors + font only
    [box, slot.c1, slot.c2, headingFont],
  );
  React.useEffect(() => () => releaseArt(key), [key]);

  // Height in CSS-plank pixels; corrected to the cover's real aspect when the
  // image loads (possibly long ago, on the cached entry).
  const [hPx, setHPx] = React.useState(() =>
    fixedSize || entry.aspect == null ? defaultHPx : widthPx / entry.aspect,
  );
  const [edges, setEdges] = React.useState<CoverEdges | null>(entry.edges);

  React.useEffect(() => {
    // fixedSize keeps the height at defaultHPx (== boxWorldSize, == the physics
    // collider); only the edge-bleed strips still update from the cache.
    if (!fixedSize) {
      setHPx(entry.aspect != null ? widthPx / entry.aspect : defaultHPx);
    }
    setEdges(entry.edges);
    const onAspect = (aspect: number) => {
      if (!fixedSize) setHPx(widthPx / aspect);
    };
    const onEdges = (e: CoverEdges) => setEdges(e);
    entry.aspectSubs.add(onAspect);
    entry.edgeSubs.add(onEdges);
    return () => {
      entry.aspectSubs.delete(onAspect);
      entry.edgeSubs.delete(onEdges);
    };
  }, [entry, widthPx, defaultHPx, fixedSize]);

  const texture = entry.texture;
  const h = hPx * worldScale;

  // Build CanvasTextures from the strip canvases when edges arrive. The strip
  // canvases are shared via the cache; the textures themselves are tiny
  // (16×256 / 256×16), so per-instance uploads are negligible.
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

  // Only a slight turn about the vertical axis varies the row — no sideways
  // roll, so every box sits flat on the shelf board like a real boxed puzzle
  // squared up on a shelf (a roll would balance it on one bottom corner).
  const yaw = 0.04 * (index % 3 === 2 ? -1 : 1);
  const baseY = h / 2;

  // Body color: use edge average for cover boxes when available, otherwise slot.c2.
  const bodyColor = edges ? edges.body : slot.c2;

  // When anchored=false the parent RigidBody owns world transform; render at
  // local origin so a centered CuboidCollider matches the visual exactly.
  const groupPos: [number, number, number] = anchored
    ? [slot.x, baseY, 0]
    : [0, 0, 0];
  const groupRot: [number, number, number] = anchored ? [0, yaw, 0] : [0, 0, 0];

  return (
    <group position={groupPos} rotation={groupRot}>
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
