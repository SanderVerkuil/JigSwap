import { useRouter } from "@/compat/navigation";
import {
  AddPuzzleLayout,
  AddPuzzleSummary,
  CATALOG_TEXT_LIMITS,
  contributeError,
  ContributeSuccess,
  CoverColourField,
  coverStep,
  CoverStepError,
  DIFFICULTY_OPTIONS,
  duplicateCandidates,
  duplicateLookups,
  ImportZone,
  LivePreviewCard,
  MatchConfirm,
  PieceCountField,
  ReadinessChecklist,
  SectionDivider,
  SegmentedPills,
  submittedPuzzleId,
  SuggestInput,
  TagInput,
  type SegmentedOption,
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
import { useBoxArtCheckNotice } from "@/hooks/use-box-art-check";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { useUploadBoxArt } from "@/hooks/use-upload-box-art";
import { convexErrorCode } from "@/lib/convex-error-code";
import { pageTitle } from "@/lib/page-title";
import { isUploadRateLimited } from "@/lib/upload-rate-limit";
import {
  convexQuery,
  useConvexAction,
  useConvexMutation,
} from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/puzzles/add")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "contributePuzzle") }],
  }),
  component: ContributePuzzlePage,
});

interface FormState {
  title: string;
  brand: string;
  publisher: string;
  pieceCount: number | undefined;
  // "" is "Not sure": the definition is submitted without a difficulty rather than a guessed one.
  difficulty: "" | "easy" | "medium" | "hard" | "expert";
  // "photo" when a box photo is selected (the upload, else selectedImageUrl); "none" sends no image.
  coverMode: "none" | "photo";
  coverFile: File | undefined;
  importedImages: string[];
  // Alt text per imported image URL (only HTML-scraped images carry it); shown in the cover picker.
  importedImageAlts: Record<string, string> | undefined;
  selectedImageUrl: string | undefined;
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
  publisher: "",
  pieceCount: undefined,
  difficulty: "",
  coverMode: "none",
  coverFile: undefined,
  importedImages: [],
  importedImageAlts: undefined,
  selectedImageUrl: undefined,
  tags: [],
  ean: "",
  upc: "",
  modelNumber: "",
  artist: "",
  series: "",
  shape: undefined,
  dimensions: { width: "", height: "", unit: "cm" },
};

// How long typing in the title or barcode fields pauses before the catalogue is checked.
const DUPLICATE_CHECK_DEBOUNCE_MS = 300;
// Title search results fetched per check; only those whose title overlaps are offered.
const TITLE_SUGGESTION_LIMIT = 8;

type CatalogueMatch = NonNullable<
  FunctionReturnType<typeof gateway.catalog.lookupBarcode>
>;

const toImportedMatch = (p: CatalogueMatch): ImportedMatch => ({
  puzzleId: p._id,
  aggregateId: p.aggregateId,
  title: p.title,
  brand: p.brand,
  pieceCount: p.pieceCount,
  imageUrl: p.image ?? undefined,
});

function ContributePuzzlePage() {
  const router = useRouter();
  const t = useTranslations("puzzles");
  const tf = useTranslations("forms.puzzle-form");
  const tCommon = useTranslations("common");
  const relativeTime = useRelativeTime();

  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [pendingMatch, setPendingMatch] = useState<ImportedMatch | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Catalogue puzzles the member said are a different puzzle; never offered again on this form.
  const [dismissedMatches, setDismissedMatches] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const dismissMatch = (puzzleId: string) =>
    setDismissedMatches((ids) => new Set(ids).add(puzzleId));

  // Convex mutations & actions, called inside the contribute wrapper below.
  const convex = useConvex();
  const createPuzzle = useConvexMutation(gateway.catalog.createPuzzle);
  const uploadBoxArt = useUploadBoxArt();
  const notifyBoxArtCheck = useBoxArtCheckNotice();
  const importImage = useConvexAction(gateway.catalog.importPuzzleImage);

  // Maker-field autocomplete suggestion pools
  const { data: publisherSuggestions } = useQuery(
    convexQuery(gateway.catalog.allPublishers, {}),
  );
  const { data: brandSuggestions } = useQuery(
    convexQuery(gateway.catalog.allBrands, {}),
  );
  const { data: seriesSuggestions } = useQuery(
    convexQuery(gateway.catalog.allSeries, {
      brand: form.brand.trim() || undefined,
      publisher: form.publisher.trim() || undefined,
    }),
  );

  // Is this puzzle already in the catalogue? The typed title and EAN/UPC are checked (debounced)
  // so the member can add a copy of the existing puzzle instead of contributing a duplicate.
  const lookups = duplicateLookups(form);
  const titleTerm = useDebouncedValue(
    lookups.titleTerm,
    DUPLICATE_CHECK_DEBOUNCE_MS,
  );
  const barcode = useDebouncedValue(
    lookups.barcode,
    DUPLICATE_CHECK_DEBOUNCE_MS,
  );
  const { data: titleMatches } = useQuery(
    convexQuery(
      gateway.catalog.puzzleSuggestions,
      titleTerm
        ? { searchTerm: titleTerm, limit: TITLE_SUGGESTION_LIMIT }
        : "skip",
    ),
  );
  const { data: barcodeMatch } = useQuery(
    convexQuery(
      gateway.catalog.lookupBarcode,
      barcode ? { code: barcode } : "skip",
    ),
  );
  const duplicates = duplicateCandidates({
    titleTerm,
    titleMatches,
    barcodeMatch,
    dismissed: dismissedMatches,
  });
  const addCopyOf = (puzzleId: string) =>
    router.push(`/my-puzzles/add/new?puzzleId=${puzzleId}`);
  const duplicateBanners = (matches: ReadonlyArray<CatalogueMatch>) => (
    // Always rendered (hidden while empty) so screen readers announce a match as it appears.
    <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
      {matches.map((p) => (
        <MatchConfirm
          key={p._id}
          match={toImportedMatch(p)}
          onUse={() => addCopyOf(p._id)}
          onIgnore={() => dismissMatch(p._id)}
        />
      ))}
    </div>
  );

  // Object URL for the cover file preview — derived from the file; the effect only revokes the
  // previous URL when the file changes (or on unmount), so no setState runs inside an effect.
  const coverFileUrl = useMemo(
    () => (form.coverFile ? URL.createObjectURL(form.coverFile) : undefined),
    [form.coverFile],
  );
  useEffect(
    () => () => {
      if (coverFileUrl) URL.revokeObjectURL(coverFileUrl);
    },
    [coverFileUrl],
  );

  // The preview shows the photo only when mode is "photo"
  const previewPhotoUrl =
    form.coverMode === "photo"
      ? (coverFileUrl ?? form.selectedImageUrl)
      : undefined;

  // Apply a scraped draft onto the form fields
  const applyDraft = (draft: ImportedDraft) => {
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
      importedImageAlts: draft.imageAlts ? { ...draft.imageAlts } : undefined,
      selectedImageUrl: imgs[0],
      coverFile: undefined,
      coverMode: imgs.length ? "photo" : "none",
    }));
  };

  // The WHOLE contribute flow — optional image upload/import + createPuzzle — runs
  // as one mutationFn so isPending spans the full sequence (busy-state rule v2).
  const contribute = useMutation({
    mutationFn: async () => {
      let imageId: Id<"_storage"> | undefined;
      if (form.coverMode === "photo") {
        const coverFile = form.coverFile;
        if (coverFile) {
          imageId = await coverStep(() => uploadBoxArt(coverFile));
        } else if (form.selectedImageUrl) {
          try {
            imageId = await importImage({ url: form.selectedImageUrl });
          } catch (error) {
            // The member's cover-photo limit stops the flow, so no puzzle is created without
            // the cover they chose; any other failure is non-fatal: proceed without the image.
            if (convexErrorCode(error) === "RateLimited") {
              throw new CoverStepError(error);
            }
            imageId = undefined;
          }
        }
      }

      const aggregateId = await createPuzzle({
        title: form.title,
        brand: form.brand || undefined,
        publisher: form.publisher || undefined,
        pieceCount: form.pieceCount!,
        difficulty: form.difficulty || undefined,
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
      await notifyBoxArtCheck(imageId);
      // The submit returns the domain id; the add-a-copy form needs the Convex id, which the
      // member's own pending submissions carry. Missing for an admin (approved at once) or when
      // this read fails: the submission itself has succeeded either way.
      let puzzleId: string | null = null;
      try {
        puzzleId = submittedPuzzleId(
          await convex.query(gateway.catalog.myContributedPuzzles, {}),
          aggregateId,
        );
      } catch {
        puzzleId = null;
      }
      return { title: form.title.trim(), puzzleId };
    },
    onError: (error) => {
      console.error("Contribute puzzle failed:", error);
      // A box-art upload URL refused by the member's upload limit says to wait (SEC-20); the
      // filing's and the cover check's own refusals (their limits, a text bound) name their
      // reason (SEC-26).
      if (isUploadRateLimited(error)) {
        toast.error(tCommon("photoUploadRateLimited"));
        return;
      }
      const failure = contributeError(error, Date.now());
      toast.error(
        "retryAt" in failure
          ? t(failure.key, { when: relativeTime(failure.retryAt) })
          : t(failure.key),
      );
    },
  });

  const handleContribute = () => {
    if (!form.title.trim() || !form.pieceCount) return;
    contribute.mutate();
  };

  const contributeAnother = () => {
    contribute.reset();
    setForm(DEFAULT_FORM);
    setPendingMatch(null);
    setAdvancedOpen(false);
    setDismissedMatches(new Set());
  };

  const isReady = !!form.title.trim() && !!form.pieceCount;

  const difficultyOptions: SegmentedOption<FormState["difficulty"]>[] = [
    ...DIFFICULTY_OPTIONS.map((o) => ({
      ...o,
      label: t(`difficulty_${o.value}`),
    })),
    { value: "", label: t("difficultyNotSure") },
  ];

  const formColumn = (
    <>
      {/* URL import zone */}
      <ImportZone onDraft={applyDraft} onMatch={(m) => setPendingMatch(m)} />

      {/* MatchConfirm banner — if the import found an existing catalog entry,
          redirect to the copy-mode add form so the user can add it to their library */}
      {pendingMatch && (
        <MatchConfirm
          match={pendingMatch}
          onUse={() => {
            setPendingMatch(null);
            addCopyOf(pendingMatch.puzzleId);
          }}
          onIgnore={() => {
            dismissMatch(pendingMatch.puzzleId);
            setPendingMatch(null);
          }}
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
            maxLength={CATALOG_TEXT_LIMITS.title}
          />
          {duplicateBanners(duplicates.byTitle)}
        </div>

        {/* Publisher + Piece Count */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-publisher">
              {t("fieldPublisher")}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                {t("optional")}
              </span>
            </Label>
            <SuggestInput
              id="cp-publisher"
              value={form.publisher}
              onChange={(value) => setForm((f) => ({ ...f, publisher: value }))}
              suggestions={publisherSuggestions ?? []}
              placeholder={t("fieldPublisherPlaceholder")}
              maxLength={CATALOG_TEXT_LIMITS.publisher}
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

        {/* Brand (product line) + Series — both optional */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-brand">
              {t("fieldBrand")}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                {t("optional")}
              </span>
            </Label>
            <SuggestInput
              id="cp-brand"
              value={form.brand}
              onChange={(value) => setForm((f) => ({ ...f, brand: value }))}
              suggestions={
                brandSuggestions?.filter((b): b is string => !!b) ?? []
              }
              placeholder={t("fieldBrandPlaceholder")}
              maxLength={CATALOG_TEXT_LIMITS.brand}
            />
            <p className="text-xs text-muted-foreground">
              {t("brandOptionalHint")}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-series">{tf("series.label")}</Label>
            <SuggestInput
              id="cp-series"
              value={form.series}
              onChange={(value) => setForm((f) => ({ ...f, series: value }))}
              suggestions={seriesSuggestions ?? []}
              placeholder={tf("series.placeholder")}
              maxLength={CATALOG_TEXT_LIMITS.series}
            />
          </div>
        </div>

        {/* Difficulty */}
        <div className="flex flex-col gap-1.5">
          <Label>{t("fieldDifficulty")}</Label>
          <SegmentedPills
            options={difficultyOptions}
            value={form.difficulty}
            onChange={(difficulty) => setForm((f) => ({ ...f, difficulty }))}
            ariaLabel={t("fieldDifficulty")}
          />
        </div>
      </div>

      <SectionDivider label={t("dividerCover")} />

      <div className="flex flex-col gap-5">
        {/* Box photo */}
        <div className="flex flex-col gap-1.5">
          <Label>
            {t("boxPhoto")}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {t("optional")}
            </span>
          </Label>
          <p className="text-xs text-muted-foreground">{t("boxPhotoHint")}</p>
          <CoverColourField
            photoOptions={[
              ...form.importedImages.map((url) => ({
                url,
                alt: form.importedImageAlts?.[url],
              })),
              ...(coverFileUrl ? [{ url: coverFileUrl, uploaded: true }] : []),
            ]}
            selectedPhotoUrl={previewPhotoUrl}
            onSelectPhoto={(url) =>
              setForm((f) =>
                url === undefined
                  ? { ...f, coverMode: "none" }
                  : url === coverFileUrl
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
          <Label htmlFor="cp-tags">
            {t("fieldTags")}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {t("optional")}
            </span>
          </Label>
          <p className="text-xs text-muted-foreground">{t("tagsHint")}</p>
          <TagInput
            id="cp-tags"
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            {duplicateBanners(
              duplicates.byBarcode ? [duplicates.byBarcode] : [],
            )}

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
                maxLength={CATALOG_TEXT_LIMITS.modelNumber}
              />
            </div>

            {/* Artist */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-artist">{tf("artist.label")}</Label>
              <Input
                id="cp-artist"
                value={form.artist}
                onChange={(e) =>
                  setForm((f) => ({ ...f, artist: e.target.value }))
                }
                placeholder={tf("artist.placeholder")}
                maxLength={CATALOG_TEXT_LIMITS.artist}
              />
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

      <AddPuzzleSummary
        title={form.title}
        brand={form.brand || form.publisher}
        pieceCount={form.pieceCount}
        coverPhotoUrl={previewPhotoUrl}
      />

      {/* Footer buttons */}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button
          type="button"
          disabled={!isReady || contribute.isPending}
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
        brand={form.brand || form.publisher}
        pieceCount={form.pieceCount}
        difficulty={form.difficulty || undefined}
        coverPhotoUrl={previewPhotoUrl}
        available={false}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("contributePreviewCaption")}
      </p>
      <ReadinessChecklist
        items={[
          { ok: !!form.title.trim(), label: t("checkTitle") },
          { ok: !!form.pieceCount, label: t("checkPieces") },
        ]}
      />
    </>
  );

  return (
    <div className="space-y-6">
      {/* A submitted puzzle waits for review and is not in the catalogue yet, so the member
          stays here and is told what happens next instead of being sent to /puzzles. */}
      {contribute.data ? (
        <ContributeSuccess
          title={contribute.data.title}
          puzzleId={contribute.data.puzzleId}
          onContributeAnother={contributeAnother}
        />
      ) : (
        <AddPuzzleLayout form={formColumn} preview={previewColumn} />
      )}
    </div>
  );
}
