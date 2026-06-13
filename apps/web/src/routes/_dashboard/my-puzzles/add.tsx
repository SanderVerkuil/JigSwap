import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { useRouter, useSearchParams } from "@/compat/navigation";
import {
  AddPuzzleLayout,
  AvailabilityChips,
  availabilityToSharing,
  CONDITION_OPTIONS,
  COVER_SWATCHES,
  CoverColourField,
  DIFFICULTY_OPTIONS,
  hasAnyAvailability,
  ImportZone,
  LivePreviewCard,
  MatchConfirm,
  PieceCountField,
  ReadinessChecklist,
  SectionDivider,
  SegmentedPills,
  TagInput,
} from "@/components/add-puzzle";
import type { ImportedDraft } from "@/components/puzzle-import/draft-to-form-defaults";
import type { ImportedMatch } from "@/components/puzzle-import/use-puzzle-import";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { gateway, Id } from "@/gateway";
import { useAction, useMutation, useQuery } from "convex/react";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/my-puzzles/add")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "addPuzzle") }],
  }),
  // The page reads ?puzzleId off the URL via the next/navigation compat
  // (useSearchParams -> useSearch({ strict: false })); validate it so the
  // typed search carries it through.
  validateSearch: (search: Record<string, unknown>) => ({
    puzzleId: typeof search.puzzleId === "string" ? search.puzzleId : undefined,
  }),
  component: AddPuzzlePage,
});

interface FormState {
  title: string;
  brand: string;
  pieceCount: number | undefined;
  difficulty: "easy" | "medium" | "hard" | "expert";
  condition: "new_sealed" | "like_new" | "good" | "fair" | "poor";
  availability: { forTrade: boolean; forLend: boolean; forSale: boolean };
  coverColor: string;
  coverMode: "color" | "photo";
  coverFile: File | undefined;
  importedImages: string[];
  selectedImageUrl: string | undefined;
  tags: string[];
  notes: string;
  ean: string;
  upc: string;
  modelNumber: string;
  artist: string;
  series: string;
  shape: "rectangular" | "panoramic" | "round" | "shaped" | undefined;
  dimensions: { width: string; height: string; unit: "cm" | "in" };
}

const DEFAULT_FORM: FormState = {
  title: "",
  brand: "",
  pieceCount: undefined,
  difficulty: "medium",
  condition: "good",
  availability: { forTrade: true, forLend: false, forSale: false },
  coverColor: COVER_SWATCHES[0],
  coverMode: "color",
  coverFile: undefined,
  importedImages: [],
  selectedImageUrl: undefined,
  tags: [],
  notes: "",
  ean: "",
  upc: "",
  modelNumber: "",
  artist: "",
  series: "",
  shape: undefined,
  dimensions: { width: "", height: "", unit: "cm" },
};

function AddPuzzlePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("puzzles");
  const tf = useTranslations("forms.puzzle-form");

  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<
    string | null
  >(null);
  const [pendingMatch, setPendingMatch] = useState<ImportedMatch | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Mutations & actions
  const createPuzzle = useMutation(gateway.catalog.createPuzzle);
  const createOwned = useMutation(gateway.library.createOwned);
  const updateSharing = useMutation(gateway.library.updateSharing);
  const generateUploadUrl = useMutation(gateway.library.generateUploadUrl);
  const importImage = useAction(gateway.catalog.importPuzzleImage);

  // puzzleId from URL — pre-select an existing definition
  const puzzleIdFromUrl = searchParams.get("puzzleId") as Id<"puzzles"> | null;
  const specificPuzzle = useQuery(
    gateway.catalog.puzzleById,
    puzzleIdFromUrl ? { puzzleId: puzzleIdFromUrl } : "skip",
  );

  useEffect(() => {
    if (!puzzleIdFromUrl || !specificPuzzle) return;
    // Only pre-fill once (when selectedDefinitionId is still null)
    if (selectedDefinitionId) return;
    setSelectedDefinitionId(specificPuzzle.aggregateId ?? null);
    setForm((f) => ({
      ...f,
      title: specificPuzzle.title,
      brand: specificPuzzle.brand ?? "",
      pieceCount: specificPuzzle.pieceCount,
    }));
  }, [puzzleIdFromUrl, specificPuzzle, selectedDefinitionId]);

  // Object URL for the cover file preview — create and revoke in one effect
  const [coverFileUrl, setCoverFileUrl] = useState<string | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!form.coverFile) {
      setCoverFileUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(form.coverFile);
    setCoverFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [form.coverFile]);

  // The photo URL used for the live preview: uploaded file takes priority, else selected import
  const previewPhotoUrl =
    form.coverMode === "photo"
      ? (coverFileUrl ?? form.selectedImageUrl)
      : undefined;

  // Apply a scraped draft onto the form fields
  const applyDraft = (draft: ImportedDraft) => {
    setSelectedDefinitionId(null);
    setPendingMatch(null);
    const imgs: string[] = draft.images?.length
      ? [...draft.images]
      : draft.imageUrl
        ? [draft.imageUrl]
        : [];
    setForm((f) => ({
      ...f,
      title: draft.title ?? "",
      brand: draft.brand ?? "",
      pieceCount: draft.pieceCount,
      ean: draft.ean ?? "",
      upc: draft.upc ?? "",
      importedImages: imgs,
      selectedImageUrl: imgs[0],
      coverFile: undefined,
      coverMode: imgs.length ? "photo" : "color",
    }));
  };

  const resetForm = () => {
    setForm(DEFAULT_FORM);
    setSelectedDefinitionId(null);
    setPendingMatch(null);
  };

  const buildImageId = async (): Promise<Id<"_storage"> | undefined> => {
    if (form.coverMode !== "photo") return undefined;
    if (form.coverFile) {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": form.coverFile.type },
        body: form.coverFile,
      });
      if (!res.ok) throw new Error("Image upload failed");
      const { storageId } = (await res.json()) as { storageId: string };
      return storageId as Id<"_storage">;
    } else if (form.selectedImageUrl) {
      try {
        return await importImage({ url: form.selectedImageUrl });
      } catch {
        // Non-fatal: proceed without the remote image
        return undefined;
      }
    }
    return undefined;
  };

  const buildCreatePuzzleArgs = (imageId: Id<"_storage"> | undefined) => ({
    title: form.title,
    brand: form.brand || undefined,
    pieceCount: form.pieceCount!,
    difficulty: form.difficulty,
    tags: form.tags,
    ean: form.ean || undefined,
    upc: form.upc || undefined,
    modelNumber: form.modelNumber || undefined,
    artist: form.artist || undefined,
    series: form.series || undefined,
    shape: form.shape,
    dimensions:
      form.dimensions.width && form.dimensions.height
        ? {
            width: Number(form.dimensions.width),
            height: Number(form.dimensions.height),
            unit: form.dimensions.unit,
          }
        : undefined,
    image: imageId,
  });

  const handleAdd = async () => {
    if (!form.title.trim() || !form.brand.trim() || !form.pieceCount) return;
    setSubmitting(true);
    try {
      // 1. Resolve the catalog definition id (existing match or create new).
      let definitionId = selectedDefinitionId;
      if (!definitionId) {
        const imageId = await buildImageId();
        definitionId = (await createPuzzle(
          buildCreatePuzzleArgs(imageId),
        )) as string;
      }

      // 2. Acquire a copy of that definition.
      const copyId = (await createOwned({
        puzzleDefinitionId: definitionId,
        condition: form.condition,
        notes: form.notes || undefined,
      })) as string;

      // 3. Apply availability if any chip is on.
      if (hasAnyAvailability(form.availability)) {
        await updateSharing(availabilityToSharing(copyId, form.availability));
      }

      toast.success(t("puzzleAdded"));
      router.push("/puzzles");
    } catch (error) {
      console.error("Add to library failed:", error);
      toast.error(t("puzzleCreationFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveAndAddAnother = async () => {
    if (!form.title.trim() || !form.brand.trim() || !form.pieceCount) return;
    setSubmitting(true);
    try {
      let definitionId = selectedDefinitionId;
      if (!definitionId) {
        const imageId = await buildImageId();
        definitionId = (await createPuzzle(
          buildCreatePuzzleArgs(imageId),
        )) as string;
      }

      const copyId = (await createOwned({
        puzzleDefinitionId: definitionId,
        condition: form.condition,
        notes: form.notes || undefined,
      })) as string;

      if (hasAnyAvailability(form.availability)) {
        await updateSharing(availabilityToSharing(copyId, form.availability));
      }

      toast.success(t("puzzleAdded"));
      resetForm();
    } catch (error) {
      console.error("Add to library failed:", error);
      toast.error(t("puzzleCreationFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const isReady =
    !!form.title.trim() && !!form.brand.trim() && !!form.pieceCount;

  const difficultyOptions = DIFFICULTY_OPTIONS.map((o) => ({
    ...o,
    label: t(`difficulty_${o.value}`),
  }));
  const conditionOptions = CONDITION_OPTIONS.map((o) => ({
    value: o.value,
    label: t(`condition_${o.value}`),
  }));

  const formColumn = (
    <>
      {/* URL import zone */}
      <ImportZone
        onDraft={applyDraft}
        onMatch={(m) => {
          setSelectedDefinitionId(null);
          setPendingMatch(m);
        }}
      />

      {/* MatchConfirm banner — shown when the import found an existing catalog entry */}
      {pendingMatch && (
        <MatchConfirm
          match={pendingMatch}
          onUse={() => {
            setSelectedDefinitionId(pendingMatch.aggregateId ?? null);
            setForm((f) => ({
              ...f,
              title: pendingMatch.title,
              brand: pendingMatch.brand ?? "",
              pieceCount: pendingMatch.pieceCount,
            }));
            setPendingMatch(null);
          }}
          onIgnore={() => setPendingMatch(null)}
        />
      )}

      <SectionDivider label={t("dividerManual")} />

      {/* Core details */}
      <div className="flex flex-col gap-5">
        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ap-title">{t("fieldTitle")}</Label>
          <Input
            id="ap-title"
            value={form.title}
            onChange={(e) => {
              setSelectedDefinitionId(null);
              setForm((f) => ({ ...f, title: e.target.value }));
            }}
            placeholder={t("fieldTitlePlaceholder")}
          />
        </div>

        {/* Brand + Piece Count */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ap-brand">{t("fieldBrand")}</Label>
            <Input
              id="ap-brand"
              value={form.brand}
              onChange={(e) => {
                setSelectedDefinitionId(null);
                setForm((f) => ({ ...f, brand: e.target.value }));
              }}
              placeholder={t("fieldBrandPlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ap-pieces">{t("fieldPieceCount")}</Label>
            <PieceCountField
              id="ap-pieces"
              value={form.pieceCount}
              onChange={(n) => {
                setSelectedDefinitionId(null);
                setForm((f) => ({ ...f, pieceCount: n }));
              }}
            />
          </div>
        </div>

        {/* Difficulty */}
        <div className="flex flex-col gap-1.5">
          <Label>{t("fieldDifficulty")}</Label>
          <SegmentedPills
            options={difficultyOptions}
            value={form.difficulty}
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                difficulty: v as FormState["difficulty"],
              }))
            }
            ariaLabel={t("fieldDifficulty")}
          />
        </div>

        {/* Condition */}
        <div className="flex flex-col gap-1.5">
          <Label>{t("fieldCondition")}</Label>
          <SegmentedPills
            options={conditionOptions}
            value={form.condition}
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                condition: v as FormState["condition"],
              }))
            }
            ariaLabel={t("fieldCondition")}
          />
        </div>

        {/* Availability */}
        <div className="flex flex-col gap-1.5">
          <Label>{t("fieldAvailability")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("availabilityHint")}
          </p>
          <AvailabilityChips
            value={form.availability}
            onChange={(v) => setForm((f) => ({ ...f, availability: v }))}
          />
        </div>
      </div>

      <SectionDivider label={t("dividerCover")} />

      <div className="flex flex-col gap-5">
        {/* Cover colour / photo */}
        <div className="flex flex-col gap-1.5">
          <Label>{t("coverColour")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("coverColourHint")}
          </p>
          <CoverColourField
            color={form.coverColor}
            mode={form.coverMode}
            photoOptions={[
              ...form.importedImages.map((url) => ({ url })),
              ...(coverFileUrl ? [{ url: coverFileUrl, uploaded: true }] : []),
            ]}
            selectedPhotoUrl={
              form.coverFile ? coverFileUrl : form.selectedImageUrl
            }
            onSelectColor={(c) =>
              setForm((f) => ({ ...f, coverColor: c, coverMode: "color" }))
            }
            onSelectPhoto={(url) =>
              setForm((f) =>
                url === coverFileUrl
                  ? { ...f, coverMode: "photo" }
                  : {
                      ...f,
                      coverMode: "photo",
                      coverFile: undefined,
                      selectedImageUrl: url,
                    },
              )
            }
            onUploadPhoto={(file) =>
              setForm((f) => ({ ...f, coverFile: file, coverMode: "photo" }))
            }
          />
        </div>

        {/* Tags */}
        <div className="flex flex-col gap-1.5">
          <Label>
            {t("fieldTags")}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {t("optional")}
            </span>
          </Label>
          <p className="text-xs text-muted-foreground">{t("tagsHint")}</p>
          <TagInput
            value={form.tags}
            onChange={(tags) => setForm((f) => ({ ...f, tags }))}
            placeholder={t("tagsPlaceholder")}
          />
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ap-notes">
            {t("fieldNotes")}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {t("optional")}
            </span>
          </Label>
          <Textarea
            id="ap-notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder={t("notesPlaceholderLong")}
            rows={3}
          />
        </div>

        {/* Advanced (optional) fields */}
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              {t("advancedDetails")}
              <ChevronDown
                className={[
                  "size-4 text-muted-foreground transition-transform",
                  advancedOpen ? "rotate-180" : "",
                ].join(" ")}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 flex flex-col gap-4">
            {/* EAN + UPC */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ap-ean">{tf("ean.label")}</Label>
                <Input
                  id="ap-ean"
                  value={form.ean}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, ean: e.target.value }))
                  }
                  placeholder={tf("ean.placeholder")}
                  inputMode="numeric"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ap-upc">{tf("upc.label")}</Label>
                <Input
                  id="ap-upc"
                  value={form.upc}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, upc: e.target.value }))
                  }
                  placeholder={tf("upc.placeholder")}
                  inputMode="numeric"
                />
              </div>
            </div>

            {/* Model Number */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ap-model">{tf("modelNumber.label")}</Label>
              <Input
                id="ap-model"
                value={form.modelNumber}
                onChange={(e) =>
                  setForm((f) => ({ ...f, modelNumber: e.target.value }))
                }
                placeholder={tf("modelNumber.placeholder")}
              />
            </div>

            {/* Artist + Series */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ap-artist">{tf("artist.label")}</Label>
                <Input
                  id="ap-artist"
                  value={form.artist}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, artist: e.target.value }))
                  }
                  placeholder={tf("artist.placeholder")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ap-series">{tf("series.label")}</Label>
                <Input
                  id="ap-series"
                  value={form.series}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, series: e.target.value }))
                  }
                  placeholder={tf("series.placeholder")}
                />
              </div>
            </div>

            {/* Shape */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ap-shape">{tf("shape.label")}</Label>
              <Select
                value={form.shape ?? ""}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    shape: v ? (v as FormState["shape"]) : undefined,
                  }))
                }
              >
                <SelectTrigger id="ap-shape">
                  <SelectValue placeholder={tf("shape.placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rectangular">
                    {tf("shape.rectangular")}
                  </SelectItem>
                  <SelectItem value="panoramic">
                    {tf("shape.panoramic")}
                  </SelectItem>
                  <SelectItem value="round">{tf("shape.round")}</SelectItem>
                  <SelectItem value="shaped">{tf("shape.shaped")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Dimensions */}
            <div className="flex flex-col gap-1.5">
              <Label>{tf("dimensions.label")}</Label>
              <div className="flex gap-2">
                <Input
                  id="ap-dim-w"
                  value={form.dimensions.width}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      dimensions: { ...f.dimensions, width: e.target.value },
                    }))
                  }
                  placeholder={tf("dimensions.width.placeholder")}
                  inputMode="decimal"
                  className="flex-1"
                />
                <Input
                  id="ap-dim-h"
                  value={form.dimensions.height}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      dimensions: { ...f.dimensions, height: e.target.value },
                    }))
                  }
                  placeholder={tf("dimensions.height.placeholder")}
                  inputMode="decimal"
                  className="flex-1"
                />
                <Select
                  value={form.dimensions.unit}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      dimensions: {
                        ...f.dimensions,
                        unit: v as "cm" | "in",
                      },
                    }))
                  }
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cm">
                      {tf("dimensions.unit.cm")}
                    </SelectItem>
                    <SelectItem value="in">
                      {tf("dimensions.unit.in")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Footer buttons */}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button
          type="button"
          disabled={!isReady || submitting}
          onClick={handleAdd}
        >
          {t("addToLibrary")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!isReady || submitting}
          onClick={handleSaveAndAddAnother}
        >
          {t("saveAndAddAnother")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/puzzles")}
        >
          {t("cancel")}
        </Button>
        {!isReady && (
          <span className="ml-auto text-xs text-muted-foreground">
            {t("addReadyHint")}
          </span>
        )}
      </div>
    </>
  );

  const previewColumn = (
    <>
      <div className="font-mono text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
        {t("livePreview")}
      </div>
      <LivePreviewCard
        title={form.title}
        brand={form.brand}
        pieceCount={form.pieceCount}
        difficulty={form.difficulty}
        coverColor={form.coverColor}
        coverPhotoUrl={previewPhotoUrl}
        available={hasAnyAvailability(form.availability)}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("livePreviewCaption")}
      </p>
      <ReadinessChecklist
        items={[
          { ok: !!form.title.trim(), label: t("checkTitle") },
          { ok: !!form.brand.trim(), label: t("checkBrand") },
          { ok: !!form.pieceCount, label: t("checkPieces") },
          {
            ok: hasAnyAvailability(form.availability),
            label: t("checkAvailability"),
          },
        ]}
      />
    </>
  );

  return (
    <div className="space-y-6">
      <AddPuzzleLayout form={formColumn} preview={previewColumn} />
    </div>
  );
}
