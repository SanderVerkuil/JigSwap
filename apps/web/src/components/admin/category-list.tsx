"use client";

// Admin catalog categories as list rows in a single bordered container (the
// admin triage list pattern). Editing is delegated to the route via onEdit so
// the shared form can open; deactivation (the domain's soft delete) is
// handled here.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useMutation } from "convex/react";
import { Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export interface Category {
  _id: string;
  // The domain keys categories by aggregateId; legacy rows lack one until the backfill runs, so it
  // is optional and edit/deactivate are disabled when missing.
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
  categories: Category[];
  onEdit: (category: Category) => void;
}) {
  const t = useTranslations("admin.categories.list");
  // The domain soft-deactivates; there is no hard delete, so "delete" hides a node via setActive.
  const setCategoryActive = useMutation(gateway.adminCatalog.delete);

  // Soft-deactivate (the domain has no hard delete); a deactivated node is hidden, not removed.
  const handleDeactivate = async (aggregateId: string) => {
    if (confirm(t("deactivateConfirm"))) {
      try {
        await setCategoryActive({
          catalogCategoryId: aggregateId,
          isActive: false,
        });
        toast.success(t("deactivateSuccess"));
      } catch {
        toast.error(t("deactivateError"));
      }
    }
  };

  return (
    <div className="rounded-xl border bg-card">
      {categories.map((category) => (
        <div
          key={category._id}
          className="flex flex-col gap-3 border-b px-4 py-3 last:border-0"
        >
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-semibold">
                <span
                  className="h-4 w-4 shrink-0 rounded-full"
                  style={{ backgroundColor: category.color }}
                  aria-hidden
                />
                {category.name.en}
                <span className="font-normal text-muted-foreground">
                  {category.name.nl}
                </span>
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {t("sortOrder", { order: category.sortOrder })}
                </span>
                {category.isActive ? (
                  <Badge variant="default">{t("statusActive")}</Badge>
                ) : (
                  <Badge variant="secondary">{t("statusInactive")}</Badge>
                )}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {category.description?.en || t("noDescription")}
              {category.description?.nl && ` • ${category.description.nl}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEdit(category)}
              disabled={!category.aggregateId}
              className="flex items-center gap-1"
            >
              <Edit className="h-3 w-3" />
              {t("edit")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                category.aggregateId && handleDeactivate(category.aggregateId)
              }
              disabled={!category.aggregateId || !category.isActive}
              className="flex items-center gap-1 text-red-600 hover:text-red-700"
            >
              <Trash2 className="h-3 w-3" />
              {t("deactivate")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
