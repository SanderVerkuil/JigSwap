import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { CategoryDialog } from "@/components/admin/category-dialog";
import { CategoryList, type Category } from "@/components/admin/category-list";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Plus, Shapes } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/admin/categories")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminCategories") }],
  }),
  pendingComponent: () => <CategoriesPending />,
  component: CategoriesPage,
});

function CategoriesPending() {
  const t = useTranslations("admin.categories");
  return <PageLoading message={t("loading")} />;
}

// Admin CRUD for catalog categories. The page title/subtitle come from the
// shell page head (ROUTE_META), so the route renders only the "Add category"
// action row over the sortable list; the create/edit dialog state lives here,
// while the dialog and the list own their own mutations.
type DialogState = { mode: "create" } | { mode: "edit"; category: Category };

function CategoriesPage() {
  const t = useTranslations("admin.categories");
  const { data: categories } = useQuery(
    convexQuery(gateway.adminCatalog.listAll, {}),
  );

  const [dialog, setDialog] = useState<DialogState | null>(null);

  // listAll returns creation order; the list renders (and drags) sortOrder.
  const sorted = useMemo(
    () =>
      categories
        ? [...categories].sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    [categories],
  );
  // A created category is appended after the current last one.
  const nextSortOrder =
    sorted.length > 0 ? Math.max(...sorted.map((c) => c.sortOrder)) + 1 : 0;

  // The Add button lives in the shell page header (desktop head + mobile
  // actions row), like the collections page — the list keeps the full width.
  usePageHeaderActions(
    () => (
      <Button
        variant="brand"
        size="sm"
        onClick={() => setDialog({ mode: "create" })}
      >
        <Plus className="h-4 w-4" />
        {t("add")}
      </Button>
    ),
    [t],
  );

  if (categories === undefined) {
    return <PageLoading message={t("loading")} />;
  }

  return (
    <div className="space-y-6">
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
          <Shapes className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-semibold">{t("empty.title")}</p>
          <p className="text-sm text-muted-foreground">
            {t("empty.description")}
          </p>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => setDialog({ mode: "create" })}
          >
            <Plus className="h-4 w-4" />
            {t("add")}
          </Button>
        </div>
      ) : (
        <>
          <CategoryList
            categories={sorted}
            onEdit={(category) => {
              if (!category.aggregateId) return; // un-backfilled legacy row: not editable via the domain API
              setDialog({ mode: "edit", category });
            }}
          />
        </>
      )}

      <CategoryDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        category={dialog?.mode === "edit" ? dialog.category : undefined}
        nextSortOrder={nextSortOrder}
      />
    </div>
  );
}
