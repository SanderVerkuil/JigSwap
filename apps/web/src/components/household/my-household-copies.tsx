import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { gateway, Id } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { Puzzle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import {
  filterByPermission,
  selectAll,
  selectedVisibleIds,
  toggleSelected,
  type HouseholdPermission,
  type HouseholdPermissionChoice,
  type PermissionFilter,
} from "./bulk-permission";

type OwnCopy = FunctionReturnType<
  typeof gateway.household.myCopyPermissions
>[number];

// "My puzzles in this household": the viewer's OWN copies with the household permission each
// grants, with multi-select, a permission filter and a confirmed bulk change. Other members'
// copies are deliberately not listed here — only an owner can change a copy's permission, and
// those copies already show in My puzzles with the viewer's access.
export function MyHouseholdCopies({
  householdDefault,
  onError,
}: {
  householdDefault: HouseholdPermission;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations("household.bulkPermission");
  const tAccess = useTranslations("household.copyAccess");
  const tCommon = useTranslations("common");
  const [filter, setFilter] = useState<PermissionFilter>("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmTarget, setConfirmTarget] =
    useState<HouseholdPermissionChoice | null>(null);

  const { data: copies } = useQuery(
    convexQuery(gateway.household.myCopyPermissions, {}),
  );

  const setMany = useMutation({
    mutationFn: useConvexMutation(gateway.library.setHouseholdPermissions),
    onSuccess: ({
      changed,
    }: FunctionReturnType<typeof gateway.library.setHouseholdPermissions>) => {
      setSelected(new Set());
      toast.success(t("changed", { count: changed }));
    },
    onError,
  });

  if (copies === undefined) return null;

  const visible = filterByPermission(copies, filter);
  const targetIds = selectedVisibleIds(selected, visible);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-heading text-lg font-bold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("sub")}</p>
      </div>

      {copies.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={filter}
              onValueChange={(value: PermissionFilter) => setFilter(value)}
            >
              <SelectTrigger className="w-40" aria-label={t("filterLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filterAll")}</SelectItem>
                <SelectItem value="manage">{tAccess("manage")}</SelectItem>
                <SelectItem value="view">{tAccess("view")}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="ghost"
              disabled={visible.length === 0}
              onClick={() => setSelected(selectAll(visible))}
            >
              {t("selectAll")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={selected.size === 0}
              onClick={() => setSelected(new Set())}
            >
              {t("selectNone")}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-sm" aria-live="polite">
              {t("selectedCount", { count: targetIds.length })}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={targetIds.length === 0 || setMany.isPending}
              onClick={() => setConfirmTarget("manage")}
            >
              {t("setManage")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={targetIds.length === 0 || setMany.isPending}
              onClick={() => setConfirmTarget("view")}
            >
              {t("setView")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              // The longest label: let it wrap on phones instead of running off the page.
              className="h-auto min-h-8 max-w-full shrink whitespace-normal text-left"
              disabled={targetIds.length === 0 || setMany.isPending}
              onClick={() => setConfirmTarget("default")}
            >
              {t("setDefault", { permission: householdDefault })}
            </Button>
          </div>

          {visible.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noMatches")}</p>
          ) : (
            <ul className="divide-y rounded-lg border px-4">
              {visible.map((copy) => (
                <CopyRow
                  key={copy._id}
                  copy={copy}
                  checked={selected.has(copy._id)}
                  onToggle={() =>
                    setSelected((current) => toggleSelected(current, copy._id))
                  }
                  permissionLabel={tAccess(copy.householdPermission)}
                  sourceLabel={
                    copy.permissionSource === "default"
                      ? t("sourceDefault")
                      : t("sourceExplicit")
                  }
                  untitled={t("untitled")}
                  selectLabel={(title) => t("selectLabel", { title })}
                />
              ))}
            </ul>
          )}
        </>
      )}

      <AlertDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => !open && setConfirmTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("confirmTitle", { count: targetIds.length })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget === "default"
                ? t("confirmDefault", {
                    count: targetIds.length,
                    permission: householdDefault,
                  })
                : confirmTarget === "view"
                  ? t("confirmView", { count: targetIds.length })
                  : t("confirmManage", { count: targetIds.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmTarget) {
                  setMany.mutate({
                    copyIds: targetIds as Id<"ownedPuzzles">[],
                    permission: confirmTarget,
                  });
                }
                setConfirmTarget(null);
              }}
            >
              {t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function CopyRow({
  copy,
  checked,
  onToggle,
  permissionLabel,
  sourceLabel,
  untitled,
  selectLabel,
}: {
  copy: OwnCopy;
  checked: boolean;
  onToggle: () => void;
  permissionLabel: string;
  sourceLabel: string;
  untitled: string;
  selectLabel: (title: string) => string;
}) {
  const title = copy.puzzle?.title ?? copy.snapshot?.title ?? untitled;
  const thumbnail =
    copy.coverUrl ?? copy.puzzle?.images?.[0] ?? copy.snapshot?.thumbnail;
  return (
    <li className="flex items-center gap-3 py-2">
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        aria-label={selectLabel(title)}
      />
      <div className="bg-muted flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <Puzzle className="text-muted-foreground h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="text-muted-foreground text-xs">{sourceLabel}</div>
      </div>
      <Badge
        variant={copy.householdPermission === "view" ? "outline" : "secondary"}
        className="shrink-0 text-xs"
      >
        {permissionLabel}
      </Badge>
    </li>
  );
}
