"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { gateway, Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { ArrowDown, ArrowUp, Check, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

type OwnedCopy = FunctionReturnType<
  typeof gateway.library.ownedByOwner
>[number];

const MAX_FEATURED = 6;

// Owner-only dialog for curating the profile shelf. Presents a scrollable grid
// of all owned copies as toggle buttons (aria-pressed); selected copies appear
// in an ordered list with Move-up / Move-down / Remove controls. Save calls the
// arrangeShelf mutation; Convex reactivity refreshes the shelf automatically.
//
// Accessibility: real <button>s throughout, aria-pressed for toggles, focus trap
// provided by the Radix Dialog primitive. No drag-and-drop library.
export function ArrangeShelfDialog({
  ownerId,
  currentFeaturedIds,
  onClose,
}: {
  ownerId: Id<"users">;
  currentFeaturedIds: Id<"ownedPuzzles">[];
  onClose: () => void;
}) {
  const t = useTranslations("profile.shelf.arrangeDialog");

  const { data: copies } = useQuery(
    convexQuery(gateway.library.ownedByOwner, {
      ownerId,
      includeUnavailable: true,
    }),
  );

  const arrange = useMutation({
    mutationFn: useConvexMutation(gateway.social.arrangeShelf),
  });

  // Selected copy ids in display order (the arrangement).
  const [selected, setSelected] = useState<Id<"ownedPuzzles">[]>(
    () => currentFeaturedIds,
  );

  // Build a lookup for quick title resolution.
  const copyMap = useMemo(() => {
    const m = new Map<Id<"ownedPuzzles">, OwnedCopy>();
    for (const c of copies ?? []) {
      m.set(c._id as Id<"ownedPuzzles">, c);
    }
    return m;
  }, [copies]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const atMax = selected.length >= MAX_FEATURED;

  function handleToggle(copyId: Id<"ownedPuzzles">) {
    setSelected((prev) => {
      if (prev.includes(copyId)) {
        return prev.filter((id) => id !== copyId);
      }
      if (prev.length >= MAX_FEATURED) return prev; // guard (button also disabled)
      return [...prev, copyId];
    });
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    setSelected((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function handleMoveDown(index: number) {
    setSelected((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  function handleRemove(copyId: Id<"ownedPuzzles">) {
    setSelected((prev) => prev.filter((id) => id !== copyId));
  }

  async function handleSave() {
    try {
      await arrange.mutateAsync({ copyIds: selected });
      toast.success(t("saved"));
      onClose();
    } catch {
      toast.error(t("saveError"));
    }
  }

  function copyTitle(copy: OwnedCopy): string {
    return copy.puzzle?.title ?? copy.snapshot?.title ?? t("untitled");
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { max: MAX_FEATURED })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-4">
          {/* Toggle grid: all owned copies */}
          {copies === undefined ? (
            <p className="text-muted-foreground text-sm">{t("loading")}</p>
          ) : copies.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noCopies")}</p>
          ) : (
            <div>
              <p className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wide">
                {t("pickSection")}
              </p>
              {atMax && (
                <p className="text-muted-foreground mb-3 text-sm">
                  {t("maxHint", { max: MAX_FEATURED })}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {copies.map((copy) => {
                  const id = copy._id as Id<"ownedPuzzles">;
                  const isSelected = selectedSet.has(id);
                  const isDisabled = !isSelected && atMax;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={isSelected}
                      disabled={isDisabled}
                      onClick={() => handleToggle(id)}
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                        isSelected
                          ? "border-primary bg-primary/10 text-primary"
                          : "hover:bg-accent border-transparent bg-muted",
                        isDisabled && "cursor-not-allowed opacity-40",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground",
                        )}
                        aria-hidden
                      >
                        {isSelected && <Check className="size-3" />}
                      </span>
                      <span className="min-w-0 truncate">
                        {copyTitle(copy)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Ordered selection list */}
          {selected.length > 0 && (
            <div>
              <p className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wide">
                {t("orderSection", {
                  count: selected.length,
                  max: MAX_FEATURED,
                })}
              </p>
              <ol className="flex flex-col gap-1.5">
                {selected.map((copyId, index) => {
                  const copy = copyMap.get(copyId);
                  const title = copy ? copyTitle(copy) : copyId;
                  return (
                    <li
                      key={copyId}
                      className="bg-muted flex items-center gap-2 rounded-md px-3 py-2 text-sm"
                    >
                      <span className="text-muted-foreground w-5 shrink-0 text-xs tabular-nums">
                        {index + 1}.
                      </span>
                      <span className="min-w-0 flex-1 truncate">{title}</span>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={t("moveUp")}
                          disabled={index === 0}
                          onClick={() => handleMoveUp(index)}
                        >
                          <ArrowUp className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={t("moveDown")}
                          disabled={index === selected.length - 1}
                          onClick={() => handleMoveDown(index)}
                        >
                          <ArrowDown className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={t("remove")}
                          onClick={() => handleRemove(copyId)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={arrange.isPending}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={arrange.isPending}
          >
            {arrange.isPending ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
