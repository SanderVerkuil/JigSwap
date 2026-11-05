"use client";

import { Link } from "@/compat/link";
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
import type { CollectionView } from "@jigswap/contracts";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

// Pick the collection a bulk "Add to collection" puts the selected puzzles in. Lists the member's
// own collections (a wishlist holds wished puzzles, not copies, so it isn't offered). Picking one
// runs `onPick`; the dialog stays open, its choices disabled, until that has finished.
export function AddToCollectionDialog({
  open,
  onOpenChange,
  count,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // How many selected puzzles the add covers.
  count: number;
  onPick: (collection: CollectionView) => Promise<void>;
}) {
  const t = useTranslations("puzzles.bulk.collection");
  const { data: collections } = useQuery(
    convexQuery(gateway.collections.listForUser, open ? {} : "skip"),
  );
  const [pickedId, setPickedId] = useState<string | null>(null);
  const choices = (collections ?? []).filter((c) => !c.isWishlist);

  const pick = async (collection: CollectionView) => {
    setPickedId(collection._id);
    try {
      await onPick(collection);
      onOpenChange(false);
    } finally {
      setPickedId(null);
    }
  };

  return (
    <Dialog
      open={open}
      // Stay open while an add runs, so its outcome is never orphaned.
      onOpenChange={(next) => pickedId === null && onOpenChange(next)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { count })}</DialogDescription>
        </DialogHeader>
        {collections === undefined ? (
          <Loader2
            className="text-muted-foreground mx-auto size-5 animate-spin"
            aria-hidden
          />
        ) : choices.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted-foreground text-sm">{t("none")}</p>
            <Button variant="outline" asChild>
              <Link href="/collections">
                <Plus aria-hidden />
                {t("create")}
              </Link>
            </Button>
          </div>
        ) : (
          <ul className="-mx-2 flex max-h-[50vh] flex-col overflow-y-auto">
            {choices.map((collection) => (
              <li key={collection._id}>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pickedId !== null}
                  onClick={() => void pick(collection)}
                  className="h-auto min-h-11 w-full justify-start gap-3 px-2 py-2 text-left"
                >
                  <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-sm"
                    style={{
                      backgroundColor: `${collection.color ?? "#64748b"}20`,
                      color: collection.color,
                    }}
                  >
                    {collection.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {collection.name}
                  </span>
                  {pickedId === collection._id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {collection.puzzleCount}
                    </span>
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
