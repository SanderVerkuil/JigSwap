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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { gateway, Id } from "@/gateway";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
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
  difficulty: "easy" | "medium" | "hard" | "expert" | undefined;
  condition: "new_sealed" | "like_new" | "good" | "fair" | "poor";
  availability: { forTrade: boolean; forLend: boolean; forSale: boolean };
  coverColor: string;
  coverFile: File | undefined;
  importedImageUrl: string | undefined;
  tags: string[];
  notes: string;
  ean: string | undefined;
  upc: string | undefined;
}

const DEFAULT_FORM: FormState = {
  title: "",
  brand: "",
  pieceCount: undefined,
  difficulty: undefined,
  condition: "good",
  availability: { forTrade: true, forLend: false, forSale: false },
  coverColor: COVER_SWATCHES[0],
  coverFile: undefined,
  importedImageUrl: undefined,
  tags: [],
  notes: "",
  ean: undefined,
  upc: undefined,
};

function AddPuzzlePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("puzzles");

  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<
    string | null
  >(null);
  const [pendingMatch, setPendingMatch] = useState<ImportedMatch | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  // Object URL for the cover file preview
  const previewUrl = useMemo(() => {
    if (form.coverFile) return URL.createObjectURL(form.coverFile);
    return form.importedImageUrl;
  }, [form.coverFile, form.importedImageUrl]);

  // Revoke object URLs to avoid memory leaks.
  // Capture the URL generated this render — reading form.coverFile inside the
  // cleanup closure would see the *new* state (already undefined when the user
  // switches to a colour swatch), causing the old blob to leak.
  useEffect(() => {
    if (!form.coverFile) return; // only blob URLs need revocation
    const url = previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [previewUrl, form.coverFile]);

  // Apply a scraped draft onto the form fields
  const applyDraft = (draft: ImportedDraft) => {
    setSelectedDefinitionId(null);
    setForm((f) => ({
      ...f,
      title: draft.title ?? "",
      brand: draft.brand ?? "",
      pieceCount: draft.pieceCount,
      ean: draft.ean,
      upc: draft.upc,
      importedImageUrl: draft.imageUrl,
      coverFile: undefined,
    }));
  };

  const resetForm = () => {
    setForm(DEFAULT_FORM);
    setSelectedDefinitionId(null);
    setPendingMatch(null);
  };

  const handleAdd = async () => {
    setSubmitting(true);
    try {
      // 1. Resolve the catalog definition id (existing match or create new).
      let definitionId = selectedDefinitionId;
      if (!definitionId) {
        let imageId: Id<"_storage"> | undefined;
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
        definitionId = (await createPuzzle({
          title: form.title,
          brand: form.brand || undefined,
          pieceCount: form.pieceCount!,
          difficulty: form.difficulty,
          tags: form.tags,
          ean: form.ean || undefined,
          upc: form.upc || undefined,
          image: imageId,
        })) as string;
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
    setSubmitting(true);
    try {
      let definitionId = selectedDefinitionId;
      if (!definitionId) {
        let imageId: Id<"_storage"> | undefined;
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
            imageId = undefined;
          }
        }
        definitionId = (await createPuzzle({
          title: form.title,
          brand: form.brand || undefined,
          pieceCount: form.pieceCount!,
          difficulty: form.difficulty,
          tags: form.tags,
          ean: form.ean || undefined,
          upc: form.upc || undefined,
          image: imageId,
        })) as string;
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

  const formColumn = (
    <>
      {/* URL import zone */}
      <ImportZone onDraft={applyDraft} onMatch={(m) => setPendingMatch(m)} />

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

      <SectionDivider label="or enter the details yourself" />

      {/* Core details */}
      <div className="flex flex-col gap-5">
        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ap-title">Puzzle Title</Label>
          <Input
            id="ap-title"
            value={form.title}
            onChange={(e) => {
              setSelectedDefinitionId(null);
              setForm((f) => ({ ...f, title: e.target.value }));
            }}
            placeholder="e.g. Starry Night"
          />
        </div>

        {/* Brand + Piece Count */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ap-brand">Brand</Label>
            <Input
              id="ap-brand"
              value={form.brand}
              onChange={(e) => {
                setSelectedDefinitionId(null);
                setForm((f) => ({ ...f, brand: e.target.value }));
              }}
              placeholder="e.g. Ravensburger"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ap-pieces">Piece Count</Label>
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
          <Label>Difficulty</Label>
          <SegmentedPills
            options={DIFFICULTY_OPTIONS}
            value={form.difficulty ?? "medium"}
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                difficulty: v as FormState["difficulty"],
              }))
            }
            ariaLabel="Difficulty"
          />
        </div>

        {/* Condition */}
        <div className="flex flex-col gap-1.5">
          <Label>Condition</Label>
          <SegmentedPills
            options={CONDITION_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
            value={form.condition}
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                condition: v as FormState["condition"],
              }))
            }
            ariaLabel="Condition"
          />
        </div>

        {/* Availability */}
        <div className="flex flex-col gap-1.5">
          <Label>Availability</Label>
          <p className="text-xs text-muted-foreground">
            How you&apos;d like to share this puzzle. Pick any that apply.
          </p>
          <AvailabilityChips
            value={form.availability}
            onChange={(v) => setForm((f) => ({ ...f, availability: v }))}
          />
        </div>
      </div>

      <SectionDivider label="cover & extras" />

      <div className="flex flex-col gap-5">
        {/* Cover colour / photo */}
        <div className="flex flex-col gap-1.5">
          <Label>{t("coverColour")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("coverColourHint")}
          </p>
          <CoverColourField
            color={form.coverColor}
            hasPhoto={!!form.coverFile}
            onColor={(c) =>
              setForm((f) => ({ ...f, coverColor: c, coverFile: undefined }))
            }
            onPhoto={(file) => setForm((f) => ({ ...f, coverFile: file }))}
          />
        </div>

        {/* Tags */}
        <div className="flex flex-col gap-1.5">
          <Label>
            Tags{" "}
            <span className="text-xs font-normal text-muted-foreground">
              Optional
            </span>
          </Label>
          <p className="text-xs text-muted-foreground">
            Press Enter to add. Helps people discover your puzzle.
          </p>
          <TagInput
            value={form.tags}
            onChange={(tags) => setForm((f) => ({ ...f, tags }))}
          />
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ap-notes">
            Notes{" "}
            <span className="text-xs font-normal text-muted-foreground">
              Optional
            </span>
          </Label>
          <Textarea
            id="ap-notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Anything worth mentioning — missing pieces, special edition, where you got it…"
            rows={3}
          />
        </div>
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
          Cancel
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
        coverPhotoUrl={previewUrl}
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Add a Puzzle</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Import from a shop link or fill in the details yourself.
        </p>
      </div>
      <AddPuzzleLayout form={formColumn} preview={previewColumn} />
    </div>
  );
}
