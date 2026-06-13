import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { useUser } from "@/compat/clerk";
import { useRouter } from "@/compat/navigation";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { CoverChip } from "@/components/library/cover-chip";
import { EmptyState } from "@/components/library/empty-state";
import { chipColor } from "@/components/library/palette";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmojiPickerInput } from "@/components/ui/emoji-picker-input";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { gateway, Id } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
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
  const router = useRouter();
  const t = useTranslations("collections");
  const tCommon = useTranslations("common");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState<{
    _id: string;
    // The domain CollectionId the update/delete mutations take; legacy rows may lack it.
    aggregateId?: string;
    name: string;
    description?: string;
    visibility: "private" | "public";
    color?: string;
    icon?: string;
  } | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    visibility: "private" as "private" | "public",
    color: "#3b82f6",
    icon: "📦",
  });

  const convexUser = useQuery(
    gateway.identity.byClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

  const collections = useQuery(
    gateway.collections.listForUser,
    convexUser?._id ? { userId: convexUser._id as Id<"users"> } : "skip",
  );

  const createCollection = useMutation(gateway.collections.create);
  const updateCollection = useMutation(gateway.collections.update);
  const deleteCollection = useMutation(gateway.collections.delete);

  const handleCreateCollection = async () => {
    try {
      await createCollection({
        name: formData.name,
        description: formData.description,
        visibility: formData.visibility,
        color: formData.color,
        icon: formData.icon,
        personalNotes: "",
      });
      setIsCreateDialogOpen(false);
      setFormData({
        name: "",
        description: "",
        visibility: "private",
        color: "#3b82f6",
        icon: "📦",
      });
    } catch (error) {
      console.error("Failed to create collection:", error);
    }
  };

  const handleEditCollection = async () => {
    if (!editingCollection) return;
    // The domain update takes the CollectionId (aggregateId); guard rows missing it.
    if (!editingCollection.aggregateId) {
      console.error("Cannot update: collection is missing its aggregateId.");
      return;
    }

    try {
      await updateCollection({
        collectionId: editingCollection.aggregateId,
        name: formData.name,
        description: formData.description,
        visibility: formData.visibility,
        color: formData.color,
        icon: formData.icon,
      });
      setIsEditDialogOpen(false);
      setEditingCollection(null);
      setFormData({
        name: "",
        description: "",
        visibility: "private",
        color: "#3b82f6",
        icon: "📦",
      });
    } catch (error) {
      console.error("Failed to update collection:", error);
    }
  };

  // Wired to a delete affordance in a follow-up; kept to preserve the intended flow.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleDeleteCollection = async (collectionAggregateId?: string) => {
    // The domain delete takes the CollectionId (aggregateId); guard rows missing it.
    if (!collectionAggregateId) {
      console.error("Cannot delete: collection is missing its aggregateId.");
      return;
    }
    if (confirm(t("deleteConfirm"))) {
      try {
        await deleteCollection({
          collectionId: collectionAggregateId,
        });
      } catch (error) {
        console.error("Failed to delete collection:", error);
      }
    }
  };

  const openEditDialog = (collection: {
    _id: string;
    aggregateId?: string;
    name: string;
    description?: string;
    visibility: "private" | "public";
    color?: string;
    icon?: string;
  }) => {
    setEditingCollection(collection);
    setFormData({
      name: collection.name,
      description: collection.description || "",
      visibility: collection.visibility,
      color: collection.color || "#3b82f6",
      icon: collection.icon || "📦",
    });
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
  usePageHeaderActions(
    () => (
      <>
        <span className="text-muted-foreground hidden text-sm sm:inline">
          {headerMeta}
        </span>
        <Button
          variant="brand"
          size="sm"
          onClick={() => setIsCreateDialogOpen(true)}
        >
          <Plus className="h-4 w-4" />
          {t("newCollection")}
        </Button>
      </>
    ),
    [headerMeta],
  );

  if (!user || convexUser === undefined || collections === undefined) {
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
        {/* Create Collection Dialog (unchanged flow, opened from the head) */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("createCollection")}</DialogTitle>
              <DialogDescription>
                {t("createCollectionDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">{t("name")}</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder={t("collectionNamePlaceholder")}
                />
              </div>
              <div>
                <Label htmlFor="description">{t("description")}</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder={t("descriptionPlaceholder")}
                />
              </div>
              <div>
                <Label htmlFor="visibility">{t("visibility")}</Label>
                <Select
                  value={formData.visibility}
                  onValueChange={(value: "private" | "public") =>
                    setFormData({ ...formData, visibility: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">
                      <div className="flex items-center gap-2">
                        <Lock className="h-4 w-4" />
                        {t("private")}
                      </div>
                    </SelectItem>
                    <SelectItem value="public">
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        {t("public")}
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="icon">{t("icon")}</Label>
                  <EmojiPickerInput
                    id="icon"
                    value={formData.icon}
                    onChange={(emoji) =>
                      setFormData({ ...formData, icon: emoji })
                    }
                    placeholder="📦"
                  />
                </div>
                <div>
                  <Label htmlFor="color">{t("color")}</Label>
                  <ColorPicker
                    value={formData.color}
                    onChange={(color) =>
                      setFormData({ ...formData, color: color })
                    }
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsCreateDialogOpen(false)}
              >
                {tCommon("cancel")}
              </Button>
              <Button onClick={handleCreateCollection}>{t("create")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Collections Grid: compact tiles — the sanctioned card use */}
        {collections.length === 0 ? (
          <EmptyState
            title={t("noCollections")}
            sub={t("createFirstCollection")}
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
              <div
                key={collection._id}
                role="button"
                tabIndex={0}
                className="bg-card flex cursor-pointer gap-3.5 rounded-xl border p-3.5 shadow-sm transition-shadow hover:shadow-md"
                onClick={() => router.push(`/collections/${collection._id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/collections/${collection._id}`);
                  }
                }}
              >
                <CoverChip
                  color={collection.color || chipColor(index)}
                  icon={FolderOpen}
                  emoji={collection.icon || undefined}
                  size={74}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-heading truncate text-lg font-bold">
                      {collection.name}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {collection.visibility === "private" ? (
                        <Lock className="text-muted-foreground h-4 w-4" />
                      ) : (
                        <Globe className="text-muted-foreground h-4 w-4" />
                      )}
                      {!collection.isDefault && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditDialog(collection);
                          }}
                        >
                          <Settings className="h-4 w-4" />
                        </Button>
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
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Edit Collection Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editCollection")}</DialogTitle>
            <DialogDescription>
              {t("editCollectionDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-name">{t("name")}</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder={t("collectionNamePlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="edit-description">{t("description")}</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder={t("descriptionPlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="edit-visibility">{t("visibility")}</Label>
              <Select
                value={formData.visibility}
                onValueChange={(value: "private" | "public") =>
                  setFormData({ ...formData, visibility: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">
                    <div className="flex items-center gap-2">
                      <Lock className="h-4 w-4" />
                      {t("private")}
                    </div>
                  </SelectItem>
                  <SelectItem value="public">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      {t("public")}
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-icon">{t("icon")}</Label>
                <EmojiPickerInput
                  id="edit-icon"
                  value={formData.icon}
                  onChange={(emoji) =>
                    setFormData({ ...formData, icon: emoji })
                  }
                  placeholder="📦"
                />
              </div>
              <div>
                <Label htmlFor="edit-color">{t("color")}</Label>
                <ColorPicker
                  value={formData.color}
                  onChange={(color) =>
                    setFormData({ ...formData, color: color })
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button onClick={handleEditCollection}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
