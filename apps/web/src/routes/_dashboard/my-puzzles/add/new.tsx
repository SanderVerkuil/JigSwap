import { useSearchParams } from "@/compat/navigation";
import {
  AddPuzzleLayout,
  AddPuzzleSummary,
  AvailabilityChips,
  availabilityToSharing,
  CATALOG_TEXT_LIMITS,
  contributeError,
  CopyStepError,
  CoverColourField,
  coverStep,
  CoverStepError,
  DIFFICULTY_OPTIONS,
  hasAnyAvailability,
  ImportZone,
  LivePreviewCard,
  MatchConfirm,
  PieceCountField,
  ReadinessChecklist,
  SectionDivider,
  SegmentedPills,
  SuggestInput,
  TagInput,
} from "@/components/add-puzzle";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { useConditionOptions } from "@/components/library/condition";
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
import { useBoxArtCheckNotice } from "@/hooks/use-box-art-check";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { useUploadBoxArt } from "@/hooks/use-upload-box-art";
import { convexErrorCode } from "@/lib/convex-error-code";
import { pageTitle } from "@/lib/page-title";
import { safeReturnTo } from "@/lib/return-to";
import { isUploadRateLimited } from "@/lib/upload-rate-limit";
import {
  convexQuery,
  useConvexAction,
  useConvexMutation,
} from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useConvex } from "convex/react";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/my-puzzles/add/new")({
  // Copy mode (?puzzleId) adds a copy of a catalogue puzzle; it creates nothing.
  head: ({ match }) => ({
    meta: [
      {
        title: pageTitle(
          match.context,
          match.search.puzzleId ? "addCopy" : "createPuzzle",
        ),
      },
    ],
  }),
  // The page reads ?puzzleId off the URL via the next/navigation compat
  // (useSearchParams -> useSearch({ strict: false })); validate it so the
  // typed search carries it through. When present the form switches to
  // "copy mode": acquiring a copy of an existing catalogue definition.
  // ?ean / ?upc prefill the barcode when registering a code the add-copy
  // picker's barcode lookup did not find (the router JSON-parses search
  // values, so a code without a leading zero arrives as a number).
  // ?title prefills the title and ?returnTo (a same-app path) is where to go after adding: the
  // catalogue picker's "Register it" link sets both.
  validateSearch: (search: Record<string, unknown>) => ({
    puzzleId: typeof search.puzzleId === "string" ? search.puzzleId : undefined,
    ean: barcodeParam(search.ean),
    upc: barcodeParam(search.upc),
    title: typeof search.title === "string" ? search.title : undefined,
    returnTo: safeReturnTo(search.returnTo),
  }),
  component: AddPuzzlePage,
});

function barcodeParam(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

interface FormState {
  title: string;
  brand: string;
  publisher: string;
  pieceCount: number | undefined;
  difficulty: "easy" | "medium" | "hard" | "expert";
  condition: "new_sealed" | "like_new" | "good" | "fair" | "poor";
  availability: { forTrade: boolean; forLend: boolean; forSale: boolean };
  // "photo" when a box photo is selected (the upload, else selectedImageUrl); "none" sends no image.
  coverMode: "none" | "photo";
  coverFile: File | undefined;
  importedImages: string[];
  // Alt text per imported image URL (only HTML-scraped images carry it); shown in the cover picker.
  importedImageAlts: Record<string, string> | undefined;
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
  publisher: "",
  pieceCount: undefined,
  difficulty: "medium",
  condition: "good",
  // Every offer starts off, like the catalogue picker and the domain default: a copy goes on the
  // market (Browse, swap/loan requests) only when the member switches an offer on.
  availability: { forTrade: false, forLend: false, forSale: false },
  coverMode: "none",
  coverFile: undefined,
  importedImages: [],
  importedImageAlts: undefined,
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
  const searchParams = useSearchParams();
  const t = useTranslations("puzzles");
  const tf = useTranslations("forms.puzzle-form");
  const tCommon = useTranslations("common");
  const relativeTime = useRelativeTime();
  const tShell = useTranslations("shell");

  const navigate = useNavigate();
  const convex = useConvex();
  const returnTo = searchParams.get("returnTo") ?? undefined;
  const [form, setForm] = useState<FormState>(() => ({
    ...DEFAULT_FORM,
    title: searchParams.get("title") ?? "",
    ean: searchParams.get("ean") ?? "",
    upc: searchParams.get("upc") ?? "",
  }));
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<
    string | null
  >(null);
  const [pendingMatch, setPendingMatch] = useState<ImportedMatch | null>(null);
  // Open when a prefilled barcode lives in the advanced fields.
  const [advancedOpen, setAdvancedOpen] = useState(
    () => searchParams.has("ean") || searchParams.has("upc"),
  );

  // Convex mutations & actions, called inside the submitPuzzle wrapper below.
  const createPuzzle = useConvexMutation(gateway.catalog.createPuzzle);
  const createOwned = useConvexMutation(gateway.library.createOwned);
  const updateSharing = useConvexMutation(gateway.library.updateSharing);
  const uploadBoxArt = useUploadBoxArt();
  const notifyBoxArtCheck = useBoxArtCheckNotice();
  const importImage = useConvexAction(gateway.catalog.importPuzzleImage);

  // puzzleId from URL — pre-select an existing definition (copy mode).
  const puzzleIdFromUrl = searchParams.get("puzzleId") as Id<"puzzles"> | null;
  const { data: specificPuzzle } = useQuery(
    convexQuery(
      gateway.catalog.puzzleById,
      puzzleIdFromUrl ? { puzzleId: puzzleIdFromUrl } : "skip",
    ),
  );

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

  // Pre-fill from the loaded definition using the derive-state-during-render pattern: track the
  // previously seen puzzle (keyed by id, not object identity — the query may re-emit new objects)
  // and seed the selection + form fields during the render where it first appears. Only pre-fill
  // while nothing is selected yet, matching the old once-only effect.
  const specificPuzzleKey = specificPuzzle
    ? (specificPuzzle.aggregateId ?? specificPuzzle._id)
    : null;
  const [prevSpecificPuzzleKey, setPrevSpecificPuzzleKey] = useState<
    string | null
  >(null);
  if (specificPuzzleKey !== prevSpecificPuzzleKey) {
    setPrevSpecificPuzzleKey(specificPuzzleKey);
    if (puzzleIdFromUrl && specificPuzzle && !selectedDefinitionId) {
      setSelectedDefinitionId(specificPuzzle.aggregateId ?? null);
      setForm((f) => ({
        ...f,
        title: specificPuzzle.title,
        brand: specificPuzzle.brand ?? "",
        publisher: specificPuzzle.publisher ?? "",
        pieceCount: specificPuzzle.pieceCount,
      }));
    }
  }

  // "Copy mode": the form is acquiring a copy of an existing catalogue
  // definition reached via ?puzzleId. We hide the import + definition-editing
  // fields and show the chosen definition read-only. We key off the URL param
  // (not selectedDefinitionId, which also flips during an import match) so the
  // chrome doesn't flicker between the loading and resolved states.
  const isCopyMode = !!puzzleIdFromUrl;
  const copyLoading = isCopyMode && specificPuzzle === undefined;

  // The route's static head is "Create a Puzzle", which copy mode is not: there the page titles
  // itself "Add your copy" under My Library › Add Puzzle (the chooser it came from).
  usePageHeader(
    () =>
      isCopyMode
        ? {
            title: t("chooser.addYourCopy"),
            crumbs: [
              { label: tShell("groups.library.label"), href: "/library" },
              {
                label: tShell("pages.addPuzzle.title"),
                href: "/my-puzzles/add",
              },
            ],
          }
        : {},
    [isCopyMode, t, tShell],
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

  // The selected box photo: uploaded file takes priority, else the selected import.
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
      importedImageAlts: draft.imageAlts ? { ...draft.imageAlts } : undefined,
      selectedImageUrl: imgs[0],
      coverFile: undefined,
      coverMode: imgs.length ? "photo" : "none",
    }));
  };

  const resetForm = () => {
    setForm(DEFAULT_FORM);
    setSelectedDefinitionId(null);
    setPendingMatch(null);
  };

  const buildImageId = async (): Promise<Id<"_storage"> | undefined> => {
    if (form.coverMode !== "photo") return undefined;
    const coverFile = form.coverFile;
    if (coverFile) {
      return await coverStep(() => uploadBoxArt(coverFile));
    } else if (form.selectedImageUrl) {
      try {
        return await importImage({ url: form.selectedImageUrl });
      } catch (error) {
        // The member's cover-photo limit stops the flow, so no puzzle is created without the
        // cover they chose; any other failure is non-fatal: proceed without the remote image.
        if (convexErrorCode(error) === "RateLimited") {
          throw new CoverStepError(error);
        }
        return undefined;
      }
    }
    return undefined;
  };

  const buildCreatePuzzleArgs = (imageId: Id<"_storage"> | undefined) => ({
    title: form.title,
    brand: form.brand || undefined,
    publisher: form.publisher || undefined,
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

  // createOwned returns the copy's domain id; the copy page is keyed on its document id. The copy
  // is already added when this runs, so a failed lookup only changes where the member lands.
  const resolveCopyPageId = async (copyId: string) => {
    try {
      return await convex.query(gateway.library.copyDocId, { copyId });
    } catch {
      return null;
    }
  };

  // The WHOLE multi-step create — optional image upload/import, createPuzzle,
  // createOwned, updateSharing, resolving the landing page — runs as ONE mutationFn so
  // isPending spans the full sequence (busy-state rule v2). Both footer buttons share it; the
  // `andAnother` variant only changes what happens after success (reset vs navigate).
  const submitPuzzle = useMutation({
    mutationFn: async ({ andAnother }: { andAnother: boolean }) => {
      // 1. Resolve the catalog definition id (existing match or create new).
      let definitionId = selectedDefinitionId;
      if (!definitionId) {
        const imageId = await buildImageId();
        definitionId = (await createPuzzle(
          buildCreatePuzzleArgs(imageId),
        )) as string;
        await notifyBoxArtCheck(imageId);
      }

      // 2. Acquire a copy of that definition.
      const copyId = (await createOwned({
        puzzleDefinitionId: definitionId,
        condition: form.condition,
        notes: form.notes || undefined,
      }).catch((error: unknown) => {
        throw new CopyStepError(error);
      })) as string;

      // 3. Apply availability if any chip is on.
      if (hasAnyAvailability(form.availability)) {
        await updateSharing(availabilityToSharing(copyId, form.availability));
      }

      // 4. Land on the new copy, unless the member stays on the form or a flow takes them back.
      return andAnother || returnTo ? null : await resolveCopyPageId(copyId);
    },
    onSuccess: (copyPageId, { andAnother }) => {
      if (andAnother) {
        toast.success(t("puzzleAdded"));
        resetForm();
      } else if (returnTo) {
        toast.success(t("puzzleAdded"));
        void navigate({ href: returnTo });
      } else {
        toast.success(t("puzzleAdded"), {
          action: {
            label: t("addAnother"),
            onClick: () => void navigate({ to: "/my-puzzles/add" }),
          },
        });
        if (copyPageId) {
          void navigate({ to: "/my-puzzles/$id", params: { id: copyPageId } });
        } else {
          void navigate({ to: "/my-puzzles" });
        }
      }
    },
    onError: (error) => {
      console.error("Add to library failed:", error);
      // A box-art upload URL refused by the member's upload limit says to wait (SEC-20); the
      // filing's, the cover check's and the copy's own refusals (their limits, a text bound) name
      // their reason (SEC-26; the daily copy budget, SEC-29).
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

  // A chosen existing definition needs no definition fields; otherwise only title and
  // piece count are required — publisher (company) and brand (product line) are optional.
  const definitionReady =
    !!selectedDefinitionId || (!!form.title.trim() && !!form.pieceCount);

  const handleAdd = () => {
    if (!definitionReady) return;
    submitPuzzle.mutate({ andAnother: false });
  };

  const handleSaveAndAddAnother = () => {
    if (!definitionReady) return;
    submitPuzzle.mutate({ andAnother: true });
  };

  // In copy mode the definition is fixed, so only the copy fields gate submit.
  const isReady = isCopyMode ? !!selectedDefinitionId : definitionReady;

  const difficultyOptions = DIFFICULTY_OPTIONS.map((o) => ({
    ...o,
    label: t(`difficulty_${o.value}`),
  }));
  const conditionOptions = useConditionOptions();

  // The chosen definition shown read-only at the top of copy mode.
  const chosenDefinition = isCopyMode ? (
    <div className="flex items-start gap-4 rounded-xl border border-border bg-card p-4">
      <div className="size-20 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
        {specificPuzzle?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={specificPuzzle.image}
            alt={specificPuzzle.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl">
            🧩
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
          {t("chooser.chosenPuzzle")}
        </div>
        <div className="mt-1 truncate font-semibold">
          {specificPuzzle?.title ?? form.title}
        </div>
        {(specificPuzzle?.brand ||
          specificPuzzle?.publisher ||
          form.brand ||
          form.publisher) && (
          <div className="truncate text-sm text-muted-foreground">
            {specificPuzzle?.brand ||
              specificPuzzle?.publisher ||
              form.brand ||
              form.publisher}
          </div>
        )}
        {(specificPuzzle?.pieceCount ?? form.pieceCount) != null && (
          <div className="mt-0.5 text-sm text-muted-foreground">
            {specificPuzzle?.pieceCount ?? form.pieceCount} {t("pieces")}
          </div>
        )}
      </div>
    </div>
  ) : null;

  // The copy fields are shared between both modes; in copy mode they are the
  // only editable section, in full mode they sit alongside the definition fields.
  const copyFields = (
    <div className="flex flex-col gap-5">
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
        <p className="text-xs text-muted-foreground">{t("availabilityHint")}</p>
        <AvailabilityChips
          value={form.availability}
          onChange={(v) => setForm((f) => ({ ...f, availability: v }))}
        />
      </div>
    </div>
  );

  // Copy mode saves no photo: the only image this form can store is a NEW catalogue puzzle's box
  // art (createPuzzle's image). Photos of the member's own copy are added on the copy's page.
  const copyPhotosLater = (
    <p className="text-xs text-muted-foreground">
      {t("chooser.copyPhotosLater")}
    </p>
  );

  const copyNotes = (
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
  );

  const footerButtons = (
    <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
      <Button
        type="button"
        disabled={!isReady || submitPuzzle.isPending}
        onClick={handleAdd}
      >
        {isCopyMode ? t("addToLibrary") : t("addPuzzle")}
      </Button>
      {!isCopyMode && (
        <Button
          type="button"
          variant="outline"
          disabled={!isReady || submitPuzzle.isPending}
          onClick={handleSaveAndAddAnother}
        >
          {t("saveAndAddAnother")}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        onClick={() =>
          returnTo
            ? void navigate({ href: returnTo })
            : void navigate({ to: "/my-puzzles/add" })
        }
      >
        {t("cancel")}
      </Button>
      {!isReady && !copyLoading && (
        <span className="ml-auto text-xs text-muted-foreground">
          {t("addReadyHint")}
        </span>
      )}
    </div>
  );

  // Copy mode: a focused single-step form — chosen definition read-only + the
  // copy-specific fields. No import zone, no definition editing.
  const copyColumn = (
    <>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {t("chooser.addYourCopyHint")}
        </p>
        {copyLoading ? (
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        ) : (
          chosenDefinition
        )}
      </div>
      <SectionDivider label={t("chooser.copyDetails")} />
      {copyFields}
      <div className="flex flex-col gap-2">
        {copyNotes}
        {copyPhotosLater}
      </div>
      {footerButtons}
    </>
  );

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
            maxLength={CATALOG_TEXT_LIMITS.title}
          />
        </div>

        {/* Publisher + Piece Count */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ap-publisher">
              {t("fieldPublisher")}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                {t("optional")}
              </span>
            </Label>
            <SuggestInput
              id="ap-publisher"
              value={form.publisher}
              onChange={(value) => {
                setSelectedDefinitionId(null);
                setForm((f) => ({ ...f, publisher: value }));
              }}
              suggestions={publisherSuggestions ?? []}
              placeholder={t("fieldPublisherPlaceholder")}
              maxLength={CATALOG_TEXT_LIMITS.publisher}
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

        {/* Brand (product line) + Series — both optional */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ap-brand">
              {t("fieldBrand")}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                {t("optional")}
              </span>
            </Label>
            <SuggestInput
              id="ap-brand"
              value={form.brand}
              onChange={(value) => {
                setSelectedDefinitionId(null);
                setForm((f) => ({ ...f, brand: value }));
              }}
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
            <Label htmlFor="ap-series">{tf("series.label")}</Label>
            <SuggestInput
              id="ap-series"
              value={form.series}
              onChange={(value) => {
                setSelectedDefinitionId(null);
                setForm((f) => ({ ...f, series: value }));
              }}
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
        {/* Box photo: only a NEW catalogue puzzle stores one (createPuzzle's image). Once the
            member picks an existing puzzle from an import match, nothing would save it. */}
        {selectedDefinitionId ? (
          copyPhotosLater
        ) : (
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
                ...(coverFileUrl
                  ? [{ url: coverFileUrl, uploaded: true }]
                  : []),
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
        )}

        {/* Tags */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ap-tags">
            {t("fieldTags")}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {t("optional")}
            </span>
          </Label>
          <p className="text-xs text-muted-foreground">{t("tagsHint")}</p>
          <TagInput
            id="ap-tags"
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                maxLength={CATALOG_TEXT_LIMITS.modelNumber}
              />
            </div>

            {/* Artist */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ap-artist">{tf("artist.label")}</Label>
              <Input
                id="ap-artist"
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

      <AddPuzzleSummary
        title={form.title}
        brand={form.brand || form.publisher}
        pieceCount={form.pieceCount}
        coverPhotoUrl={selectedDefinitionId ? undefined : previewPhotoUrl}
        offers={[
          form.availability.forTrade ? t("availTrade") : "",
          form.availability.forLend ? t("availLend") : "",
          form.availability.forSale ? t("availSale") : "",
        ]}
      />
      {footerButtons}
    </>
  );

  const previewColumn = (
    <>
      <div className="font-mono text-[10px] uppercase tracking-[0.09em] text-muted-foreground">
        {t("livePreview")}
      </div>
      <LivePreviewCard
        title={specificPuzzle?.title ?? form.title}
        brand={
          (specificPuzzle?.brand || specificPuzzle?.publisher) ??
          (form.brand || form.publisher)
        }
        pieceCount={specificPuzzle?.pieceCount ?? form.pieceCount}
        difficulty={specificPuzzle?.difficulty ?? form.difficulty}
        // Only what the submit saves: the catalogue puzzle's own picture in copy mode, the selected
        // box photo when the form creates a new catalogue puzzle, nothing for an import match.
        coverPhotoUrl={
          isCopyMode
            ? (specificPuzzle?.image ?? undefined)
            : selectedDefinitionId
              ? undefined
              : previewPhotoUrl
        }
        available={hasAnyAvailability(form.availability)}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("livePreviewCaption")}
      </p>
      {!isCopyMode && (
        <ReadinessChecklist
          items={[
            { ok: !!form.title.trim(), label: t("checkTitle") },
            { ok: !!form.pieceCount, label: t("checkPieces") },
          ]}
        />
      )}
    </>
  );

  return (
    <div className="space-y-6">
      <AddPuzzleLayout
        form={isCopyMode ? copyColumn : formColumn}
        preview={previewColumn}
      />
    </div>
  );
}
