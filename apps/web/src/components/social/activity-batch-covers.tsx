import { CoverChip } from "@/components/community/primitives";
import type { gateway } from "@/gateway";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { Puzzle } from "lucide-react";
import { useTranslations } from "use-intl";

type ActivityBatch = NonNullable<
  FunctionReturnType<typeof gateway.social.activityFeed>[number]["batch"]
>;

// The covers strip of a grouped batch add: the first few covers the viewer may see (the server
// already filtered and capped them), then "+N" for the rest, all one link to the member's puzzles
// on their profile. A cover without art falls back to the gradient chip.
export function ActivityBatchCovers({
  memberId,
  batch,
  size = 40,
}: {
  memberId: string;
  batch: ActivityBatch;
  size?: number;
}) {
  const t = useTranslations("activity.acquisitionBatch");
  const rest = batch.count - batch.covers.length;
  return (
    <Link
      to="/members/$handle"
      params={{ handle: memberId }}
      hash="puzzles"
      aria-label={t("covers", { count: batch.count })}
      className="mt-2 flex w-fit items-center gap-1.5 rounded-lg"
    >
      {batch.covers.map((cover, index) =>
        cover.coverUrl ? (
          <img
            key={cover.copyId}
            data-slot="batch-cover"
            src={cover.coverUrl}
            alt=""
            title={cover.title}
            loading="lazy"
            className="bg-muted shrink-0 rounded-lg object-cover"
            style={{ width: size, height: size }}
          />
        ) : (
          <span key={cover.copyId} data-slot="batch-cover" title={cover.title}>
            <CoverChip icon={Puzzle} size={size} gradientIndex={index} />
          </span>
        ),
      )}
      {rest > 0 && (
        <span className="text-muted-foreground px-1 text-xs font-medium">
          +{rest}
        </span>
      )}
    </Link>
  );
}
