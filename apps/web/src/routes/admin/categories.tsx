import { createFileRoute } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ColorPicker } from "@/components/ui/color-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoading } from "@/components/ui/loading";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
import { Edit, Plus, Save, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/categories")({
  pendingComponent: () => <PageLoading message="Loading categories..." />,
  component: CategoriesPage,
});

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

interface Category {
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

// Only forward a localized description when at least one locale is filled in.
const nonEmptyDescription = (description?: { en: string; nl: string }) =>
  description && (description.en.trim() || description.nl.trim())
    ? description
    : undefined;

function CategoriesPage() {
  const categories = useQuery(gateway.adminCatalog.listAll);
  const createCategory = useMutation(gateway.adminCatalog.create);
  const updateCategory = useMutation(gateway.adminCatalog.update);
  // The domain soft-deactivates; there is no hard delete, so "delete" hides a node via setActive.
  const setCategoryActive = useMutation(gateway.adminCatalog.delete);

  const [isCreating, setIsCreating] = useState(false);
  // The aggregateId of the category being edited (the domain's stable identifier).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingWasActive, setEditingWasActive] = useState(true);
  const [formData, setFormData] = useState<CategoryFormData>({
    name: { en: "", nl: "" },
    description: { en: "", nl: "" },
    color: "#3B82F6",
    isActive: true,
    sortOrder: 0,
  });

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
        toast.success("Category updated successfully");
      } else {
        // The domain creates a category active; the isActive toggle is ignored on create.
        await createCategory({
          name: formData.name,
          sortOrder: formData.sortOrder,
          description: nonEmptyDescription(formData.description),
          color: formData.color,
        });
        toast.success("Category created successfully");
      }

      setIsCreating(false);
      setEditingId(null);
      setFormData({
        name: { en: "", nl: "" },
        description: { en: "", nl: "" },
        color: "#3B82F6",
        isActive: true,
        sortOrder: 0,
      });
    } catch {
      toast.error("Failed to save category");
    }
  };

  const handleEdit = (category: Category) => {
    if (!category.aggregateId) return; // un-backfilled legacy row: not editable via the domain API
    setEditingId(category.aggregateId);
    setEditingWasActive(category.isActive);
    setFormData({
      name: category.name,
      description: category.description || { en: "", nl: "" },
      color: category.color || "#3B82F6",
      isActive: category.isActive,
      sortOrder: category.sortOrder,
    });
  };

  // Soft-deactivate (the domain has no hard delete); a deactivated node is hidden, not removed.
  const handleDeactivate = async (aggregateId: string) => {
    if (
      confirm("Deactivate this category? It will be hidden but not deleted.")
    ) {
      try {
        await setCategoryActive({
          catalogCategoryId: aggregateId,
          isActive: false,
        });
        toast.success("Category deactivated successfully");
      } catch {
        toast.error("Failed to deactivate category");
      }
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingId(null);
    setFormData({
      name: { en: "", nl: "" },
      description: { en: "", nl: "" },
      color: "#3B82F6",
      isActive: true,
      sortOrder: 0,
    });
  };

  if (categories === undefined) {
    return <PageLoading message="Loading categories..." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Categories</h1>
          <p className="text-muted-foreground mt-2">
            Manage puzzle categories with localization support
          </p>
        </div>
        <Button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Category
        </Button>
      </div>

      {/* Create/Edit Form */}
      {(isCreating || editingId) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editingId ? "Edit Category" : "Create New Category"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name-en">Name (English)</Label>
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
                  <Label htmlFor="name-nl">Name (Dutch)</Label>
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
                  <Label htmlFor="description-en">Description (English)</Label>
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
                  <Label htmlFor="description-nl">Description (Dutch)</Label>
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
                  <Label htmlFor="color">Color</Label>
                  <ColorPicker
                    value={formData.color}
                    onChange={(color) =>
                      setFormData({ ...formData, color: color })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sort-order">Sort Order</Label>
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
                <Label htmlFor="is-active">Active</Label>
              </div>

              <div className="flex gap-2">
                <Button type="submit" className="flex items-center gap-2">
                  <Save className="h-4 w-4" />
                  {editingId ? "Update" : "Create"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  className="flex items-center gap-2"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Categories List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((category) => (
          <Card key={category._id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: category.color }}
                  />
                  {category.name.en}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {category.isActive ? (
                    <Badge variant="default">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Inactive</Badge>
                  )}
                </div>
              </div>
              <CardDescription>
                {category.description?.en || "No description"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div>
                  <span className="text-sm font-medium">Dutch:</span>{" "}
                  {category.name.nl}
                </div>
                {category.description?.nl && (
                  <div>
                    <span className="text-sm font-medium">
                      Dutch Description:
                    </span>{" "}
                    {category.description.nl}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEdit(category)}
                    disabled={!category.aggregateId}
                    className="flex items-center gap-1"
                  >
                    <Edit className="h-3 w-3" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      category.aggregateId &&
                      handleDeactivate(category.aggregateId)
                    }
                    disabled={!category.aggregateId || !category.isActive}
                    className="flex items-center gap-1 text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-3 w-3" />
                    Deactivate
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
