import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { CreateCollectionDialog } from "@/components/collections/create-collection-dialog";
import {
  EditCollectionDialog,
  type EditableCollection,
} from "@/components/collections/edit-collection-dialog";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { CoverChip } from "@/components/library/cover-chip";
import { EmptyState } from "@/components/library/empty-state";
import { chipColor } from "@/components/library/palette";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
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
    convexQuery(
      gateway.identity.byClerkId,
      user?.id ? { clerkId: user.id } : "skip",
    ),
  );

  const { data: collections, isPending: collectionsPending } = useQuery(
    convexQuery(
      gateway.collections.listForUser,
      convexUser?._id ? { userId: convexUser._id as Id<"users"> } : "skip",
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
        <Button
          variant="brand"
          size="sm"
          onClick={() => setIsCreateDialogOpen(true)}
        >
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
      <div className="flex flex-col gap-7">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-[18px]">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-xl" />
          ))}
        </div>
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

        {/* Collections Grid: compact tiles — the sanctioned card use */}
        {collections.length === 0 ? (
          <EmptyState
            title={t("noCollections")}
            sub={t("emptyHint")}
            action={
              <Button
                variant="brand"
                onClick={() => setIsCreateDialogOpen(true)}
              >
                <Plus className="h-4 w-4" />
                {t("newCollection")}
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-[18px]">
            {collections.map((collection, index) => (
              // The tile is one link to the collection; its Edit button sits beside the link
              // (positioned over its top-right corner), never nested inside it.
              <div key={collection._id} className="relative">
                <Link
                  href={`/collections/${collection._id}`}
                  className="bg-card focus-visible:ring-ring/50 flex h-full gap-3.5 rounded-xl border p-3.5 shadow-sm transition-shadow outline-none hover:shadow-md focus-visible:ring-[3px]"
                >
                  <CoverChip
                    color={collection.color || chipColor(index)}
                    icon={FolderOpen}
                    emoji={collection.icon || undefined}
                    size={74}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        "flex items-start justify-between gap-2",
                        // Room for the Edit button over the corner.
                        !collection.isDefault && "pr-10",
                      )}
                    >
                      <div className="font-heading truncate text-lg font-bold">
                        {collection.name}
                      </div>
                      <div className="flex shrink-0 items-center pt-1.5">
                        {collection.visibility === "private" ? (
                          <Lock
                            className="text-muted-foreground h-4 w-4"
                            role="img"
                            aria-label={t("private")}
                          />
                        ) : (
                          <Globe
                            className="text-muted-foreground h-4 w-4"
                            role="img"
                            aria-label={t("public")}
                          />
                        )}
                      </div>
                    </div>
                    {collection.description && (
                      <p className="text-muted-foreground mt-0.5 line-clamp-1 text-sm">
                        {collection.description}
                      </p>
                    )}
                    <div className="mt-2.5 flex items-center gap-2">
                      <Badge variant="secondary">
                        {collection.puzzleCount} {t("puzzles")}
                      </Badge>
                      {collection.isDefault && (
                        <Badge variant="outline">{t("default")}</Badge>
                      )}
                    </div>
                  </div>
                </Link>
                {!collection.isDefault && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 size-9"
                    aria-label={t("editNamed", { name: collection.name })}
                    onClick={() => openEditDialog(collection)}
                  >
                    <Settings className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </div>
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
