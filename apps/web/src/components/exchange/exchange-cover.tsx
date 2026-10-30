// The leading picture of an exchange or loan row: the puzzle's own cover (the copy's approved
// photo, else its box art, as the read views resolve it) instead of a generic icon. A swap shows
// both copies' covers overlapping, the first in front. The exchange kind sits as a small corner
// badge. Without any cover the row keeps its gradient kind chip, which is also how it renders
// against a backend that sends no cover URLs.
import { Image } from "@/compat/image";
import { CoverChip } from "@/components/community/primitives";
import { cn } from "@/lib/utils";
import type { ExchangeFields } from "@jigswap/contracts";
import { ArrowLeftRight, Package, Puzzle, Tag } from "lucide-react";

export type ExchangeKind = ExchangeFields["type"];

const KIND_ICONS = {
  trade: ArrowLeftRight,
  sale: Tag,
  loan: Package,
} as const satisfies Record<ExchangeKind, unknown>;

/** One puzzle cover, decorative (the row's text names the puzzle); a glyph when there is none. */
export function CoverTile({
  url,
  className,
}: {
  url: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      data-cover-tile
      className={cn(
        "bg-muted relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]",
        className,
      )}
    >
      {url ? (
        <Image src={url} alt="" fill className="object-cover" />
      ) : (
        <Puzzle aria-hidden className="text-muted-foreground size-4" />
      )}
    </span>
  );
}

export function ExchangeCover({
  kind,
  covers,
  gradientIndex,
  showKind = true,
}: {
  kind: ExchangeKind;
  /** The puzzles' cover URLs, the one to show in front first; two for a swap. */
  covers: ReadonlyArray<string | null | undefined>;
  /** Picks the fallback chip's gradient, so neighbouring rows differ. */
  gradientIndex: number;
  /** The kind badge; leave it out where every row is the same kind (the Loans tab). */
  showKind?: boolean;
}) {
  const KindIcon = KIND_ICONS[kind] ?? ArrowLeftRight;
  if (!covers.some(Boolean)) {
    return (
      <CoverChip icon={KindIcon} size={44} gradientIndex={gradientIndex} />
    );
  }
  const [front, back] = covers;
  return (
    <span aria-hidden className="relative block size-11 shrink-0">
      {covers.length > 1 ? (
        <>
          <CoverTile url={back} className="absolute top-0 left-0 size-8" />
          <CoverTile
            url={front}
            className="ring-background absolute right-0 bottom-0 size-8 ring-2"
          />
        </>
      ) : (
        <CoverTile url={front} />
      )}
      {showKind && (
        <span
          data-kind-badge
          className="bg-jigsaw-primary ring-background absolute -right-1.5 -bottom-1.5 flex size-5 items-center justify-center rounded-full text-white ring-2"
        >
          <KindIcon className="size-3" />
        </span>
      )}
    </span>
  );
}
