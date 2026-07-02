"use client";

// Create/edit form for admin catalog categories, extracted from the
// categories route. The route decides when the form is shown and remounts it
// (via key) per editing target, so field state initializes once from
// `initial`; the form owns the create/update mutations and reports back
// through onSaved/onCancel.

import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { useMutation } from "convex/react";
import { Save, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import type { Category } from "./category-list";

interface CategoryFormData {
  name: {
    en: string;
    nl: string;
  };
  description?: {
    en: string;
    nl: string;
  };
  color?: string;
  isActive: boolean;
  sortOrder: number;
}

// Only forward a localized description when at least one locale is filled in.
const nonEmptyDescription = (description?: { en: string; nl: string }) =>
  description && (description.en.trim() || description.nl.trim())
    ? description
    : undefined;

export function CategoryForm({
  initial,
  onSaved,
  onCancel,
}: {
  // The category being edited; omitted when creating a new one.
  initial?: Category;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("admin.categories.form");
  const createCategory = useMutation(gateway.adminCatalog.create);
  const updateCategory = useMutation(gateway.adminCatalog.update);
  // The domain soft-deactivates; there is no hard delete, so "delete" hides a node via setActive.
  const setCategoryActive = useMutation(gateway.adminCatalog.delete);

  // The aggregateId of the category being edited (the domain's stable identifier).
  const editingId = initial?.aggregateId ?? null;
  const editingWasActive = initial?.isActive ?? true;
  const [formData, setFormData] = useState<CategoryFormData>(() =>
    initial
      ? {
          name: initial.name,
          description: initial.description || { en: "", nl: "" },
          color: initial.color || "#3B82F6",
          isActive: initial.isActive,
          sortOrder: initial.sortOrder,
        }
      : {
          name: { en: "", nl: "" },
          description: { en: "", nl: "" },
          color: "#3B82F6",
          isActive: true,
          sortOrder: 0,
        },
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (editingId) {
        await updateCategory({
          catalogCategoryId: editingId,
          name: formData.name,
          description: nonEmptyDescription(formData.description),
          color: formData.color,
        });
        // Active state is a separate domain transition (not a patchable field); only toggle on change.
        if (formData.isActive !== editingWasActive) {
          await setCategoryActive({
            catalogCategoryId: editingId,
            isActive: formData.isActive,
          });
        }
        toast.success(t("updateSuccess"));
      } else {
        // The domain creates a category active; the isActive toggle is ignored on create.
        await createCategory({
          name: formData.name,
          sortOrder: formData.sortOrder,
          description: nonEmptyDescription(formData.description),
          color: formData.color,
        });
        toast.success(t("createSuccess"));
      }

      onSaved();
    } catch {
      toast.error(t("saveError"));
    }
  };

  return (
    <section className="rounded-xl border p-4">
      <h2 className="mb-4 text-sm font-semibold">
        {editingId ? t("editTitle") : t("createTitle")}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="name-en">{t("nameEn")}</Label>
            <Input
              id="name-en"
              value={formData.name.en}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  name: { ...formData.name, en: e.target.value },
                })
              }
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name-nl">{t("nameNl")}</Label>
            <Input
              id="name-nl"
              value={formData.name.nl}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  name: { ...formData.name, nl: e.target.value },
                })
              }
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="description-en">{t("descriptionEn")}</Label>
            <Textarea
              id="description-en"
              value={formData.description?.en || ""}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  description: {
                    en: e.target.value,
                    nl: formData.description?.nl || "",
                  },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description-nl">{t("descriptionNl")}</Label>
            <Textarea
              id="description-nl"
              value={formData.description?.nl || ""}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  description: {
                    nl: e.target.value,
                    en: formData.description?.en || "",
                  },
                })
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="color">{t("color")}</Label>
            <ColorPicker
              value={formData.color}
              onChange={(color) => setFormData({ ...formData, color: color })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sort-order">{t("sortOrder")}</Label>
            <Input
              id="sort-order"
              type="number"
              value={formData.sortOrder}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  sortOrder: parseInt(e.target.value),
                })
              }
            />
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Switch
            id="is-active"
            checked={formData.isActive}
            onCheckedChange={(checked: boolean) =>
              setFormData({ ...formData, isActive: checked })
            }
          />
          <Label htmlFor="is-active">{t("active")}</Label>
        </div>

        <div className="flex gap-2">
          <Button type="submit" className="flex items-center gap-2">
            <Save className="h-4 w-4" />
            {editingId ? t("update") : t("create")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="flex items-center gap-2"
          >
            <X className="h-4 w-4" />
            {t("cancel")}
          </Button>
        </div>
      </form>
    </section>
  );
}
