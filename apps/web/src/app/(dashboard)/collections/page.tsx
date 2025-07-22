"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUser } from "@clerk/nextjs";
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { FolderOpen, Globe, Lock, Plus, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmojiPickerInput } from "@/components/ui/emoji-picker-input";
import { PageLoading } from "@/components/ui/loading";

export default function CollectionsPage() {
  const { user } = useUser();
  const router = useRouter();
  const t = useTranslations("collections");
  const tCommon = useTranslations("common");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState<{
    _id: string;
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
    api.users.getUserByClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

  const collections = useQuery(
    api.collections.getUserCollections,
    convexUser?._id ? { userId: convexUser._id } : "skip",
  );

  const createCollection = useMutation(api.collections.createCollection);
  const updateCollection = useMutation(api.collections.updateCollection);
  const deleteCollection = useMutation(api.collections.deleteCollection);

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

    try {
      await updateCollection({
        collectionId: editingCollection._id as Id<"collections">,
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

  const handleDeleteCollection = async (collectionId: Id<"collections">) => {
    if (confirm("Are you sure you want to delete this collection?")) {
      try {
        await deleteCollection({
          collectionId,
        });
      } catch (error) {
        console.error("Failed to delete collection:", error);
      }
    }
  };

  const openEditDialog = (collection: {
    _id: string;
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

  if (!user || convexUser === undefined || collections === undefined) {
    return <PageLoading message={tCommon("loading")} />;
  }

  return (
    <div className="container mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("myCollections")}</h1>
          <p className="text-muted-foreground">{t("organizePuzzles")}</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              {t("createCollection")}
            </Button>
          </DialogTrigger>
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
      </div>

      {/* Collections Grid */}
      {collections?.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-muted-foreground mb-4">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                <FolderOpen className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-medium mb-2">{t("noCollections")}</h3>
              <p className="text-sm">{t("createFirstCollection")}</p>
            </div>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t("createCollection")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {collections?.map((collection) => (
            <Card
              key={collection._id}
              className="hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => router.push(`/collections/${collection._id}`)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-8 h-8 rounded flex items-center justify-center text-lg"
                      style={{
                        backgroundColor: collection.color + "50",
                        color: collection.color,
                      }}
                    >
                      {collection.icon}
                    </div>
                    <CardTitle className="text-lg">{collection.name}</CardTitle>
                  </div>
                  <div className="flex items-center gap-1">
                    {collection.visibility === "private" ? (
                      <Lock className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Globe className="h-4 w-4 text-muted-foreground" />
                    )}
                    {!collection.isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
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
                  <CardDescription className="line-clamp-2">
                    {collection.description}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">
                    {collection.puzzleCount} {t("puzzles")}
                  </Badge>
                  {collection.isDefault && (
                    <Badge variant="outline">{t("default")}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
