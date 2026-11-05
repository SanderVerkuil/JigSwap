import { useRouter } from "@/compat/navigation";
import {
  CATALOG_TEXT_LIMITS,
  coverStep,
  CoverStepError,
  SectionDivider,
} from "@/components/add-puzzle";
import {
  ChangesSummary,
  FormContextPanel,
} from "@/components/catalog/form-context-panel";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { EmptyState } from "@/components/library/empty-state";
import {
  CoverImageField,
  PuzzleDefinitionFields,
} from "@/components/suggest-edit/definition-fields";
import {
  buildProposalArgs,
  formFromView,
  overlayProposal,
  pendingChanges,
  type ProposalFormState,
  type StoredProposalChanges,
} from "@/components/suggest-edit/proposal-diff";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { Textarea } from "@/components/ui/textarea";
import { gateway, Id } from "@/gateway";
import { useBoxArtCheckNotice } from "@/hooks/use-box-art-check";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { useUploadBoxArt } from "@/hooks/use-upload-box-art";
import { rateLimitedRetryAt } from "@/lib/convex-error-code";
import { pageTitle } from "@/lib/page-title";
import { isUploadRateLimited } from "@/lib/upload-rate-limit";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/puzzles/$id/suggest-edit")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "puzzle") }],
  }),
  component: SuggestEditPage,
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
    case "TextTooLong":
      return "errors.textTooLong";
    case "InvalidDimensions":
      return "errors.invalidDimensions";
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
  const t = useTranslations("suggestEdit");
  const tShell = useTranslations("shell");
  const tCommon = useTranslations("common");
  const relativeTime = useRelativeTime();

  usePageHeader(
    () => ({
      title: t(openProposal ? "editTitle" : "title"),
      crumbs: [
        { label: tShell("groups.community.label"), href: "/community" },
        { label: tShell("pages.puzzles.title"), href: "/puzzles" },
        { label: view.title, href: `/puzzles/${id}` },
      ],
    }),
    [t, tShell, view.title, id, openProposal],
  );

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

  const uploadBoxArt = useUploadBoxArt();
  const notifyBoxArtCheck = useBoxArtCheckNotice();
  const propose = useConvexMutation(gateway.catalog.proposeChange);
  const editProposal = useConvexMutation(gateway.catalog.editChangeProposal);

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

  const pendingArgs = buildProposalArgs(baseline, form, categories);
  const canSubmit = pendingArgs !== null || coverFile !== undefined;
  const changes = pendingChanges(pendingArgs, coverFile !== undefined);

  const submit = useMutation({
    mutationFn: async () => {
      // Busy-state rule: the upload happens inside the mutation so isPending spans it.
      let imageId = form.newImageStorageId;
      if (coverFile) {
        imageId = await coverStep(() => uploadBoxArt(coverFile));
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
      await notifyBoxArtCheck(args.image);
    },
    onSuccess: () => {
      toast.success(t(openProposal ? "updated" : "submitted"));
      router.push(`/puzzles/${id}`);
    },
    onError: (error) => {
      // A box-art upload URL refused by the member's upload limit says to wait (SEC-20).
      if (isUploadRateLimited(error)) {
        toast.error(tCommon("photoUploadRateLimited"));
        return;
      }
      // A limit refusal names the limit (the member's proposals, or the image upload's
      // cover-photo check) and when they can try again.
      const fromCover = error instanceof CoverStepError;
      const cause = fromCover ? error.original : error;
      const retryAt = rateLimitedRetryAt(cause, Date.now());
      toast.error(
        retryAt !== undefined
          ? t(fromCover ? "errors.coverRateLimited" : "errors.rateLimited", {
              when: relativeTime(retryAt),
            })
          : t(errorKeyFor(cause)),
      );
    },
  });

  const set = <K extends keyof ProposalFormState>(
    key: K,
    value: ProposalFormState[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const currentImageUrl =
    coverPreview ??
    (form.newImageStorageId ? openProposal?.proposedImageUrl : undefined) ??
    view.image ??
    undefined;
  const imageStateLabel =
    coverFile || form.newImageStorageId
      ? t("proposedImage")
      : t("currentImage");

  // Rendered twice — inline below `lg:` (its position today) and again inside the sticky
  // context panel at `lg:` — via the CSS-only hidden/visible split below, not two hand-written
  // copies: same element, same handlers, mounted at two DOM positions. The hint takes its own
  // full-width line above the buttons so it never squeezes into a narrow column beside them.
  const actionsRow = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {!canSubmit && (
        <span className="text-muted-foreground basis-full text-sm">
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
  );

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,42rem)_minmax(280px,22rem)]">
      <div className="flex w-full flex-col gap-6">
        <PuzzleDefinitionFields
          form={form}
          set={set}
          categories={categories}
          difficultySeed={view.difficulty ?? ""}
          shapeSeed={view.shape ?? ""}
          idPrefix="se"
          publisherSuggestions={publisherSuggestions ?? []}
          brandSuggestions={
            brandSuggestions?.filter((b): b is string => !!b) ?? []
          }
          seriesSuggestions={seriesSuggestions ?? []}
        />

        <div className="lg:hidden">
          <CoverImageField
            currentImageUrl={currentImageUrl}
            imageStateLabel={imageStateLabel}
            onPickFile={setCoverFile}
          />
        </div>

        <SectionDivider label={t("comment.label")} />

        <Textarea
          aria-label={t("comment.label")}
          value={form.comment}
          onChange={(e) => set("comment", e.target.value)}
          placeholder={t("comment.placeholder")}
          rows={2}
          maxLength={CATALOG_TEXT_LIMITS.comment}
        />

        {/* Below lg the side panel (and its "Changes (N)" recap) is hidden, so recap the
            changed fields right above the buttons. With nothing changed the action row's own
            hint already says why Submit is disabled, so no empty recap is shown. */}
        <div className="flex flex-col gap-4 lg:hidden">
          {canSubmit && <ChangesSummary changes={changes} />}
          {actionsRow}
        </div>
      </div>

      <aside className="hidden lg:sticky lg:top-[calc(var(--app-sticky-top,0px)+0.5rem)] lg:block lg:self-start">
        <FormContextPanel
          image={
            <CoverImageField
              variant="panel"
              currentImageUrl={currentImageUrl}
              imageStateLabel={imageStateLabel}
              onPickFile={setCoverFile}
            />
          }
          changes={changes}
          actions={actionsRow}
        />
      </aside>
    </div>
  );
}
