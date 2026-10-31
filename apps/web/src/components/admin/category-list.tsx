"use client";

// Admin catalog categories as a drag-sortable list in a single bordered
// container; each row's menu also moves it one step (Move up / Move down) for
// pointer and keyboard users who cannot drag. Order is committed through the
// reorder mutation with an optimistic patch of the listAll subscription (the
// withOptimisticUpdate pattern — see use-favorites), so rows land instantly
// and revert automatically if the server rejects. Editing is delegated to the route via
// onEdit (the shared dialog); (de)activation — the domain's soft delete — is
// handled here, with deactivation behind an AlertDialog confirm and a success
// toast that offers Undo, and reactivation firing directly (safe direction).
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
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Flag } from "@/components/ui/flag";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { gateway } from "@/gateway";
import { locales, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Edit,
  Eye,
  EyeOff,
  GripVertical,
  MoreHorizontal,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "use-intl";
import { moveCategoryOrder } from "./category-order";

export interface Category {
  _id: string;
  // The domain keys categories by aggregateId; legacy rows lack one until the backfill runs, so it
  // is optional and edit/deactivate/drag are disabled when missing.
  aggregateId?: string;
  name: { en: string; nl: string };
  description?: { en: string; nl: string };
  color?: string;
  isActive: boolean;
  sortOrder: number;
}

export function CategoryList({
  categories,
  onEdit,
}: {
  // Already sorted by sortOrder (the route owns the subscription).
  categories: Category[];
  onEdit: (category: Category) => void;
}) {
  const t = useTranslations("admin.categories.list");
  const tCommon = useTranslations("common");
  const uiLocale = useLocale() as Locale;
  // The domain soft-deactivates; there is no hard delete, so "delete" hides a node via setActive.
  const setCategoryActive = useMutation({
    mutationFn: useConvexMutation(gateway.adminCatalog.delete),
  });
  // Optimistically renumber the listAll rows so the drop lands instantly; Convex
  // rolls the patch back if the mutation is rejected.
  const reorderCategories = useMutation({
    mutationFn: useConvexMutation(
      gateway.adminCatalog.reorder,
    ).withOptimisticUpdate((localStore, args) => {
      const current = localStore.getQuery(gateway.adminCatalog.listAll, {});
      if (current === undefined) return;
      const orders = new Map(
        args.order.map((entry) => [entry.catalogCategoryId, entry.sortOrder]),
      );
      localStore.setQuery(
        gateway.adminCatalog.listAll,
        {},
        current.map((row) =>
          row.aggregateId !== undefined && orders.has(row.aggregateId)
            ? { ...row, sortOrder: orders.get(row.aggregateId)! }
            : row,
        ),
      );
    }),
  });

  // The category awaiting the destructive deactivate confirm.
  const [confirming, setConfirming] = useState<Category | null>(null);
  // Per-row busy state derived from the in-flight mutation's variables (the
  // trades.tsx idiom) instead of a manual keyed flag — busy-state rule v2.
  const busyId = setCategoryActive.isPending
    ? (setCategoryActive.variables?.catalogCategoryId ?? null)
    : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Drag-and-drop and the row menu's Move up / Move down share one
  // renumbering (moveCategoryOrder) and the same optimistic mutation.
  const move = async (from: number, to: number) => {
    const order = moveCategoryOrder(categories, from, to);
    if (!order) return;
    try {
      await reorderCategories.mutateAsync({ order });
    } catch {
      toast.error(t("reorderError"));
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = categories.findIndex((c) => c._id === active.id);
    const newIndex = categories.findIndex((c) => c._id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    void move(oldIndex, newIndex);
  };

  const reactivate = (category: Category) =>
    setActive(category, true, {
      success: t("reactivateSuccess"),
      error: t("reactivateError"),
    });

  const setActive = async (
    category: Category,
    isActive: boolean,
    messages: { success: string; error: string },
  ) => {
    if (!category.aggregateId) return;
    try {
      await setCategoryActive.mutateAsync({
        catalogCategoryId: category.aggregateId,
        isActive,
      });
      // Deactivating is reversible, so its toast offers Undo (reactivate).
      if (isActive) toast.success(messages.success);
      else {
        toast.success(messages.success, {
          action: {
            label: t("undo"),
            onClick: () => void reactivate(category),
          },
        });
      }
    } catch {
      toast.error(messages.error);
    }
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={categories.map((category) => category._id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="@container rounded-xl border bg-card">
            {categories.map((category, index) => (
              <CategoryRow
                key={category._id}
                category={category}
                // The mutation is keyed by aggregateId (its catalogCategoryId arg).
                busy={busyId !== null && busyId === category.aggregateId}
                onEdit={() => onEdit(category)}
                onDeactivate={() => setConfirming(category)}
                onReactivate={() => void reactivate(category)}
                onMoveUp={
                  index > 0 ? () => void move(index, index - 1) : undefined
                }
                onMoveDown={
                  index < categories.length - 1
                    ? () => void move(index, index + 1)
                    : undefined
                }
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("deactivateConfirmTitle", {
                name: confirming?.name[uiLocale] ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("deactivateConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (confirming) {
                  void setActive(confirming, false, {
                    success: t("deactivateSuccess"),
                    error: t("deactivateError"),
                  });
                }
                setConfirming(null);
              }}
            >
              {t("deactivate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CategoryRow({
  category,
  busy,
  onEdit,
  onDeactivate,
  onReactivate,
  onMoveUp,
  onMoveDown,
}: {
  category: Category;
  busy: boolean;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  // Undefined at the ends of the list.
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const t = useTranslations("admin.categories.list");
  const tField = useTranslations("forms.translatable-field");
  const uiLocale = useLocale() as Locale;
  // The row shows the current UI locale; the other locales collapse into small
  // flags whose tooltips (on hover and on keyboard focus) carry the
  // translation. A missing translation is a visible badge on every row —
  // visible gaps are the point of an admin QA surface.
  const otherLocales = locales.filter((locale) => locale !== uiLocale);
  const translationOf = (locale: Locale) => category.name[locale]?.trim();
  // A legacy row may lack the UI locale's name; show another one rather than
  // a blank row (the missing badge says which one is absent).
  const name =
    translationOf(uiLocale) ||
    otherLocales.map(translationOf).find(Boolean) ||
    "";
  // Legacy rows without an aggregateId cannot be reordered (or edited) via the domain API.
  const sortable = category.aggregateId !== undefined;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category._id, disabled: !sortable });

  // In a list narrower than @2xl (672px: phones, and tablets beside the
  // sidebar) the actions wrap onto their own full-width line under the name,
  // so a long (Dutch) name and the button labels never compete for one row.
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-0 @2xl:flex-nowrap",
        !category.isActive && "opacity-60",
        isDragging && "relative z-10 bg-accent shadow-sm",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={!sortable}
        aria-label={t("dragHandle", { name })}
        // 44px hit area on touch widths (36px from md) around the 16px glyph.
        className="-mx-3 flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-40 md:-mx-2.5 md:size-9"
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      <span
        className="h-9 w-9 shrink-0 rounded-lg border"
        style={{ backgroundColor: category.color }}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 font-semibold break-words">{name}</span>
          {otherLocales.map((locale) => {
            const translation = translationOf(locale);
            if (!translation) return null;
            const tooltip = t("translationTooltip", {
              language: tField(`locales.${locale}`),
              value: translation,
            });
            // A focusable trigger, so the tooltip also opens on keyboard focus.
            return (
              <Tooltip key={locale}>
                <TooltipTrigger
                  type="button"
                  aria-label={tooltip}
                  className="inline-flex rounded-sm opacity-50 outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Flag locale={locale} className="h-2.5 w-3.5" />
                </TooltipTrigger>
                <TooltipContent>{tooltip}</TooltipContent>
              </Tooltip>
            );
          })}
          {locales
            .filter((locale) => !translationOf(locale))
            .map((locale) => (
              <Badge
                key={locale}
                variant="outline"
                className="gap-1 border-jigsaw-warning/60"
              >
                <Flag locale={locale} className="h-2.5 w-3.5" />
                {t("missingTranslation", {
                  language: tField(`locales.${locale}`),
                })}
              </Badge>
            ))}
          {!category.isActive && (
            <Badge variant="secondary">{t("statusInactive")}</Badge>
          )}
        </div>
        {category.description?.[uiLocale] && (
          <p className="truncate text-sm text-muted-foreground">
            {category.description[uiLocale]}
          </p>
        )}
      </div>
      <div className="flex w-full shrink-0 items-center justify-end gap-2 @2xl:w-auto">
        <Button
          size="sm"
          variant="outline"
          onClick={onEdit}
          disabled={!sortable || busy}
          className="flex h-11 items-center gap-1 md:h-8"
        >
          <Edit className="h-3 w-3" />
          {t("edit")}
        </Button>
        {category.isActive ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onDeactivate}
            disabled={!sortable || busy}
            className="flex h-11 items-center gap-1 text-destructive hover:text-destructive md:h-8"
          >
            <EyeOff className="h-3 w-3" />
            {t("deactivate")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={onReactivate}
            disabled={!sortable || busy}
            className="flex h-11 items-center gap-1 md:h-8"
          >
            <Eye className="h-3 w-3" />
            {t("reactivate")}
          </Button>
        )}
        {/* A single-pointer and keyboard alternative to dragging the grip. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              disabled={!sortable}
              aria-label={t("moreActions", { name })}
              className="size-11 md:size-8"
            >
              <MoreHorizontal aria-hidden className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!onMoveUp} onSelect={onMoveUp}>
              <ArrowUp aria-hidden />
              {t("moveUp")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!onMoveDown} onSelect={onMoveDown}>
              <ArrowDown aria-hidden />
              {t("moveDown")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
