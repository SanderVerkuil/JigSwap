import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { CategoryForm } from "@/components/admin/category-form";
import { CategoryList, type Category } from "@/components/admin/category-list";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState } from "react";
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

// Admin CRUD for catalog categories. The route only wires the listing query
// and the state shared between the form and the list (create mode + which
// category is being edited); the form and list own their own mutations.
function CategoriesPage() {
  const t = useTranslations("admin.categories");
  const categories = useQuery(gateway.adminCatalog.listAll);

  const [isCreating, setIsCreating] = useState(false);
  // The category being edited; doubles as the form's initial values.
  const [editing, setEditing] = useState<Category | null>(null);

  const closeForm = () => {
    setIsCreating(false);
    setEditing(null);
  };

  if (categories === undefined) {
    return <PageLoading message={t("loading")} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          {t("add")}
        </Button>
      </div>

      {(isCreating || editing) && (
        <CategoryForm
          key={editing?.aggregateId ?? "create"}
          initial={editing ?? undefined}
          onSaved={closeForm}
          onCancel={closeForm}
        />
      )}

      <CategoryList
        categories={categories}
        onEdit={(category) => {
          if (!category.aggregateId) return; // un-backfilled legacy row: not editable via the domain API
          setEditing(category);
        }}
      />
    </div>
  );
}
