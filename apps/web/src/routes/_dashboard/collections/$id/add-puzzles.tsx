import { createFileRoute } from "@tanstack/react-router";

import { useUser } from "@/compat/clerk";
import { useRouter } from "@/compat/navigation";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { EmptyState } from "@/components/library/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageLoading } from "@/components/ui/loading";
import { PuzzleCard, PuzzleViewProvider } from "@/components/ui/puzzle-card";
import { gateway, Id } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/collections/$id/add-puzzles")(
  {
    head: ({ match }) => ({
      meta: [{ title: pageTitle(match.context, "collectionAddPuzzles") }],
    }),
    pendingComponent: () => <AddPuzzlesPending />,
    component: AddPuzzlesToCollectionPage,
  },
);

function AddPuzzlesPending() {
  const tCommon = useTranslations("common");
  return <PageLoading message={tCommon("loading")} />;
}

function AddPuzzlesToCollectionPage() {
  const { id } = Route.useParams();
  const { user } = useUser();
  const router = useRouter();
  const t = useTranslations("collections");
  const tCommon = useTranslations("common");
  const tShell = useTranslations("shell");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPuzzles, setSelectedPuzzles] = useState<
    Set<Id<"ownedPuzzles">>
  >(new Set());

  const { data: convexUser, isPending: convexUserPending } = useQuery(
    convexQuery(
      gateway.identity.byClerkId,
      user?.id ? { clerkId: user.id } : "skip",
    ),
  );

  const { data: collection, isPending: collectionPending } = useQuery(
    convexQuery(gateway.collections.byId, {
      collectionId: id as Id<"collections">,
    }),
  );

  const { data: availablePuzzles, isPending: availablePuzzlesPending } =
    useQuery(
      convexQuery(
        gateway.library.ownedByOwner,
        convexUser?._id
          ? {
              ownerId: convexUser._id as Id<"users">,
              includeUnavailable: false,
            }
          : "skip",
      ),
    );

  const addPuzzleToCollection = useMutation({
    mutationFn: useConvexMutation(gateway.collections.addOwnedPuzzle),
  });

  const togglePuzzleSelection = (puzzleId: Id<"ownedPuzzles">) => {
    const newSelected = new Set(selectedPuzzles);
    if (newSelected.has(puzzleId)) {
      newSelected.delete(puzzleId);
    } else {
      newSelected.add(puzzleId);
    }
    setSelectedPuzzles(newSelected);
  };

  const handleAddSelectedPuzzles = async () => {
    // The domain add takes the Collection + Copy aggregateIds; resolve them from the loaded
    // collection and the selected copy rows, skipping any that predate the backfill.
    if (!collection?.aggregateId) {
      console.error("Cannot add: collection is missing its aggregateId.");
      return;
    }
    try {
      for (const puzzleId of selectedPuzzles) {
        const copy = availablePuzzles?.find((p) => p._id === puzzleId);
        if (!copy?.aggregateId) {
          console.error("Skipping copy missing its aggregateId:", puzzleId);
          continue;
        }
        await addPuzzleToCollection.mutateAsync({
          collectionId: collection.aggregateId,
          copyId: copy.aggregateId,
        });
      }
      router.push(`/collections/${id}`);
    } catch (error) {
      console.error("Failed to add puzzles to collection:", error);
    }
  };

  // Publish an explicit breadcrumb trail + the route title so the chrome reads
  // My Library › Collections › <name> › Add Puzzles, plus the primary actions
  // (Cancel + the count-aware confirm) into the page head.
  const selectedCount = selectedPuzzles.size;
  usePageHeader(
    () => ({
      title: t("addPuzzles"),
      crumbs: [
        { label: tShell("groups.library.label"), href: "/library" },
        { label: tShell("pages.collections.title"), href: "/collections" },
        ...(collection
          ? [{ label: collection.name, href: `/collections/${id}` }]
          : []),
      ],
      actions: (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/collections/${id}`)}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            variant="brand"
            size="sm"
            onClick={handleAddSelectedPuzzles}
            disabled={selectedCount === 0}
          >
            <Plus className="h-4 w-4" />
            {t("addSelected", { count: selectedCount })}
          </Button>
        </>
      ),
    }),
    [collection?.name, id, selectedCount],
  );

  // Filter puzzles based on search term
  const filteredPuzzles =
    availablePuzzles
      ?.filter(
        (puzzle) =>
          !collection?.puzzles.map((p) => p?._id).includes(puzzle._id),
      )
      ?.filter(
        (puzzle) =>
          puzzle.puzzle?.title
            .toLowerCase()
            .includes(searchTerm.toLowerCase()) ||
          (puzzle.puzzle?.brand &&
            puzzle.puzzle.brand
              .toLowerCase()
              .includes(searchTerm.toLowerCase())),
      ) || [];

  if (
    collectionPending ||
    collection === undefined ||
    availablePuzzlesPending ||
    availablePuzzles === undefined ||
    convexUserPending ||
    convexUser === undefined
  ) {
    return <PageLoading message={tCommon("loading")} />;
  }

  if (collection === null) {
    return <div className="text-muted-foreground">{t("notFound")}</div>;
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Search */}
      <div className="relative w-full max-w-sm">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          type="text"
          placeholder={tCommon("search")}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Puzzles Grid */}
      {filteredPuzzles.length === 0 ? (
        <EmptyState
          title={t("noPuzzlesAvailable")}
          sub={t("addPuzzlesFirst")}
        />
      ) : (
        <PuzzleViewProvider viewMode="grid">
          {filteredPuzzles.map((puzzle) => (
            <PuzzleCard
              key={puzzle._id}
              puzzle={puzzle}
              variant="selection"
              isSelected={selectedPuzzles.has(puzzle._id as Id<"ownedPuzzles">)}
              onSelect={togglePuzzleSelection}
            />
          ))}
        </PuzzleViewProvider>
      )}
    </div>
  );
}
