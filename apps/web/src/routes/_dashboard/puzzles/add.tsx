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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { gateway, Id } from "@/gateway";
import { useAction, useMutation } from "convex/react";
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
  coverFile: File | undefined;
  importedImageUrl: string | undefined;
  tags: string[];
  ean: string | undefined;
  upc: string | undefined;
}

const DEFAULT_FORM: FormState = {
  title: "",
  brand: "",
  pieceCount: undefined,
  difficulty: "medium",
  coverColor: COVER_SWATCHES[0],
  coverFile: undefined,
  importedImageUrl: undefined,
  tags: [],
  ean: undefined,
  upc: undefined,
};

function ContributePuzzlePage() {
  const router = useRouter();
  const t = useTranslations("puzzles");

  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [pendingMatch, setPendingMatch] = useState<ImportedMatch | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
  const previewUrl = coverFileUrl ?? form.importedImageUrl;

  // Apply a scraped draft onto the form fields
  const applyDraft = (draft: ImportedDraft) => {
    setPendingMatch(null);
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

  const handleContribute = async () => {
    if (!form.title.trim() || !form.brand.trim() || !form.pieceCount) return;
    setSubmitting(true);
    try {
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

      await createPuzzle({
        title: form.title,
        brand: form.brand || undefined,
        pieceCount: form.pieceCount!,
        difficulty: form.difficulty,
        tags: form.tags,
        ean: form.ean || undefined,
        upc: form.upc || undefined,
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
            hasPhoto={!!form.coverFile}
            onColor={(c) =>
              setForm((f) => ({
                ...f,
                coverColor: c,
                coverFile: undefined,
                importedImageUrl: undefined,
              }))
            }
            onPhoto={(file) => setForm((f) => ({ ...f, coverFile: file }))}
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
        coverPhotoUrl={previewUrl}
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
