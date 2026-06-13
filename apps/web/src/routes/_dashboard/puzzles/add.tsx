import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { useRouter } from "@/compat/navigation";
import {
  AddPuzzleLayout,
  COVER_SWATCHES,
  CoverColourField,
  DIFFICULTY_OPTIONS,
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
import { gateway, Id } from "@/gateway";
import { useAction, useMutation } from "convex/react";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/puzzles/add")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "addPuzzle") }],
  }),
  component: ContributePuzzlePage,
});

interface FormState {
  title: string;
  brand: string;
  pieceCount: number | undefined;
  difficulty: "easy" | "medium" | "hard" | "expert";
  coverColor: string;
  coverMode: "color" | "photo";
  coverFile: File | undefined;
  importedImageUrl: string | undefined;
  tags: string[];
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
  coverColor: COVER_SWATCHES[0],
  coverMode: "color",
  coverFile: undefined,
  importedImageUrl: undefined,
  tags: [],
  ean: "",
  upc: "",
  modelNumber: "",
  artist: "",
  series: "",
  shape: undefined,
  dimensions: { width: "", height: "", unit: "cm" },
};

function ContributePuzzlePage() {
  const router = useRouter();
  const t = useTranslations("puzzles");
  const tf = useTranslations("forms.puzzle-form");

  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [pendingMatch, setPendingMatch] = useState<ImportedMatch | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Mutations & actions
  const createPuzzle = useMutation(gateway.catalog.createPuzzle);
  const generateUploadUrl = useMutation(gateway.library.generateUploadUrl);
  const importImage = useAction(gateway.catalog.importPuzzleImage);

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

  // The photo URL used for the thumbnail in CoverColourField
  const photoUrl = coverFileUrl ?? form.importedImageUrl;
  // The preview shows the photo only when mode is "photo"
  const previewPhotoUrl = form.coverMode === "photo" ? photoUrl : undefined;

  // Apply a scraped draft onto the form fields
  const applyDraft = (draft: ImportedDraft) => {
    setPendingMatch(null);
    setForm((f) => ({
      ...f,
      title: draft.title ?? "",
      brand: draft.brand ?? "",
      pieceCount: draft.pieceCount,
      ean: draft.ean ?? "",
      upc: draft.upc ?? "",
      importedImageUrl: draft.imageUrl,
      coverFile: undefined,
      coverMode: draft.imageUrl ? "photo" : f.coverMode,
    }));
  };

  const handleContribute = async () => {
    if (!form.title.trim() || !form.brand.trim() || !form.pieceCount) return;
    setSubmitting(true);
    try {
      let imageId: Id<"_storage"> | undefined;
      if (form.coverMode === "photo") {
        if (form.coverFile) {
          const uploadUrl = await generateUploadUrl();
          const res = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": form.coverFile.type },
            body: form.coverFile,
          });
          if (!res.ok) throw new Error("Image upload failed");
          const { storageId } = (await res.json()) as { storageId: string };
          imageId = storageId as Id<"_storage">;
        } else if (form.importedImageUrl) {
          try {
            imageId = await importImage({ url: form.importedImageUrl });
          } catch {
            // Non-fatal: proceed without the remote image
            imageId = undefined;
          }
        }
      }

      await createPuzzle({
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

      toast.success(t("puzzleSubmittedForReview"));
      router.push("/puzzles");
    } catch (error) {
      console.error("Contribute puzzle failed:", error);
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

  const formColumn = (
    <>
      {/* URL import zone */}
      <ImportZone onDraft={applyDraft} onMatch={(m) => setPendingMatch(m)} />

      {/* MatchConfirm banner — if the import found an existing catalog entry,
          redirect to my-puzzles/add so the user can add it to their library */}
      {pendingMatch && (
        <MatchConfirm
          match={pendingMatch}
          onUse={() => {
            setPendingMatch(null);
            router.push(`/my-puzzles/add?puzzleId=${pendingMatch.puzzleId}`);
          }}
          onIgnore={() => setPendingMatch(null)}
        />
      )}

      <SectionDivider label={t("dividerManual")} />

      {/* Core catalog details */}
      <div className="flex flex-col gap-5">
        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cp-title">{t("fieldTitle")}</Label>
          <Input
            id="cp-title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder={t("fieldTitlePlaceholder")}
          />
        </div>

        {/* Brand + Piece Count */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-brand">{t("fieldBrand")}</Label>
            <Input
              id="cp-brand"
              value={form.brand}
              onChange={(e) =>
                setForm((f) => ({ ...f, brand: e.target.value }))
              }
              placeholder={t("fieldBrandPlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-pieces">{t("fieldPieceCount")}</Label>
            <PieceCountField
              id="cp-pieces"
              value={form.pieceCount}
              onChange={(n) => setForm((f) => ({ ...f, pieceCount: n }))}
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
            photoUrl={photoUrl}
            onSelectColor={(c) =>
              setForm((f) => ({ ...f, coverColor: c, coverMode: "color" }))
            }
            onSelectPhoto={() => setForm((f) => ({ ...f, coverMode: "photo" }))}
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
                <Label htmlFor="cp-ean">{tf("ean.label")}</Label>
                <Input
                  id="cp-ean"
                  value={form.ean}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, ean: e.target.value }))
                  }
                  placeholder={tf("ean.placeholder")}
                  inputMode="numeric"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cp-upc">{tf("upc.label")}</Label>
                <Input
                  id="cp-upc"
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
              <Label htmlFor="cp-model">{tf("modelNumber.label")}</Label>
              <Input
                id="cp-model"
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
                <Label htmlFor="cp-artist">{tf("artist.label")}</Label>
                <Input
                  id="cp-artist"
                  value={form.artist}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, artist: e.target.value }))
                  }
                  placeholder={tf("artist.placeholder")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cp-series">{tf("series.label")}</Label>
                <Input
                  id="cp-series"
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
              <Label htmlFor="cp-shape">{tf("shape.label")}</Label>
              <Select
                value={form.shape ?? ""}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    shape: v ? (v as FormState["shape"]) : undefined,
                  }))
                }
              >
                <SelectTrigger id="cp-shape">
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
                  id="cp-dim-w"
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
                  id="cp-dim-h"
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
          onClick={handleContribute}
        >
          {t("contributePuzzle")}
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
        available={false}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("livePreviewCaption")}
      </p>
      <ReadinessChecklist
        items={[
          { ok: !!form.title.trim(), label: t("checkTitle") },
          { ok: !!form.brand.trim(), label: t("checkBrand") },
          { ok: !!form.pieceCount, label: t("checkPieces") },
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
