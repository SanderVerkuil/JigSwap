import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
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
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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

  // The member's WHOLE library: a collection organises any copy, not only the ones on offer
  // (kept-for-yourself, private and lent-out copies belong on a shelf too).
  const { data: libraryCopies, isPending: libraryCopiesPending } = useQuery(
    convexQuery(
      gateway.library.ownedByOwner,
      convexUser?._id
        ? {
            ownerId: convexUser._id as Id<"users">,
            includeUnavailable: true,
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

  // Adds each selected copy in turn. A copy that went in is deselected; one that failed (or that
  // lacks the aggregateId the domain add needs) stays selected, so a retry only re-sends those.
  // Returns how many failed: none → back to the collection, otherwise stay and say so.
  const addSelected = useMutation({
    mutationFn: async () => {
      let failed = 0;
      for (const copyDocId of selectedPuzzles) {
        const copy = libraryCopies?.find((p) => p._id === copyDocId);
        try {
          if (!collection?.aggregateId || !copy?.aggregateId) {
            throw new Error("Collection or copy is missing its aggregateId.");
          }
          await addPuzzleToCollection.mutateAsync({
            collectionId: collection.aggregateId,
            copyId: copy.aggregateId,
          });
          setSelectedPuzzles((current) => {
            const next = new Set(current);
            next.delete(copyDocId);
            return next;
          });
        } catch {
          failed += 1;
        }
      }
      return failed;
    },
    onSuccess: (failed) => {
      if (failed === 0) {
        router.push(`/collections/${id}`);
      } else {
        toast.error(t("picker.addFailed", { count: failed }));
      }
    },
  });

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
            onClick={() => addSelected.mutate()}
            disabled={selectedCount === 0 || addSelected.isPending}
          >
            <Plus className="h-4 w-4" />
            {t("addSelected", { count: selectedCount })}
          </Button>
        </>
      ),
    }),
    [collection?.name, id, selectedCount, addSelected.isPending],
  );

  // The library minus what's already in the collection, then narrowed by the search term.
  const notInCollection =
    libraryCopies?.filter(
      (puzzle) => !collection?.puzzles.map((p) => p?._id).includes(puzzle._id),
    ) ?? [];
  const filteredPuzzles = notInCollection.filter(
    (puzzle) =>
      puzzle.puzzle?.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (puzzle.puzzle?.brand &&
        puzzle.puzzle.brand.toLowerCase().includes(searchTerm.toLowerCase())),
  );

  if (
    collectionPending ||
    collection === undefined ||
    libraryCopiesPending ||
    libraryCopies === undefined ||
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

      {/* Puzzles Grid, or why it's empty: no library yet, everything is already in this
          collection, or nothing matches the search. */}
      {libraryCopies.length === 0 ? (
        <EmptyState
          title={t("picker.libraryEmpty")}
          sub={t("picker.libraryEmptyHint")}
          action={
            <Button variant="brand" asChild>
              <Link href="/my-puzzles/add">
                <Plus className="h-4 w-4" />
                {t("picker.addToLibrary")}
              </Link>
            </Button>
          }
        />
      ) : notInCollection.length === 0 ? (
        <EmptyState
          title={t("picker.allInCollection")}
          sub={t("picker.allInCollectionHint")}
        />
      ) : filteredPuzzles.length === 0 ? (
        <EmptyState
          title={t("picker.noMatch", { term: searchTerm.trim() })}
          sub={t("picker.noMatchHint")}
        />
      ) : (
        <PuzzleViewProvider viewMode="grid">
          {filteredPuzzles.map((puzzle) => (
            <PuzzleCard
              headingLevel={2}
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
