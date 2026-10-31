// "Share with circles…" for one of your own copies (the copy page and the card ⋯ menu): your
// circles, ticked where the copy is shared, saved together. A seat that may not share (View only)
// can't tick a circle, but an existing share there can still be taken back. The dialog warns when
// circle members won't see the copy even once shared (not offered, or private). The server is
// the gate (owner only; getCopyCircleShares answers null for anyone else).
import { Link } from "@/compat/link";
import {
  circleHiddenReason,
  circleShareErrorKey,
  stagedChanges,
  toggleStaged,
  type StagedShares,
} from "@/components/circles/circle-share";
import { CoverChip } from "@/components/community/primitives";
import { CircleThreadAvatar } from "@/components/messaging/circle-thread-avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EyeOff, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export interface ShareWithCirclesCopy {
  // The Library CopyId (aggregateId).
  copyId: string;
  title: string;
  // For the "members won't see it" warning; left out when unknown.
  availability?: { forTrade: boolean; forSale: boolean; forLend: boolean };
  visibility?: "private" | "visible";
}

export function ShareWithCirclesDialog({
  copy,
  open,
  onOpenChange,
}: {
  copy: ShareWithCirclesCopy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("circles");
  const tCommon = useTranslations("common");
  const [staged, setStaged] = useState<StagedShares>(new Map());

  const circles = useQuery(
    convexQuery(
      gateway.sharing.copyCircleShares,
      open ? { copyId: copy.copyId } : "skip",
    ),
  );
  const share = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.shareCopiesToCircle),
  });
  const unshare = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.unshareCopyFromCircle),
  });
  const busy = share.isPending || unshare.isPending;
  const { adds, removes } = stagedChanges(staged);
  const rows = circles.data ?? [];
  const hidden = copy.availability
    ? circleHiddenReason({
        availability: copy.availability,
        visibility: copy.visibility,
      })
    : null;

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) setStaged(new Map());
    onOpenChange(next);
  };

  // Drop a saved tick: the reactive read now shows it.
  const settle = (circleId: string) =>
    setStaged((current) => {
      const next = new Map(current);
      next.delete(circleId);
      return next;
    });

  const save = async () => {
    const sharedAfter = rows.filter(
      (row) => staged.get(row.circleId) ?? row.shared,
    ).length;
    try {
      for (const circleId of adds) {
        await share.mutateAsync({ circleId, copyIds: [copy.copyId] });
        settle(circleId);
      }
      for (const circleId of removes) {
        await unshare.mutateAsync({ circleId, copyId: copy.copyId });
        settle(circleId);
      }
      toast.success(
        t("shareDialog.savedToast", { title: copy.title, count: sharedAfter }),
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(t(circleShareErrorKey(error)));
    }
  };

  let body: ReactNode;
  if (circles.isError || circles.data === null) {
    body = (
      <p className="text-muted-foreground text-sm">
        {t("shareDialog.loadError")}
      </p>
    );
  } else if (circles.data === undefined) {
    body = <Skeleton className="h-24 w-full" />;
  } else if (rows.length === 0) {
    body = (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed px-4 py-3">
        <p className="text-muted-foreground text-sm">
          {t("shareDialog.empty")}
        </p>
        <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
          <Link href="/circles">{t("shareDialog.goToCircles")}</Link>
        </Button>
      </div>
    );
  } else {
    body = (
      <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
        {rows.map((row) => {
          const checked = staged.get(row.circleId) ?? row.shared;
          // A View only seat can't add a share; taking one back is always allowed.
          const locked = !row.canShare && !row.shared;
          const inputId = `share-circle-${row.circleId}`;
          return (
            <li key={row.circleId}>
              <label
                htmlFor={inputId}
                className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 has-[:disabled]:cursor-not-allowed"
              >
                <Checkbox
                  id={inputId}
                  aria-labelledby={`${inputId}-name`}
                  aria-describedby={`${inputId}-meta`}
                  checked={checked}
                  disabled={busy || locked}
                  onCheckedChange={() =>
                    setStaged((current) =>
                      toggleStaged(current, row.circleId, row.shared),
                    )
                  }
                />
                {row.iconUrl ? (
                  <CircleThreadAvatar
                    members={[]}
                    iconUrl={row.iconUrl}
                    className="size-9"
                  />
                ) : (
                  <CoverChip icon={Users} size={36} gradientIndex={0} />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    id={`${inputId}-name`}
                    className="truncate text-sm font-medium"
                  >
                    {row.name}
                  </span>
                  <span
                    id={`${inputId}-meta`}
                    className="text-muted-foreground text-xs"
                  >
                    {locked
                      ? t("shareDialog.viewOnly")
                      : `${t("page.memberCount", { count: row.memberCount })} · ${t(`permissions.${row.viewerPermission}`)}`}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("shareDialog.title", { title: copy.title })}
          </DialogTitle>
          <DialogDescription>{t("shareDialog.description")}</DialogDescription>
        </DialogHeader>
        {hidden && (
          <p className="bg-muted text-foreground flex items-start gap-2 rounded-md px-3 py-2 text-sm">
            <EyeOff aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t(`shareDialog.${hidden}`)}
          </p>
        )}
        {body}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => close(false)}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={busy || (adds.length === 0 && removes.length === 0)}
            onClick={() => void save()}
          >
            {busy ? t("share.saving") : t("shareDialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
