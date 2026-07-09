import { useRouter } from "@/compat/navigation";
import {
  DIFFICULTY_OPTIONS,
  PieceCountField,
  SectionDivider,
  SegmentedPills,
  TagInput,
} from "@/components/add-puzzle";
import { EmptyState } from "@/components/library/empty-state";
import {
  buildProposalArgs,
  formFromView,
  overlayProposal,
  type ProposalFormState,
  type StoredProposalChanges,
} from "@/components/suggest-edit/proposal-diff";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoading } from "@/components/ui/loading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { gateway, Id } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/puzzles/$id/suggest-edit")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "puzzle") }],
  }),
  component: SuggestEditPage,
});

const SHAPE_VALUES = ["rectangular", "panoramic", "round", "shaped"] as const;

// Map a thrown ConvexError's stable domain code to a user-facing i18n key.
const errorKeyFor = (error: unknown): string => {
  const code =
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data
      ? (error.data as { code: string }).code
      : undefined;
  switch (code) {
    case "OpenProposalAlreadyExists":
      return "errors.openExists";
    case "DefinitionNotProposable":
      return "errors.notProposable";
    case "ProposalNotPending":
      return "errors.notPending";
    case "EmptyProposal":
      return "errors.empty";
    case "InvalidBarcode":
      return "errors.invalidBarcode";
    default:
      return "errors.generic";
  }
};

function SuggestEditPage() {
  const { id } = Route.useParams();
  const t = useTranslations("suggestEdit");

  const { data: view } = useQuery(
    convexQuery(gateway.catalog.puzzleById, { puzzleId: id as Id<"puzzles"> }),
  );
  const { data: myProposals } = useQuery(
    convexQuery(gateway.catalog.listMyChangeProposals, {}),
  );
  const { data: categories } = useQuery(
    convexQuery(gateway.catalog.puzzleCategories, {}),
  );

  if (
    view === undefined ||
    myProposals === undefined ||
    categories === undefined
  ) {
    return <PageLoading message={t("title")} />;
  }
  if (view === null || view.status !== "approved" || !view.aggregateId) {
    return <EmptyState title={t("notFound")} sub={t("notFoundSub")} />;
  }

  // Snapshot-at-open trade-off: if a pending proposal appears via live update after mount,
  // submit routes to edit mode but the form intentionally keeps its opened state (no re-overlay).
  const openProposal = myProposals.find(
    (proposal) =>
      proposal.status === "pending" &&
      proposal.puzzleDefinitionId === view.aggregateId,
  );

  return (
    <SuggestEditForm
      view={view}
      openProposal={openProposal}
      categories={categories}
    />
  );
}

// Derived from the gateway, like $id/index.tsx's View type. The web tier never imports
// @jigswap/contracts; ViewData satisfies proposal-diff's structural ProposalTargetView.
type ViewData = NonNullable<
  FunctionReturnType<typeof gateway.catalog.puzzleById>
>;
type MyProposalRow = FunctionReturnType<
  typeof gateway.catalog.listMyChangeProposals
>[number];

function SuggestEditForm({
  view,
  openProposal,
  categories,
}: {
  view: ViewData;
  openProposal: MyProposalRow | undefined;
  categories: readonly {
    _id: string;
    aggregateId?: string;
    name: { en: string; nl: string };
  }[];
}) {
  const { id } = Route.useParams();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("suggestEdit");
  const tf = useTranslations("forms.puzzle-form");

  // Freeze the diff baseline at mount (mirrors the backend's frozen-baseline model): the form
  // snapshot must diff against the definition AS THE MEMBER OPENED IT — if an admin changes the
  // definition mid-edit, diffing untouched fields against the live view would silently propose
  // a revert. The live `view` stays in use for display only.
  const [baseline] = useState(() => view);
  const [form, setForm] = useState<ProposalFormState>(() => {
    const base = formFromView(baseline);
    return openProposal
      ? overlayProposal(
          base,
          // The stored `changes` column and StoredProposalChanges are field-identical; cast at
          // this one seam since the generated row type doesn't structurally narrow on its own.
          openProposal.changes as StoredProposalChanges,
          openProposal.comment,
          categories,
        )
      : base;
  });
  const [coverFile, setCoverFile] = useState<File | undefined>(undefined);

  // Object-URL preview lifecycle for a freshly picked file (mirrors add.tsx).
  const coverPreview = useMemo(
    () => (coverFile ? URL.createObjectURL(coverFile) : undefined),
    [coverFile],
  );
  useEffect(() => {
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  const generateUploadUrl = useConvexMutation(
    gateway.library.generateUploadUrl,
  );
  const propose = useConvexMutation(gateway.catalog.proposeChange);
  const editProposal = useConvexMutation(gateway.catalog.editChangeProposal);

  const pendingArgs = buildProposalArgs(baseline, form, categories);
  const canSubmit = pendingArgs !== null || coverFile !== undefined;

  const submit = useMutation({
    mutationFn: async () => {
      // Busy-state rule: the upload happens inside the mutation so isPending spans it.
      let imageId = form.newImageStorageId;
      if (coverFile) {
        const uploadUrl = await generateUploadUrl({});
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": coverFile.type },
          body: coverFile,
        });
        if (!res.ok) throw new Error("Image upload failed");
        const { storageId } = (await res.json()) as { storageId: string };
        imageId = storageId;
      }
      const args = buildProposalArgs(
        baseline,
        { ...form, newImageStorageId: imageId },
        categories,
      );
      if (!args) throw new ConvexError({ code: "EmptyProposal", message: "" });
      const comment = form.comment.trim() || undefined;
      if (openProposal) {
        await editProposal({
          changeProposalId: openProposal.aggregateId,
          comment,
          ...args,
        });
      } else {
        await propose({
          puzzleDefinitionId: view.aggregateId!,
          comment,
          ...args,
        });
      }
    },
    onSuccess: () => {
      toast.success(t(openProposal ? "updated" : "submitted"));
      router.push(`/puzzles/${id}`);
    },
    onError: (error) => {
      toast.error(t(errorKeyFor(error)));
    },
  });

  const set = <K extends keyof ProposalFormState>(
    key: K,
    value: ProposalFormState[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const categoryName = (c: (typeof categories)[number]) =>
    locale === "nl" ? c.name.nl : c.name.en;

  const currentImageUrl =
    coverPreview ??
    (form.newImageStorageId ? openProposal?.proposedImageUrl : undefined) ??
    view.image;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">
          {t(openProposal ? "editTitle" : "title")}
        </h1>
        <p className="text-muted-foreground text-sm">
          {t("subtitle", { title: view.title })}
        </p>
      </div>

      <SectionDivider label={tf("formTitle")} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="se-title">{tf("title.label")}</Label>
        <Input
          id="se-title"
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={tf("title.placeholder")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="se-description">{tf("description.label")}</Label>
        <Textarea
          id="se-description"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder={tf("description.placeholder")}
          rows={3}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="se-brand">{tf("brand.label")}</Label>
          <Input
            id="se-brand"
            value={form.brand}
            onChange={(e) => set("brand", e.target.value)}
            placeholder={tf("brand.placeholder")}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="se-pieces">{tf("pieceCount.label")}</Label>
          <PieceCountField
            id="se-pieces"
            value={form.pieceCount}
            onChange={(n) => set("pieceCount", n)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="se-artist">{tf("artist.label")}</Label>
          <Input
            id="se-artist"
            value={form.artist}
            onChange={(e) => set("artist", e.target.value)}
            placeholder={tf("artist.placeholder")}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="se-series">{tf("series.label")}</Label>
          <Input
            id="se-series"
            value={form.series}
            onChange={(e) => set("series", e.target.value)}
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
          value={form.difficulty || view.difficulty || "medium"}
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
          value={form.shape || view.shape || "rectangular"}
          onChange={(v) => set("shape", v as ProposalFormState["shape"])}
          ariaLabel={tf("shape.label")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="se-category">{tf("category.label")}</Label>
        <Select
          value={form.categoryId || undefined}
          onValueChange={(v) => set("categoryId", v)}
        >
          <SelectTrigger id="se-category">
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
          <Label htmlFor="se-ean">{tf("ean.label")}</Label>
          <Input
            id="se-ean"
            value={form.ean}
            onChange={(e) => set("ean", e.target.value)}
            placeholder={tf("ean.placeholder")}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="se-upc">{tf("upc.label")}</Label>
          <Input
            id="se-upc"
            value={form.upc}
            onChange={(e) => set("upc", e.target.value)}
            placeholder={tf("upc.placeholder")}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="se-model">{tf("modelNumber.label")}</Label>
          <Input
            id="se-model"
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
              set("dimensions", { ...form.dimensions, height: e.target.value })
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

      <SectionDivider label={tf("image.label")} />

      <div className="flex items-center gap-4">
        {currentImageUrl ? (
          <img
            src={currentImageUrl}
            alt=""
            className="size-24 rounded-lg border object-cover"
          />
        ) : (
          <div className="bg-muted size-24 rounded-lg border" />
        )}
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">
            {coverFile || form.newImageStorageId
              ? t("proposedImage")
              : t("currentImage")}
          </span>
          <Button variant="outline" size="sm" asChild>
            <label className="cursor-pointer">
              {t("replaceImage")}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => setCoverFile(e.target.files?.[0])}
              />
            </label>
          </Button>
        </div>
      </div>

      <SectionDivider label={t("comment.label")} />

      <Textarea
        aria-label={t("comment.label")}
        value={form.comment}
        onChange={(e) => set("comment", e.target.value)}
        placeholder={t("comment.placeholder")}
        rows={2}
      />

      <div className="flex items-center justify-end gap-2">
        {!canSubmit && (
          <span className="text-muted-foreground text-sm">
            {t("noChanges")}
          </span>
        )}
        <Button variant="outline" onClick={() => router.push(`/puzzles/${id}`)}>
          {t("cancel")}
        </Button>
        <Button
          variant="brand"
          disabled={!canSubmit || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {submit.isPending
            ? t("submitting")
            : t(openProposal ? "update" : "submit")}
        </Button>
      </div>
    </div>
  );
}
