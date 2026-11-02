import { PickerCapNote } from "@/components/library/picker-cap-note";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { ChevronDown, Puzzle, X } from "lucide-react";
import { useRef, useState } from "react";
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
//
// Above the list sit only the filter and Select all. The count and the bulk change live in a
// selection bar that exists only while something is selected (see SelectionBar).
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
  // Clearing the selection removes the bar; focus then goes back to Select all, not the page body.
  const selectAllRef = useRef<HTMLButtonElement>(null);
  // Set by the confirm dialog's action, so closing it moves focus to Select all (onCloseAutoFocus).
  const confirmedRef = useRef(false);

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
              ref={selectAllRef}
              size="sm"
              variant="ghost"
              disabled={visible.length === 0}
              onClick={() => setSelected(selectAll(visible))}
            >
              {t("selectAll")}
            </Button>
          </div>
          <PickerCapNote shown={copies.length} />

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

          {/* Always mounted, so screen readers hear the count change as boxes are ticked. */}
          <p role="status" className="sr-only">
            {targetIds.length > 0
              ? t("selectedCount", { count: targetIds.length })
              : ""}
          </p>
          {targetIds.length > 0 && (
            <SelectionBar
              count={targetIds.length}
              householdDefault={householdDefault}
              busy={setMany.isPending}
              onChoose={setConfirmTarget}
              onClear={() => {
                setSelected(new Set());
                selectAllRef.current?.focus();
              }}
            />
          )}
        </>
      )}

      <AlertDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => !open && setConfirmTarget(null)}
      >
        <AlertDialogContent
          // After a confirmed change the bar goes away with the selection: focus Select all
          // instead of returning it to the bar's (soon gone) trigger. Cancel returns it there.
          onCloseAutoFocus={(event) => {
            if (!confirmedRef.current) return;
            confirmedRef.current = false;
            event.preventDefault();
            selectAllRef.current?.focus();
          }}
        >
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
                  confirmedRef.current = true;
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

// The count and the bulk change, shown only while something is selected. It sits after the list,
// so ticking the first box never pushes the rows down, and sticks to the bottom of the screen
// while the list runs past it: on phones just above the tab bar (57px = its 56px row + 1px border,
// keep in sync with MobileTabBar; the 34px padding clears the raised "+", as InstallAppTip does),
// from md near the bottom of the page card. One "Set access" menu instead of three buttons keeps
// it a single row on a 390px phone in English and Dutch.
function SelectionBar({
  count,
  householdDefault,
  busy,
  onChoose,
  onClear,
}: {
  count: number;
  householdDefault: HouseholdPermission;
  busy: boolean;
  onChoose: (choice: HouseholdPermissionChoice) => void;
  onClear: () => void;
}) {
  const t = useTranslations("household.bulkPermission");
  const tAccess = useTranslations("household.copyAccess");
  return (
    <div className="pointer-events-none sticky bottom-[57px] z-20 pb-[34px] md:bottom-4 md:pb-0">
      {/* On a narrower screen the menu button wraps to a row of its own rather than truncating
          the count. */}
      <div className="bg-card pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border p-2 shadow-lg md:w-fit">
        <Button
          size="icon"
          variant="ghost"
          className="pointer-coarse:size-11 shrink-0"
          aria-label={t("clearSelection")}
          onClick={onClear}
        >
          <X aria-hidden />
        </Button>
        {/* The sr-only status above announces the count; this is its visible twin. */}
        <span
          aria-hidden
          className="flex-1 text-sm font-medium whitespace-nowrap md:pr-2"
        >
          {t("selectedCount", { count })}
        </span>
        {/* Non-modal: a modal menu locks the page scroll, and on phones that drops this sticky bar
            back into the flow under the finger, so lifting it picked whichever item slid there. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              className="pointer-coarse:min-h-11 ml-auto shrink-0"
              disabled={busy}
            >
              {t("setAccess")}
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
            <DropdownMenuItem onSelect={() => onChoose("manage")}>
              {tAccess("manage")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onChoose("view")}>
              {tAccess("view")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onChoose("default")}>
              {tAccess("useDefault", { permission: householdDefault })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
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
  const thumbnail = copy.coverUrl ?? copy.puzzle?.images?.[0];
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
        {/* Two lines, not one: touch has no tooltip, and similar titles must stay tellable apart
            before a bulk change. */}
        <div className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]">
          {title}
        </div>
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
