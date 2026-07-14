import {
  DIFFICULTY_OPTIONS,
  PieceCountField,
  SectionDivider,
  SegmentedPills,
  SuggestInput,
  TagInput,
} from "@/components/add-puzzle";
import { ImageEditorDialog } from "@/components/image-editor/image-editor-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import type { ProposalFormState } from "./proposal-diff";

// The controlled field set for editing a puzzle definition, shared by the member
// suggest-edit form and the admin direct-edit form. Pure presentation: all state lives in
// the caller's ProposalFormState; labels come from the existing forms.puzzle-form namespace
// (plus suggestEdit.replaceImage for the image control). The difficulty/shape pills are
// SEEDED with the definition's current value for display, but only onChange writes form
// state — an untouched pill therefore never produces a diff. The cover-image field lives in
// the sibling `CoverImageField` below (both pages render it separately so it can relocate
// into their sticky context panel at `lg:`).
export interface PuzzleDefinitionFieldsProps {
  form: ProposalFormState;
  set: <K extends keyof ProposalFormState>(
    key: K,
    value: ProposalFormState[K],
  ) => void;
  categories: readonly {
    _id: string;
    aggregateId?: string;
    name: { en: string; nl: string };
  }[];
  difficultySeed: ProposalFormState["difficulty"];
  shapeSeed: ProposalFormState["shape"];
  idPrefix: string; // "se" (member) / "ae" (admin) — keeps htmlFor/id unique per page
  publisherSuggestions?: readonly string[];
  brandSuggestions?: readonly string[];
  seriesSuggestions?: readonly string[];
}

const SHAPE_VALUES = ["rectangular", "panoramic", "round", "shaped"] as const;

export function PuzzleDefinitionFields({
  form,
  set,
  categories,
  difficultySeed,
  shapeSeed,
  idPrefix,
  publisherSuggestions,
  brandSuggestions,
  seriesSuggestions,
}: PuzzleDefinitionFieldsProps) {
  const locale = useLocale();
  const t = useTranslations("suggestEdit");
  const tf = useTranslations("forms.puzzle-form");

  const categoryName = (c: (typeof categories)[number]) =>
    locale === "nl" ? c.name.nl : c.name.en;

  return (
    <>
      <SectionDivider label={tf("formTitle")} />

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-title`}>{tf("title.label")}</Label>
        <Input
          id={`${idPrefix}-title`}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={tf("title.placeholder")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-description`}>
          {tf("description.label")}
        </Label>
        <Textarea
          id={`${idPrefix}-description`}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder={tf("description.placeholder")}
          rows={3}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-brand`}>{tf("brand.label")}</Label>
          <SuggestInput
            id={`${idPrefix}-brand`}
            value={form.brand}
            onChange={(value) => set("brand", value)}
            suggestions={brandSuggestions ?? []}
            placeholder={tf("brand.placeholder")}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-publisher`}>
            {tf("publisher.label")}
          </Label>
          <SuggestInput
            id={`${idPrefix}-publisher`}
            value={form.publisher}
            onChange={(value) => set("publisher", value)}
            suggestions={publisherSuggestions ?? []}
            placeholder={tf("publisher.placeholder")}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-pieces`}>{tf("pieceCount.label")}</Label>
          <PieceCountField
            id={`${idPrefix}-pieces`}
            value={form.pieceCount}
            onChange={(n) => set("pieceCount", n)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-artist`}>{tf("artist.label")}</Label>
          <Input
            id={`${idPrefix}-artist`}
            value={form.artist}
            onChange={(e) => set("artist", e.target.value)}
            placeholder={tf("artist.placeholder")}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-series`}>{tf("series.label")}</Label>
          <SuggestInput
            id={`${idPrefix}-series`}
            value={form.series}
            onChange={(value) => set("series", value)}
            suggestions={seriesSuggestions ?? []}
            placeholder={tf("series.placeholder")}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{tf("difficulty.label")}</Label>
        <SegmentedPills
          options={DIFFICULTY_OPTIONS.map((o) => ({
            ...o,
            label: tf(`difficulty.${o.value}`),
          }))}
          value={form.difficulty || difficultySeed || "medium"}
          onChange={(v) =>
            set("difficulty", v as ProposalFormState["difficulty"])
          }
          ariaLabel={tf("difficulty.label")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>{tf("shape.label")}</Label>
        <SegmentedPills
          options={SHAPE_VALUES.map((value) => ({
            value,
            label: tf(`shape.${value}`),
          }))}
          value={form.shape || shapeSeed || "rectangular"}
          onChange={(v) => set("shape", v as ProposalFormState["shape"])}
          ariaLabel={tf("shape.label")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-category`}>{tf("category.label")}</Label>
        <Select
          value={form.categoryId || undefined}
          onValueChange={(v) => set("categoryId", v)}
        >
          <SelectTrigger id={`${idPrefix}-category`}>
            <SelectValue placeholder={t("keepCategory")} />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c._id} value={c._id}>
                {categoryName(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{tf("tags.label")}</Label>
        <TagInput
          value={form.tags}
          onChange={(tags) => set("tags", tags)}
          placeholder={tf("tags.placeholder")}
        />
      </div>

      <SectionDivider label={tf("ean.label") + " / " + tf("upc.label")} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-ean`}>{tf("ean.label")}</Label>
          <Input
            id={`${idPrefix}-ean`}
            value={form.ean}
            onChange={(e) => set("ean", e.target.value)}
            placeholder={tf("ean.placeholder")}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-upc`}>{tf("upc.label")}</Label>
          <Input
            id={`${idPrefix}-upc`}
            value={form.upc}
            onChange={(e) => set("upc", e.target.value)}
            placeholder={tf("upc.placeholder")}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-model`}>{tf("modelNumber.label")}</Label>
          <Input
            id={`${idPrefix}-model`}
            value={form.modelNumber}
            onChange={(e) => set("modelNumber", e.target.value)}
            placeholder={tf("modelNumber.placeholder")}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{tf("dimensions.label")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={tf("dimensions.width.label")}
            className="w-24"
            type="number"
            value={form.dimensions.width}
            onChange={(e) =>
              set("dimensions", { ...form.dimensions, width: e.target.value })
            }
            placeholder={tf("dimensions.width.placeholder")}
          />
          <span className="text-muted-foreground">×</span>
          <Input
            aria-label={tf("dimensions.height.label")}
            className="w-24"
            type="number"
            value={form.dimensions.height}
            onChange={(e) =>
              set("dimensions", {
                ...form.dimensions,
                height: e.target.value,
              })
            }
            placeholder={tf("dimensions.height.placeholder")}
          />
          <SegmentedPills
            options={[
              { value: "cm", label: tf("dimensions.unit.cm") },
              { value: "in", label: tf("dimensions.unit.in") },
            ]}
            value={form.dimensions.unit}
            onChange={(unit) =>
              set("dimensions", {
                ...form.dimensions,
                unit: unit as "cm" | "in",
              })
            }
            ariaLabel={tf("dimensions.unit.label")}
          />
        </div>
      </div>
    </>
  );
}

// The cover-image field, split out of PuzzleDefinitionFields so both edit pages can
// position it independently: inline in the field stack below `lg:` (variant="inline",
// today's size-24 thumbnail) and again inside the sticky context panel at `lg:`
// (variant="panel", a larger preview) — same control, same dialog wiring, defined once.
// Both instances are mounted simultaneously; only one is visible per breakpoint via the
// caller's `hidden lg:block` / `lg:hidden` wrapper, so their independent `editing` state
// never matters (the hidden instance's trigger is inert, being `display: none`).
export interface CoverImageFieldProps {
  currentImageUrl: string | undefined;
  imageStateLabel: string;
  onPickFile: (file: File | undefined) => void;
  variant?: "inline" | "panel";
}

export function CoverImageField({
  currentImageUrl,
  imageStateLabel,
  onPickFile,
  variant = "inline",
}: CoverImageFieldProps) {
  const t = useTranslations("suggestEdit");
  const tf = useTranslations("forms.puzzle-form");
  const panel = variant === "panel";

  // Both the file-pick and the "Edit photo" (re-edit current image) paths route through
  // the same editor dialog. `revoke` marks whether `src` is an object URL we created (fresh
  // pick) that must be released, vs. the existing stored image URL (re-edit), which we don't own.
  const [editing, setEditing] = useState<{
    src: string;
    fileName: string;
    revoke: boolean;
  } | null>(null);

  const closeEditor = () => {
    if (editing?.revoke) URL.revokeObjectURL(editing.src);
    setEditing(null);
  };

  return (
    <>
      <SectionDivider label={tf("image.label")} />

      <div
        className={cn(
          "flex items-center gap-4",
          panel && "flex-col items-start",
        )}
      >
        {currentImageUrl ? (
          <img
            src={currentImageUrl}
            alt=""
            className={cn(
              "rounded-lg border object-cover",
              panel ? "aspect-square w-full" : "size-24",
            )}
          />
        ) : (
          <div
            className={cn(
              "bg-muted rounded-lg border",
              panel ? "aspect-square w-full" : "size-24",
            )}
          />
        )}
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">
            {imageStateLabel}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                {t("replaceImage")}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setEditing({
                        src: URL.createObjectURL(file),
                        fileName: file.name,
                        revoke: true,
                      });
                    }
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
            {currentImageUrl && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setEditing({
                    src: currentImageUrl,
                    fileName: "cover.jpg",
                    revoke: false,
                  })
                }
              >
                <Pencil className="h-4 w-4" />
                {t("editImage")}
              </Button>
            )}
          </div>
        </div>
      </div>

      <ImageEditorDialog
        src={editing?.src ?? null}
        fileName={editing?.fileName ?? "cover.jpg"}
        onApply={(file) => {
          onPickFile(file);
          closeEditor();
        }}
        onClose={closeEditor}
      />
    </>
  );
}
