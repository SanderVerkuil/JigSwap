"use client";

// Create/edit dialog for admin catalog categories (RHF + zod). All per-open
// form state lives in CategoryForm inside DialogContent — Radix unmounts
// closed content, so every open mounts it fresh and the useState/useForm
// initializers seed it (no reseed effect needed). The route owns when the
// dialog is open and for which category; the dialog owns the
// create/update mutations. sortOrder is not a form field — a new category is
// appended at the end of the list (nextSortOrder) and order is managed by
// drag-reorder in the list; activation is a row-level action there too.
// Name and description are TranslatableFields (one locale visible at a time,
// synced across fields); in create mode the color live-follows the English
// name until the picker is touched.

import {
  TranslatableField,
  TranslatableFieldsProvider,
  useTranslatableFields,
} from "@/components/forms/translatable-field";
import { Badge } from "@/components/ui/badge";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { z } from "zod";

import type { Category } from "./category-list";
import { deriveColorFromName } from "./derive-color";

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
  const createCategory = useMutation({
    mutationFn: useConvexMutation(gateway.adminCatalog.create),
  });
  const updateCategory = useMutation({
    mutationFn: useConvexMutation(gateway.adminCatalog.update),
  });
  const busy = createCategory.isPending || updateCategory.isPending;

  const onSubmit = async (values: CategoryFormValues) => {
    try {
      if (category?.aggregateId) {
        await updateCategory.mutateAsync({
          catalogCategoryId: category.aggregateId,
          name: values.name,
          description: nonEmptyDescription(values.description),
          color: values.color,
        });
        toast.success(t("updateSuccess"));
      } else {
        await createCategory.mutateAsync({
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
    }
  };

  const isEdit = Boolean(category);

  // Filled in by CategoryForm (it knows the active locale): focuses the name
  // input for the visible locale. Radix would otherwise focus the first
  // tabbable element — the locale toggle — and pop its tooltip on open.
  const initialFocusRef = useRef<(() => void) | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          initialFocusRef.current?.();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("editTitle") : t("createTitle")}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? t("editDescription") : t("createDescription")}
          </DialogDescription>
        </DialogHeader>
        <TranslatableFieldsProvider>
          <CategoryForm
            category={category}
            onSubmit={onSubmit}
            initialFocusRef={initialFocusRef}
          />
        </TranslatableFieldsProvider>
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

// The form body lives under the TranslatableFieldsProvider so it can drive the
// synced locale toggle (onInvalid auto-switch below). It mounts fresh on every
// dialog open (Radix unmounts closed content), so the initializers below seed
// the per-open state.
function CategoryForm({
  category,
  onSubmit,
  initialFocusRef,
}: {
  category?: Category;
  onSubmit: (values: CategoryFormValues) => Promise<void>;
  // Written here, called by DialogContent's onOpenAutoFocus above.
  initialFocusRef: RefObject<(() => void) | null>;
}) {
  const t = useTranslations("admin.categories.form");
  const { locales, activeLocale, setActiveLocale } = useTranslatableFields();

  // Name-derived color stops once the picker is used; editing an existing
  // category counts as touched so a stored color is never overwritten.
  const [colorTouched, setColorTouched] = useState(() => Boolean(category));

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

  // Keep the dialog's open-focus callback pointed at the visible name input.
  // This effect runs before Radix's autofocus effect (child effects run before
  // the parent FocusScope mounts), so the ref is set by the time it's called.
  useEffect(() => {
    initialFocusRef.current = () => form.setFocus(`name.${activeLocale}`);
  }, [initialFocusRef, form, activeLocale]);

  // While the picker is untouched (create mode), the color live-follows the
  // name — English first, Dutch when English is still blank. Both blank
  // derives nothing and keeps the current color.
  const nameEn = useWatch({ control: form.control, name: "name.en" });
  const nameNl = useWatch({ control: form.control, name: "name.nl" });
  useEffect(() => {
    if (colorTouched) return;
    const derived = deriveColorFromName([nameEn ?? "", nameNl ?? ""]);
    if (derived) form.setValue("color", derived);
  }, [nameEn, nameNl, colorTouched, form]);

  // Submitting with an error hidden behind a non-visible locale would look
  // like a dead button: switch to the first errored locale and focus it.
  const onInvalid = (errors: FieldErrors<CategoryFormValues>) => {
    for (const fieldName of ["name", "description"] as const) {
      const fieldErrors = errors[fieldName];
      if (!fieldErrors) continue;
      for (const locale of locales) {
        if (fieldErrors[locale]) {
          setActiveLocale(locale);
          // Focus once the newly active input is visible — hidden
          // (display:none) inputs cannot take focus.
          requestAnimationFrame(() => form.setFocus(`${fieldName}.${locale}`));
          return;
        }
      }
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, onInvalid)}
        className="space-y-4"
        id="category-form"
      >
        <TranslatableField
          control={form.control}
          name="name"
          label={t("name")}
          required
          primaryToggle
        />
        <TranslatableField
          control={form.control}
          name="description"
          label={t("description")}
          multiline
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
                  onChange={(color) => {
                    setColorTouched(true);
                    field.onChange(color);
                  }}
                  badge={
                    !colorTouched ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="secondary"
                            aria-label={t("colorAutoHint")}
                          >
                            {t("colorAuto")}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>{t("colorAutoHint")}</TooltipContent>
                      </Tooltip>
                    ) : undefined
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}
