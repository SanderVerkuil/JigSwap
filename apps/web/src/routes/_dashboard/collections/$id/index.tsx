import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { Link } from "@/compat/link";
import { useRouter } from "@/compat/navigation";
import {
  computeCollectionStats,
  DifficultyMix,
  StatsBar,
  type DifficultyTier,
} from "@/components/collections/collection-stats";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { CoverChip } from "@/components/library/cover-chip";
import { EmptyState } from "@/components/library/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { gateway, Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { Edit, FolderOpen, Plus, Puzzle, Share2 } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

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
  const format = useFormatter();
  const t = useTranslations("collections");
  const tCommon = useTranslations("common");
  const tPuzzles = useTranslations("puzzles");

  const collection = useQuery(gateway.collections.byId, {
    collectionId: id as Id<"collections">,
  });

  const removeFromCollection = useMutation(
    gateway.collections.removeOwnedPuzzle,
  );

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

  const handleRemovePuzzle = async (ownedPuzzleId: Id<"ownedPuzzles">) => {
    // The domain remove takes the Collection + Copy aggregateIds; resolve them from the loaded
    // collection and its member rows, and guard rows that predate the backfill.
    const copy = collection?.puzzles?.find((p) => p && p._id === ownedPuzzleId);
    if (!collection?.aggregateId || !copy?.aggregateId) {
      console.error(
        "Cannot remove: collection or copy is missing aggregateId.",
      );
      return;
    }
    try {
      await removeFromCollection({
        collectionId: collection.aggregateId,
        copyId: copy.aggregateId,
      });
    } catch (error) {
      console.error("Failed to remove puzzle from collection:", error);
    }
  };

  const handleShare = async () => {
    // Copy the current page URL to the clipboard; guard for SSR / browsers that
    // lack the async clipboard API.
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t("linkCopied"));
    } catch (error) {
      console.error("Failed to copy collection link:", error);
    }
  };

  if (collection === undefined) {
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

  return (
    <div className="flex w-full flex-col gap-8">
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
            <Button variant="brand" asChild>
              <Link href={`/collections/${id}/add-puzzles`}>
                <Plus className="h-4 w-4" />
                {t("addPuzzles")}
              </Link>
            </Button>
            <Button variant="outline" onClick={handleShare}>
              <Share2 className="h-4 w-4" />
              {t("share")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => router.push(`/collections/${id}/edit`)}
            >
              <Edit className="h-4 w-4" />
              {tCommon("edit")}
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground shrink-0 text-xs">
          {t("updatedAgo", {
            time: format.relativeTime(new Date(collection.updatedAt)),
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
          sub={t("addPuzzlesFirst")}
          action={
            <Button variant="brand" asChild>
              <Link href={`/collections/${id}/add-puzzles`}>
                <Plus className="h-4 w-4" />
                {t("addPuzzles")}
              </Link>
            </Button>
          }
        />
      ) : (
        <PuzzleViewProvider viewMode="grid">
          {puzzles.map((puzzle) => (
            <PuzzleCard
              key={puzzle._id}
              puzzle={puzzle}
              variant="collection"
              onRemove={handleRemovePuzzle}
            />
          ))}
        </PuzzleViewProvider>
      )}
    </div>
  );
}
