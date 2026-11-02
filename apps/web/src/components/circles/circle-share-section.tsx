// "Share your puzzles": a searchable list of your own copies, ticked where the copy is shared
// into this circle. Tick to share, untick to stop sharing, then save the changes in one go. Rows
// say when members won't see a copy even once shared (not offered, or private). Shown to members
// whose seat may share (Exchange or Admin, read live from viewerPermission); the server enforces
// the same rule and that every copy is yours. Used in the manage dialog and on the circle page.
import {
  chunked,
  circleHiddenReason,
  circleShareErrorKey,
  SHARE_BATCH_SIZE,
  stagedChanges,
  toggleStaged,
  type StagedShares,
} from "@/components/circles/circle-share";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { defaultFilter } from "cmdk";
import { CheckIcon, EyeOff } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// A row's value is the copy's id, which cmdk needs to tell same-titled copies apart. Its default
// filter would also fuzzy-match that hidden id, so a search for "1000" kept unrelated rows: only
// the title (the item's keywords) counts.
const matchTitle = (_id: string, search: string, title?: string[]) =>
  defaultFilter(title?.join(" ") ?? "", search);

export function CircleShareSection({
  circleId,
  circleName,
  memberId,
}: {
  circleId: string;
  circleName: string;
  // The viewer's Convex member id; the copy list waits until it is known.
  memberId: string | undefined;
}) {
  const t = useTranslations("circles");
  const [staged, setStaged] = useState<StagedShares>(new Map());

  // The lean library index: a row needs its title and offer state, never a cover. It also lists
  // housemates' copies, which can't be shared.
  const copies = useQuery(
    convexQuery(gateway.library.myLibraryIndex, memberId ? {} : "skip"),
  );
  const shareState = useQuery(
    convexQuery(gateway.sharing.myCircleShareState, { circleId }),
  );
  const share = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.shareCopiesToCircle),
  });
  const unshare = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.unshareCopyFromCircle),
  });

  const sharedIds = useMemo(
    () => new Set(shareState.data ?? []),
    [shareState.data],
  );
  const { adds, removes } = stagedChanges(staged);
  const busy = share.isPending || unshare.isPending;

  // Drop what was saved from the staged ticks: the reactive share state now shows it.
  const settle = (ids: readonly string[]) =>
    setStaged((current) => {
      const next = new Map(current);
      for (const id of ids) next.delete(id);
      return next;
    });

  const save = async () => {
    try {
      for (const batch of chunked(adds, SHARE_BATCH_SIZE)) {
        await share.mutateAsync({ circleId, copyIds: batch });
        settle(batch);
      }
      if (adds.length > 0) {
        toast.success(
          t("share.sharedToast", { count: adds.length, circle: circleName }),
        );
      }
      for (const copyId of removes) {
        await unshare.mutateAsync({ circleId, copyId });
        settle([copyId]);
      }
      if (removes.length > 0) {
        toast.success(
          t("share.unsharedToast", {
            count: removes.length,
            circle: circleName,
          }),
        );
      }
    } catch (error) {
      toast.error(t(circleShareErrorKey(error)));
    }
  };

  const saveLabel =
    adds.length > 0 && removes.length > 0
      ? t("share.saveChanges")
      : adds.length > 0
        ? t("share.shareCount", { count: adds.length })
        : t("share.unshareCount", { count: removes.length });

  // Legacy rows without an aggregate id can't be shared.
  const shareable = (copies.data ?? []).flatMap((copy) =>
    copy.aggregateId && !copy.viewerAccess
      ? [{ ...copy, aggregateId: copy.aggregateId }]
      : [],
  );

  let body: ReactNode;
  if (copies.isError || shareState.isError) {
    body = (
      <p className="text-muted-foreground text-sm">{t("share.loadError")}</p>
    );
  } else if (copies.data === undefined || shareState.data === undefined) {
    body = <Skeleton className="h-24 w-full" />;
  } else if (shareable.length === 0) {
    body = (
      <p className="text-muted-foreground text-sm">{t("share.noCopies")}</p>
    );
  } else {
    body = (
      // cmdk keeps one row highlighted for the keyboard; while the list has no focus that
      // highlight would read as a selection, so it only shows on focus or hover.
      <Command
        filter={matchTitle}
        className="rounded-lg border [&:not(:focus-within)_[data-selected=true]:not(:hover)]:bg-transparent [&:not(:focus-within)_[data-selected=true]:not(:hover)]:text-foreground"
      >
        <CommandInput
          placeholder={t("share.searchPlaceholder")}
          aria-label={t("share.searchPlaceholder")}
        />
        <CommandList className="max-h-72">
          <CommandEmpty>{t("share.noMatches")}</CommandEmpty>
          <CommandGroup>
            {shareable.map((copy) => {
              const id = copy.aggregateId;
              const title =
                copy.puzzle?.title ??
                copy.snapshot?.title ??
                t("manage.copyFallback");
              const sharedNow = sharedIds.has(id);
              const checked = staged.get(id) ?? sharedNow;
              const hidden = circleHiddenReason(copy);
              // What the row is now, or what saving will do to it.
              const status =
                checked === sharedNow
                  ? sharedNow
                    ? "shared"
                    : null
                  : checked
                    ? "willShare"
                    : "willUnshare";
              return (
                <CommandItem
                  key={id}
                  value={id}
                  keywords={[title]}
                  disabled={busy}
                  aria-checked={checked}
                  onSelect={() =>
                    setStaged((current) => toggleStaged(current, id, sharedNow))
                  }
                  // A row with a status line keeps its box on the title's line.
                  className={cn(
                    "min-h-11 gap-3 py-2",
                    status || hidden ? "items-start" : "items-center",
                  )}
                >
                  <span
                    aria-hidden
                    data-state={checked ? "checked" : "unchecked"}
                    className={cn(
                      "border-input flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs",
                      (status || hidden) && "mt-0.5",
                      checked &&
                        "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {checked && <CheckIcon className="size-3.5 text-current" />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate">{title}</span>
                    {(status || hidden) && (
                      <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        {status && (
                          <span className="text-foreground font-medium">
                            {t(`share.${status}`)}
                          </span>
                        )}
                        {hidden && (
                          <span className="inline-flex items-center gap-1">
                            <EyeOff aria-hidden className="size-3" />
                            {t(`share.${hidden}`)}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    );
  }

  return (
    // Inline-size containment: a long title truncates instead of widening a grid parent such
    // as the manage dialog.
    <section className="space-y-3 contain-inline-size">
      <h3 className="font-medium">{t("manage.shareCopy")}</h3>
      <p className="text-xs text-muted-foreground">
        {t("manage.shareDescription")}
      </p>
      {body}
      {(adds.length > 0 || removes.length > 0) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-11 md:h-8"
            disabled={busy}
            onClick={() => setStaged(new Map())}
          >
            {t("share.clear")}
          </Button>
          <Button
            size="sm"
            className="h-11 md:h-8"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? t("share.saving") : saveLabel}
          </Button>
        </div>
      )}
    </section>
  );
}
