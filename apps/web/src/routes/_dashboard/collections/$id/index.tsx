import { Link } from "@/compat/link";
import { useRouter } from "@/compat/navigation";
import {
  computeCollectionStats,
  DifficultyMix,
  StatsBar,
  type DifficultyTier,
} from "@/components/collections/collection-stats";
import {
  EditCollectionDialog,
  type EditableCollection,
} from "@/components/collections/edit-collection-dialog";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { CoverChip } from "@/components/library/cover-chip";
import { EmptyState } from "@/components/library/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageLoading } from "@/components/ui/loading";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { gateway, Id } from "@/gateway";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { pageTitle } from "@/lib/page-title";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ChevronRight,
  Edit,
  FolderOpen,
  Globe,
  Lock,
  Plus,
  Puzzle,
  Share2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/collections/$id/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "collection") }],
  }),
  pendingComponent: () => <CollectionPending />,
  component: CollectionDetailPage,
});

function CollectionPending() {
  const tCommon = useTranslations("common");
  return <PageLoading message={tCommon("loading")} />;
}

function CollectionDetailPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { member } = useCurrentMember();
  const relativeTime = useRelativeTime();
  const t = useTranslations("collections");
  const tCommon = useTranslations("common");
  const tPuzzles = useTranslations("puzzles");

  const { data: collection, isPending: collectionPending } = useQuery(
    convexQuery(gateway.collections.byId, {
      collectionId: id as Id<"collections">,
    }),
  );

  const removeFromCollection = useMutation({
    mutationFn: useConvexMutation(gateway.collections.removeOwnedPuzzle),
  });
  const addToCollection = useMutation({
    mutationFn: useConvexMutation(gateway.collections.addOwnedPuzzle),
  });
  const updateCollection = useMutation({
    mutationFn: useConvexMutation(gateway.collections.update),
  });
  const [shareOpen, setShareOpen] = useState(false);
  const sharing = updateCollection.isPending;
  const [editOpen, setEditOpen] = useState(false);

  // Publish only the collection name as the page-head title so the chrome
  // breadcrumb reads My Library › Collections › <name>. The Add/Share/Edit
  // actions now live in the in-content hero block per the redesign, so this
  // page intentionally publishes no header `actions`.
  usePageHeader(() => ({ title: collection?.name }), [collection?.name]);

  const puzzles = useMemo(
    () => (collection?.puzzles ?? []).filter((p) => p != null),
    [collection?.puzzles],
  );

  const stats = useMemo(() => computeCollectionStats(puzzles), [puzzles]);

  // Takes a copy out of this collection (the copy stays in the library), confirmed by a toast
  // whose Undo puts it back. The domain remove/add take the Collection + Copy aggregateIds.
  const handleRemovePuzzle = async (ownedPuzzleId: Id<"ownedPuzzles">) => {
    const copy = collection?.puzzles?.find((p) => p && p._id === ownedPuzzleId);
    const collectionId = collection?.aggregateId;
    const copyId = copy?.aggregateId;
    if (!collectionId || !copyId) {
      toast.error(t("removeError"));
      return;
    }
    try {
      await removeFromCollection.mutateAsync({ collectionId, copyId });
    } catch {
      toast.error(t("removeError"));
      return;
    }
    toast.success(t("removed", { title: copy?.puzzle?.title ?? "" }), {
      action: {
        label: t("undo"),
        onClick: () => {
          addToCollection
            .mutateAsync({ collectionId, copyId })
            .catch(() => toast.error(t("undoRemoveError")));
        },
      },
    });
  };

  // Copy the current page URL to the clipboard; guard for SSR / browsers that
  // lack the async clipboard API. Returns whether the copy succeeded.
  const copyLink = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return false;
    try {
      await navigator.clipboard.writeText(window.location.href);
      return true;
    } catch (error) {
      console.error("Failed to copy collection link:", error);
      return false;
    }
  };

  // Public collections are link-shareable directly; private ones first ask the
  // owner how to share (the collection model only supports private/public —
  // per-circle sharing exists at the copy level, not the collection level).
  const handleShare = async () => {
    if (collection?.visibility === "public") {
      if (await copyLink()) toast.success(t("linkCopied"));
      return;
    }
    setShareOpen(true);
  };

  const handleMakePublic = async () => {
    if (!collection?.aggregateId) {
      console.error("Cannot share: collection is missing its aggregateId.");
      return;
    }
    try {
      await updateCollection.mutateAsync({
        collectionId: collection.aggregateId,
        visibility: "public",
      });
      const copied = await copyLink();
      toast.success(
        copied ? t("shareDialog.madePublic") : t("shareDialog.madePublicNote"),
      );
      setShareOpen(false);
    } catch (error) {
      console.error("Failed to make collection public:", error);
      toast.error(t("shareDialog.error"));
    }
  };

  const handleCopyPrivate = async () => {
    if (await copyLink()) toast.success(t("shareDialog.privateLinkCopied"));
    setShareOpen(false);
  };

  if (collectionPending || collection === undefined) {
    return <PageLoading message={tCommon("loading")} />;
  }

  if (collection === null) {
    return <div className="text-muted-foreground">{t("notFound")}</div>;
  }

  const tierLabels: Record<DifficultyTier, string> = {
    easy: tPuzzles("easy"),
    medium: tPuzzles("medium"),
    hard: tPuzzles("hard"),
    expert: tPuzzles("expert"),
  };

  const isEmpty = puzzles.length === 0;
  // A public collection is open to visitors too; only its owner may change it.
  const viewerOwnsCollection = !!member && member._id === collection.userId;

  return (
    <div className="flex w-full flex-col gap-8">
      {/* Edit dialog — opened by the Edit button in the hero. The collection
          data from the query is passed directly; it re-seeds on open. */}
      <EditCollectionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        collection={
          collection
            ? ({
                _id: collection._id,
                aggregateId: collection.aggregateId,
                name: collection.name,
                description: collection.description ?? undefined,
                visibility: collection.visibility,
                color: collection.color ?? undefined,
                icon: collection.icon ?? undefined,
                isDefault: collection.isDefault,
              } satisfies EditableCollection)
            : null
        }
        onDeleted={() => router.push("/collections")}
      />

      {/* Share dialog — only reached for private collections (public ones copy
          the link directly). Offers making it public or copying a private,
          owner-only link. */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("shareDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("shareDialog.privateExplain")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleMakePublic}
              disabled={sharing}
              className="hover:bg-accent flex items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60"
            >
              <span className="bg-jigsaw-success/15 text-jigsaw-success flex size-9 shrink-0 items-center justify-center rounded-full">
                <Globe className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">
                  {t("shareDialog.makePublic")}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {t("shareDialog.makePublicHint")}
                </span>
              </span>
              <ChevronRight className="text-muted-foreground size-4 shrink-0" />
            </button>
            <button
              type="button"
              onClick={handleCopyPrivate}
              disabled={sharing}
              className="hover:bg-accent flex items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60"
            >
              <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full">
                <Lock className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">
                  {t("shareDialog.keepPrivate")}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {t("shareDialog.keepPrivateHint")}
                </span>
              </span>
              <ChevronRight className="text-muted-foreground size-4 shrink-0" />
            </button>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShareOpen(false)}
              disabled={sharing}
            >
              {tCommon("cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hero — open block, not a boxed card. */}
      <div className="flex flex-wrap items-start gap-5">
        <CoverChip
          color={collection.color || "#6048e8"}
          icon={FolderOpen}
          emoji={collection.icon || undefined}
          size={96}
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-2xl font-bold tracking-tight">
              {collection.name}
            </h1>
            <Badge
              variant="outline"
              className={cn(
                collection.visibility === "public"
                  ? "bg-jigsaw-success/15 text-jigsaw-success border-transparent"
                  : "text-muted-foreground",
              )}
            >
              {collection.visibility === "public" ? t("public") : t("private")}
            </Badge>
          </div>
          {collection.description && (
            <p className="text-muted-foreground max-w-2xl text-sm">
              {collection.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2.5">
            {viewerOwnsCollection && (
              <Button variant="brand" asChild>
                <Link href={`/collections/${id}/add-puzzles`}>
                  <Plus className="h-4 w-4" />
                  {t("addPuzzles")}
                </Link>
              </Button>
            )}
            <Button variant="outline" onClick={handleShare}>
              <Share2 className="h-4 w-4" />
              {t("share")}
            </Button>
            {viewerOwnsCollection && (
              <Button variant="ghost" onClick={() => setEditOpen(true)}>
                <Edit className="h-4 w-4" />
                {tCommon("edit")}
              </Button>
            )}
          </div>
        </div>
        <p className="text-muted-foreground shrink-0 text-xs">
          {t("updatedAgo", {
            time: relativeTime(new Date(collection.updatedAt)),
          })}
        </p>
      </div>

      {/* Stats bar — only meaningful when the collection has members. */}
      {!isEmpty && (
        <StatsBar
          cells={[
            { value: String(stats.puzzleCount), label: t("puzzles") },
            {
              value: stats.piecesTotal.toLocaleString(),
              label: t("piecesTotal"),
            },
            {
              value: stats.avgDifficulty
                ? tierLabels[stats.avgDifficulty]
                : "—",
              label: t("avgDifficulty"),
            },
            { value: String(stats.upForTrade), label: t("upForTrade") },
          ]}
        >
          <DifficultyMix
            label={t("difficultyMix")}
            mix={stats.difficultyMix}
            tierLabels={tierLabels}
          />
        </StatsBar>
      )}

      {/* Section head */}
      <div className="flex items-center justify-between border-b pb-2.5">
        <h2 className="font-heading flex items-center gap-2 text-lg font-bold">
          <Puzzle aria-hidden className="text-jigsaw-primary h-5 w-5" />
          {t("puzzlesInCollection")}
        </h2>
        <span className="text-muted-foreground text-sm">
          {t("puzzleCount", { count: puzzles.length })}
        </span>
      </div>

      {/* Puzzle grid */}
      {isEmpty ? (
        <EmptyState
          title={t("noPuzzlesInCollection")}
          sub={viewerOwnsCollection ? t("addPuzzlesFirst") : undefined}
          action={
            viewerOwnsCollection ? (
              <Button variant="brand" asChild>
                <Link href={`/collections/${id}/add-puzzles`}>
                  <Plus className="h-4 w-4" />
                  {t("addPuzzles")}
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <PuzzleViewProvider viewMode="grid">
          {puzzles.map((puzzle) => (
            <PuzzleCard
              key={puzzle._id}
              puzzle={puzzle}
              variant="collection"
              onRemove={viewerOwnsCollection ? handleRemovePuzzle : undefined}
              // One URL per copy for its owner: their own copies open on /my-puzzles (as from
              // My Puzzles); visitors get the public /copies page. Both keep the collection
              // as breadcrumb context.
              viewBasePath={viewerOwnsCollection ? "/my-puzzles" : "/copies"}
              viewSearch={`?from=collection:${id}`}
            />
          ))}
        </PuzzleViewProvider>
      )}
    </div>
  );
}
