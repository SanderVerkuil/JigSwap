"use client";

// Admin catalog categories as a drag-sortable list in a single bordered
// container. Order is committed through the reorder mutation with an
// optimistic patch of the listAll subscription (the withOptimisticUpdate
// pattern — see use-favorites), so rows land instantly and revert
// automatically if the server rejects. Editing is delegated to the route via
// onEdit (the shared dialog); (de)activation — the domain's soft delete — is
// handled here, with deactivation behind an AlertDialog confirm and
// reactivation firing directly (safe direction).

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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation } from "@tanstack/react-query";
import { Edit, Eye, EyeOff, GripVertical } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "use-intl";

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

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = categories.findIndex((c) => c._id === active.id);
    const newIndex = categories.findIndex((c) => c._id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    // Renumber the full new order; legacy rows without an aggregateId cannot be
    // addressed by the domain, so they are skipped (they are not draggable).
    const order = arrayMove(categories, oldIndex, newIndex)
      .map((category, index) => ({ category, index }))
      .filter(({ category }) => category.aggregateId !== undefined)
      .map(({ category, index }) => ({
        catalogCategoryId: category.aggregateId!,
        sortOrder: index,
      }));
    try {
      await reorderCategories.mutateAsync({ order });
    } catch {
      toast.error(t("reorderError"));
    }
  };

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
      toast.success(messages.success);
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
          <div className="rounded-xl border bg-card">
            {categories.map((category) => (
              <CategoryRow
                key={category._id}
                category={category}
                // The mutation is keyed by aggregateId (its catalogCategoryId arg).
                busy={busyId !== null && busyId === category.aggregateId}
                onEdit={() => onEdit(category)}
                onDeactivate={() => setConfirming(category)}
                onReactivate={() =>
                  setActive(category, true, {
                    success: t("reactivateSuccess"),
                    error: t("reactivateError"),
                  })
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
}: {
  category: Category;
  busy: boolean;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}) {
  const t = useTranslations("admin.categories.list");
  const tField = useTranslations("forms.translatable-field");
  const uiLocale = useLocale() as Locale;
  // The row shows the current UI locale; the other locales collapse into small
  // flags whose tooltips carry the translation (or expose the gap — visible
  // gaps are the point of an admin QA surface).
  const otherLocales = locales.filter((locale) => locale !== uiLocale);
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

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-3 border-b px-4 py-3 last:border-0",
        !category.isActive && "opacity-60",
        isDragging && "relative z-10 bg-accent shadow-sm",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={!sortable}
        aria-label={t("dragHandle", { name: category.name[uiLocale] })}
        className="shrink-0 cursor-grab touch-none rounded text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-40"
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
          <span className="font-semibold">{category.name[uiLocale]}</span>
          {otherLocales.map((locale) => {
            const translation = category.name[locale]?.trim();
            const tooltip = translation
              ? t("translationTooltip", {
                  language: tField(`locales.${locale}`),
                  value: translation,
                })
              : t("missingTranslationTooltip", {
                  language: tField(`locales.${locale}`),
                });
            return (
              <Tooltip key={locale}>
                <TooltipTrigger asChild>
                  <span
                    aria-label={tooltip}
                    className={cn(
                      "inline-flex",
                      translation
                        ? "opacity-50 hover:opacity-100"
                        : "opacity-25",
                    )}
                  >
                    <Flag locale={locale} className="h-2.5 w-3.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{tooltip}</TooltipContent>
              </Tooltip>
            );
          })}
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
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onEdit}
          disabled={!sortable || busy}
          className="flex items-center gap-1"
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
            className="flex items-center gap-1 text-destructive hover:text-destructive"
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
            className="flex items-center gap-1"
          >
            <Eye className="h-3 w-3" />
            {t("reactivate")}
          </Button>
        )}
      </div>
    </div>
  );
}
