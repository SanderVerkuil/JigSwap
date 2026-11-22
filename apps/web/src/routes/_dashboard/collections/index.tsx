import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { CreateCollectionDialog } from "@/components/collections/create-collection-dialog";
import {
  EditCollectionDialog,
  type EditableCollection,
} from "@/components/collections/edit-collection-dialog";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { CoverChip } from "@/components/library/cover-chip";
import { EmptyState } from "@/components/library/empty-state";
import { chipColor } from "@/components/library/palette";
import { copyShelfBox } from "@/components/shelf/copy-box";
import { Shelf, ShelfLedge } from "@/components/shelf/shelf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery } from "@convex-dev/react-query";
import type { CollectionView } from "@jigswap/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FolderOpen, Globe, Lock, Plus, Settings } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/collections/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "collections") }],
  }),
  pendingComponent: () => <CollectionsPending />,
  component: CollectionsPage,
});

function CollectionsPending() {
  const t = useTranslations("collections");
  return <PageLoading message={t("loadingCollections")} />;
}

function CollectionsPage() {
  const { user } = useUser();
  const t = useTranslations("collections");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingCollection, setEditingCollection] =
    useState<EditableCollection | null>(null);

  const { data: convexUser, isPending: convexUserPending } = useQuery(
    convexQuery(gateway.identity.currentUser, {}),
  );

  const { data: collections, isPending: collectionsPending } = useQuery(
    convexQuery(
      gateway.collections.listForUser,
      convexUser?._id
        ? { userId: convexUser._id as Id<"users">, shelves: true }
        : "skip",
    ),
  );

  const openEditDialog = (collection: EditableCollection) => {
    setEditingCollection(collection);
    setIsEditDialogOpen(true);
  };

  // The page title lives in the shell page head; publish the shelf/puzzle meta
  // + the create flow there so the body carries no duplicate section header.
  const loadedCollections = collections ?? [];
  const totalPuzzles = loadedCollections.reduce(
    (sum, collection) => sum + (collection.puzzleCount ?? 0),
    0,
  );
  const headerMeta = t("meta", {
    shelves: loadedCollections.length,
    puzzles: totalPuzzles,
  });
  usePageHeader(
    () => ({
      meta: headerMeta,
      actions: (
        <Button size="sm" onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("newCollection")}
        </Button>
      ),
    }),
    [headerMeta],
  );

  if (
    !user ||
    convexUserPending ||
    convexUser === undefined ||
    collectionsPending ||
    collections === undefined
  ) {
    return (
      <div className="flex flex-col gap-10">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="mb-5 h-8 w-64" />
            <Skeleton className="h-28 w-full rounded-none" />
            <ShelfLedge />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      {/* The shelf meta + create action now live in the shell page head. */}
      <section>
        <CreateCollectionDialog
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
        />

        {collections.length === 0 ? (
          <EmptyState
            title={t("noCollections")}
            sub={t("emptyHint")}
            action={
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                {t("newCollection")}
              </Button>
            }
          />
        ) : (
          // A collection is a shelf with its own name: one shelf a collection, like a bookcase.
          <div className="flex flex-col gap-10">
            {collections.map((collection, index) => (
              <CollectionShelf
                key={collection._id}
                collection={collection}
                color={collection.color || chipColor(index)}
                onEdit={openEditDialog}
              />
            ))}
          </div>
        )}
      </section>

      <EditCollectionDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        collection={editingCollection}
      />
    </div>
  );
}

// One collection on the Collections page: its name (opening it) with its count and who may see it,
// then its newest boxes on its shelf, each opening the copy under the collection's breadcrumbs.
function CollectionShelf({
  collection,
  color,
  onEdit,
}: {
  collection: CollectionView;
  color: string;
  onEdit: (collection: EditableCollection) => void;
}) {
  const t = useTranslations("collections");
  const tCommon = useTranslations("common");
  const href = `/collections/${collection._id}`;
  const boxes = (collection.shelf ?? []).map((copy) =>
    copyShelfBox(
      copy,
      `/my-puzzles/${copy._id}?from=collection:${collection._id}`,
    ),
  );
  const Visibility = collection.visibility === "private" ? Lock : Globe;
  return (
    <section>
      <SectionHead
        title={
          <Link
            href={href}
            className="flex min-w-0 items-center gap-2.5 underline-offset-4 hover:underline"
          >
            <CoverChip
              color={color}
              icon={FolderOpen}
              emoji={collection.icon || undefined}
              size={28}
            />
            <span className="truncate">{collection.name}</span>
          </Link>
        }
        meta={
          <span className="inline-flex items-center gap-2">
            {t("puzzleCount", { count: collection.puzzleCount })}
            <Visibility
              className="size-4"
              role="img"
              aria-label={t(collection.visibility)}
            />
            {collection.isDefault && (
              <Badge variant="outline">{t("default")}</Badge>
            )}
          </span>
        }
        action={
          !collection.isDefault && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t("editNamed", { name: collection.name })}
              onClick={() => onEdit(collection)}
            >
              <Settings className="h-4 w-4" aria-hidden />
            </Button>
          )
        }
      />
      {collection.description && (
        <p className="text-muted-foreground -mt-3 mb-2 line-clamp-1 text-sm">
          {collection.description}
        </p>
      )}
      {boxes.length > 0 ? (
        <Shelf boxes={boxes} label={collection.name} />
      ) : (
        // An empty shelf invites filling it. One whose boxes this read left out (past its budget,
        // or before the backend sent shelves) opens the collection instead.
        <div>
          <div className="flex flex-col items-start gap-3 pt-2 pb-5">
            {collection.puzzleCount === 0 && (
              <p className="text-muted-foreground text-sm">
                {t("noPuzzlesInCollection")}
              </p>
            )}
            <Button variant="outline" size="sm" asChild>
              {collection.puzzleCount === 0 ? (
                <Link href={`${href}/add-puzzles`}>{t("addPuzzles")}</Link>
              ) : (
                <Link href={href}>{tCommon("view")}</Link>
              )}
            </Button>
          </div>
          <ShelfLedge />
        </div>
      )}
    </section>
  );
}
