import { Link } from "@/compat/link";
import { useRouter } from "@/compat/navigation";
import { EmptyState } from "@/components/library/empty-state";
import { PuzzleDefinitionFields } from "@/components/suggest-edit/definition-fields";
import {
  buildProposalArgs,
  formFromView,
} from "@/components/suggest-edit/proposal-diff";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway, Id } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const Route = createFileRoute(
  "/_dashboard/admin/puzzles/$puzzleId/edit",
)({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminPuzzles") }],
  }),
  component: AdminEditPage,
});

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
    case "EmptyTitle":
      return "edit.errors.emptyTitle";
    case "InvalidBarcode":
      return "edit.errors.invalidBarcode";
    case "InvalidPieceCount":
      return "edit.errors.invalidPieceCount";
    default:
      return "edit.failed";
  }
};

type ViewData = NonNullable<
  FunctionReturnType<typeof gateway.catalog.puzzleById>
>;

function AdminEditPage() {
  const { puzzleId } = Route.useParams();
  const t = useTranslations("admin.puzzles");

  // puzzleById discloses non-approved definitions to admins, so this works for any status.
  const { data: view } = useQuery(
    convexQuery(gateway.catalog.puzzleById, {
      puzzleId: puzzleId as Id<"puzzles">,
    }),
  );
  const { data: categories } = useQuery(
    convexQuery(gateway.catalog.puzzleCategories, {}),
  );

  if (view === undefined || categories === undefined) {
    return <PageLoading message={t("edit.title")} />;
  }
  if (view === null || !view.aggregateId) {
    return (
      <EmptyState
        title={t("detail.notFoundTitle")}
        sub={t("detail.notFound")}
      />
    );
  }
  return <AdminEditForm view={view} categories={categories} />;
}

function AdminEditForm({
  view,
  categories,
}: {
  view: ViewData;
  categories: readonly {
    _id: string;
    aggregateId?: string;
    name: { en: string; nl: string };
  }[];
}) {
  const { puzzleId } = Route.useParams();
  const router = useRouter();
  const t = useTranslations("admin.puzzles");
  const tSuggest = useTranslations("suggestEdit");

  // Frozen diff baseline (same rationale as the member form): a concurrent change to the
  // definition must not turn untouched fields into diffs.
  const [baseline] = useState(() => view);
  const [form, setForm] = useState(() => formFromView(baseline));
  const [coverFile, setCoverFile] = useState<File | undefined>(undefined);

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
  const updatePuzzle = useConvexMutation(gateway.catalog.updatePuzzle);

  const pendingArgs = buildProposalArgs(baseline, form, categories);
  const canSubmit = pendingArgs !== null || coverFile !== undefined;

  const submit = useMutation({
    mutationFn: async () => {
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
      if (!args) return;
      await updatePuzzle({
        puzzleDefinitionId: view.aggregateId!,
        ...args,
      });
    },
    onSuccess: () => {
      toast.success(t("edit.saved"));
      router.push(`/admin/puzzles/${puzzleId}`);
    },
    onError: (error) => toast.error(t(errorKeyFor(error))),
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">{t("edit.title")}</h1>
        <p className="text-muted-foreground text-sm">
          {t("edit.subtitle", { title: view.title })}
        </p>
      </div>

      <PuzzleDefinitionFields
        form={form}
        set={set}
        categories={categories}
        difficultySeed={view.difficulty ?? ""}
        shapeSeed={view.shape ?? ""}
        currentImageUrl={coverPreview ?? view.image ?? undefined}
        imageStateLabel={
          coverFile ? tSuggest("proposedImage") : tSuggest("currentImage")
        }
        onPickFile={setCoverFile}
        idPrefix="ae"
      />

      <div className="flex items-center justify-end gap-2">
        {!canSubmit && (
          <span className="text-muted-foreground text-sm">
            {t("edit.noChanges")}
          </span>
        )}
        <Button variant="outline" asChild>
          <Link href={`/admin/puzzles/${puzzleId}`}>{t("edit.cancel")}</Link>
        </Button>
        <Button
          variant="brand"
          disabled={!canSubmit || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? t("edit.saving") : t("edit.save")}
        </Button>
      </div>
    </div>
  );
}
