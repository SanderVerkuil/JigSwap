"use client";

// Create/edit dialog for admin catalog categories (the edit-approve-dialog
// pattern: RHF + zod, re-seeded every time the dialog opens). The route owns
// when the dialog is open and for which category; the dialog owns the
// create/update mutations. sortOrder is not a form field — a new category is
// appended at the end of the list (nextSortOrder) and order is managed by
// drag-reorder in the list; activation is a row-level action there too.

import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { z } from "zod";

import type { Category } from "./category-list";

const DEFAULT_COLOR = "#3B82F6";

type CategoryFormValues = {
  name: { en: string; nl: string };
  description: { en: string; nl: string };
  color: string;
};

// Only forward a localized description when at least one locale is filled in.
const nonEmptyDescription = (description: { en: string; nl: string }) =>
  description.en.trim() || description.nl.trim() ? description : undefined;

const toDefaults = (category?: Category): CategoryFormValues => ({
  name: category?.name ?? { en: "", nl: "" },
  description: category?.description ?? { en: "", nl: "" },
  color: category?.color ?? DEFAULT_COLOR,
});

export function CategoryDialog({
  open,
  onOpenChange,
  category,
  nextSortOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The category being edited; omitted when creating a new one.
  category?: Category;
  // Where a created category lands: max(sortOrder) + 1 over the loaded list.
  nextSortOrder: number;
}) {
  const t = useTranslations("admin.categories.form");
  const tCommon = useTranslations("common");
  const createCategory = useMutation(gateway.adminCatalog.create);
  const updateCategory = useMutation(gateway.adminCatalog.update);
  const [busy, setBusy] = useState(false);

  const schema = useMemo(
    () =>
      z.object({
        name: z.object({
          en: z.string().min(1, t("nameRequired")),
          nl: z.string().min(1, t("nameRequired")),
        }),
        description: z.object({ en: z.string(), nl: z.string() }),
        color: z.string(),
      }),
    [t],
  );

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(schema),
    defaultValues: toDefaults(category),
  });

  // Re-seed when the dialog opens for a (possibly different) category.
  useEffect(() => {
    if (open) form.reset(toDefaults(category));
  }, [open, category, form]);

  const onSubmit = async (values: CategoryFormValues) => {
    setBusy(true);
    try {
      if (category?.aggregateId) {
        await updateCategory({
          catalogCategoryId: category.aggregateId,
          name: values.name,
          description: nonEmptyDescription(values.description),
          color: values.color,
        });
        toast.success(t("updateSuccess"));
      } else {
        await createCategory({
          name: values.name,
          sortOrder: nextSortOrder,
          description: nonEmptyDescription(values.description),
          color: values.color,
        });
        toast.success(t("createSuccess"));
      }
      onOpenChange(false);
    } catch {
      toast.error(t("saveError"));
    } finally {
      setBusy(false);
    }
  };

  const isEdit = Boolean(category);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("editTitle") : t("createTitle")}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? t("editDescription") : t("createDescription")}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            id="category-form"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name.en"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("nameEn")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name.nl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("nameNl")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="description.en"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("descriptionEn")}</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description.nl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("descriptionNl")}</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("color")}</FormLabel>
                  <FormControl>
                    <ColorPicker
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {tCommon("cancel")}
          </Button>
          <Button type="submit" form="category-form" disabled={busy}>
            {isEdit ? t("update") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
