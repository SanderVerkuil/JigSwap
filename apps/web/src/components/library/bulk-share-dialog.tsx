"use client";

import { Link } from "@/compat/link";
import { CoverChip } from "@/components/community/primitives";
import { CircleThreadAvatar } from "@/components/messaging/circle-thread-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import type { CircleSummaryView } from "@jigswap/contracts";
import { useQuery } from "@tanstack/react-query";
import { EyeOff, House, Loader2, Users } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

export type ShareableCircle = CircleSummaryView & { aggregateId: string };

// Pick the circle a bulk "Share with circle" shares the selected puzzles into. A View only seat
// can't share (the server refuses it too), so its row is disabled and says so. Before anything is
// picked it says which selected puzzles stay out (a housemate's: only the owner shares) and how many
// members won't see (not on offer). Picking one runs `onPick`; the dialog stays open, its choices
// disabled, until that has finished.
export function BulkShareDialog({
  open,
  onOpenChange,
  count,
  housemates,
  hidden,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // How many selected puzzles the share covers: the member's own.
  count: number;
  // Selected puzzles left out because they're housemates'.
  housemates: number;
  // How many of the covered puzzles circle members won't see once shared.
  hidden: number;
  onPick: (circle: ShareableCircle) => Promise<void>;
}) {
  const t = useTranslations("puzzles.bulk.circle");
  const tCircles = useTranslations("circles");
  const circles = useQuery(
    convexQuery(gateway.sharing.myCircles, open ? {} : "skip"),
  );
  const [pickedId, setPickedId] = useState<string | null>(null);
  // Legacy rows without an aggregate id can't take shares.
  const choices = (circles.data ?? []).flatMap((circle) =>
    circle.aggregateId ? [{ ...circle, aggregateId: circle.aggregateId }] : [],
  );

  const pick = async (circle: ShareableCircle) => {
    setPickedId(circle._id);
    try {
      await onPick(circle);
      onOpenChange(false);
    } finally {
      setPickedId(null);
    }
  };

  const list = () => {
    if (circles.isError) {
      return (
        <p className="text-muted-foreground text-sm">
          {tCircles("shareDialog.loadError")}
        </p>
      );
    }
    if (circles.data === undefined) {
      return (
        <Loader2
          className="text-muted-foreground mx-auto size-5 animate-spin"
          aria-hidden
        />
      );
    }
    if (choices.length === 0) {
      return (
        <div className="flex flex-col items-start gap-3">
          <p className="text-muted-foreground text-sm">
            {tCircles("shareDialog.empty")}
          </p>
          <Button variant="outline" asChild>
            <Link href="/circles">{tCircles("shareDialog.goToCircles")}</Link>
          </Button>
        </div>
      );
    }
    return (
      <ul className="-mx-2 flex max-h-[50vh] flex-col overflow-y-auto">
        {choices.map((circle) => {
          const viewOnly = circle.viewerPermission === "ViewOnly";
          return (
            <li key={circle._id}>
              <Button
                type="button"
                variant="ghost"
                disabled={pickedId !== null || viewOnly}
                onClick={() => void pick(circle)}
                className="h-auto min-h-11 w-full justify-start gap-3 px-2 py-2 text-left"
              >
                {circle.iconUrl ? (
                  <CircleThreadAvatar
                    members={[]}
                    iconUrl={circle.iconUrl}
                    className="size-9"
                  />
                ) : (
                  <CoverChip icon={Users} size={36} gradientIndex={0} />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{circle.name}</span>
                  <span className="text-muted-foreground truncate text-xs font-normal">
                    {viewOnly
                      ? tCircles("shareDialog.viewOnly")
                      : `${tCircles("page.memberCount", { count: circle.memberCount })} · ${tCircles(`permissions.${circle.viewerPermission}`)}`}
                  </span>
                </span>
                {pickedId === circle._id && (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                )}
              </Button>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <Dialog
      open={open}
      // Stay open while a share runs, so its outcome is never orphaned.
      onOpenChange={(next) => pickedId === null && onOpenChange(next)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { count })}</DialogDescription>
        </DialogHeader>
        {housemates > 0 && (
          <p className="bg-muted text-foreground flex items-start gap-2 rounded-md px-3 py-2 text-sm">
            <House aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t("housemates", { count: housemates })}
          </p>
        )}
        {hidden > 0 && (
          <p className="bg-muted text-foreground flex items-start gap-2 rounded-md px-3 py-2 text-sm">
            <EyeOff aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t("hidden", { count: hidden })}
          </p>
        )}
        {count > 0 && list()}
      </DialogContent>
    </Dialog>
  );
}
