import bridge800 from "@/components/marketing/assets/art/crops/bridge-800.webp";
import bridge from "@/components/marketing/assets/art/crops/bridge.webp";
import houseCut1200 from "@/components/marketing/assets/art/house-cut-1200.webp";
import houseCut1600 from "@/components/marketing/assets/art/house-cut-1600.webp";
import houseCutMask from "@/components/marketing/assets/art/house-cut-mask.webp";
import houseCut from "@/components/marketing/assets/art/house-cut.webp";
import journey1x800 from "@/components/marketing/assets/art/journey/step-1-800.webp";
import journey1 from "@/components/marketing/assets/art/journey/step-1.webp";
import journey2x800 from "@/components/marketing/assets/art/journey/step-2-800.webp";
import journey2 from "@/components/marketing/assets/art/journey/step-2.webp";
import journey3x800 from "@/components/marketing/assets/art/journey/step-3-800.webp";
import journey3 from "@/components/marketing/assets/art/journey/step-3.webp";
import journey4x800 from "@/components/marketing/assets/art/journey/step-4-800.webp";
import journey4 from "@/components/marketing/assets/art/journey/step-4.webp";
import kitchenTable800 from "@/components/marketing/assets/art/kitchen-table-800.webp";
import kitchenTable1600 from "@/components/marketing/assets/art/kitchen-table-1600.webp";
import kitchenTable from "@/components/marketing/assets/art/kitchen-table.webp";
import parkBridge800 from "@/components/marketing/assets/art/park-bridge-800.webp";
import parkBridge1200 from "@/components/marketing/assets/art/park-bridge-1200.webp";
import parkBridge from "@/components/marketing/assets/art/park-bridge.webp";

// Smaller renditions of the round-two art, as `srcSet` values: each is the same picture resized (see
// its provenance record), so the browser fetches the one its slot needs instead of the largest.

export const houseCutSrcSet = `${houseCut1200} 1200w, ${houseCut1600} 1600w, ${houseCut} 2400w`;

// The house's alpha alone over black, for masking the hero's dim to the house's edge without
// fetching the picture a second time.
export { houseCutMask };

export const kitchenTableSrcSet = `${kitchenTable800} 800w, ${kitchenTable1600} 1600w, ${kitchenTable} 2400w`;

export const bridgeSrcSet = `${bridge800} 800w, ${bridge} 1536w`;

// The park beside the How it works heading (1600 x 966).
export { parkBridge };
export const parkBridgeSrcSet = `${parkBridge800} 800w, ${parkBridge1200} 1200w, ${parkBridge} 1600w`;

// One box's journey on How it works: four 16:9 stops (1536 x 864), each with an 800 rendition.
export const journeyArt = [
  { src: journey1, srcSet: `${journey1x800} 800w, ${journey1} 1536w` },
  { src: journey2, srcSet: `${journey2x800} 800w, ${journey2} 1536w` },
  { src: journey3, srcSet: `${journey3x800} 800w, ${journey3} 1536w` },
  { src: journey4, srcSet: `${journey4x800} 800w, ${journey4} 1536w` },
] as const;

// Every box lid is 640 wide with a 320 rendition beside it.
const COVERS = import.meta.glob<string>("./covers/*.webp", {
  import: "default",
  eager: true,
});

const COVER_SRC_SETS = new Map(
  Object.entries(COVERS)
    .filter(([path]) => !path.endsWith("-320.webp"))
    .map(([path, url]) => [
      url,
      `${COVERS[path.replace(/\.webp$/, "-320.webp")]} 320w, ${url} 640w`,
    ]),
);

/** The `srcSet` for a lid imported from ./covers, by its imported URL. */
export function coverSrcSet(cover: string): string | undefined {
  return COVER_SRC_SETS.get(cover);
}
