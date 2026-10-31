import { isDuplicateCollectionName } from "@/components/collections/collection-name";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { Globe, Lock, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export type EditableCollection = {
  _id: string;
  // The domain CollectionId the update mutation takes; legacy rows may lack it.
  aggregateId?: string;
  name: string;
  description?: string;
  visibility: "private" | "public";
  color?: string;
  icon?: string;
  // The default collection can't be deleted, so the editor offers no Delete for it.
  isDefault?: boolean;
};

type FormData = {
  name: string;
  description: string;
  visibility: "private" | "public";
  color: string;
  icon: string;
};

function collectionToForm(c: EditableCollection | null): FormData {
  return {
    name: c?.name ?? "",
    description: c?.description ?? "",
    visibility: c?.visibility ?? "private",
    color: c?.color ?? "#3b82f6",
    icon: c?.icon ?? "📦",
  };
}

export function EditCollectionDialog({
  open,
  onOpenChange,
  collection,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: EditableCollection | null;
  /** Called after the collection was deleted (e.g. to leave its now-missing page). */
  onDeleted?: () => void;
}) {
  // Radix only mounts DialogContent's children while open, so keying the inner form by the
  // collection id re-initialises its state fresh on every open (and when the target changes) —
  // no re-seeding effect needed.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <EditCollectionForm
          key={collection?._id ?? "new"}
          collection={collection}
          onOpenChange={onOpenChange}
          onDeleted={onDeleted}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditCollectionForm({
  collection,
  onOpenChange,
  onDeleted,
}: {
  collection: EditableCollection | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const t = useTranslations("collections");
  const tCommon = useTranslations("common");

  const updateCollection = useMutation({
    mutationFn: useConvexMutation(gateway.collections.update),
  });
  const deleteCollection = useMutation({
    mutationFn: useConvexMutation(gateway.collections.delete),
  });

  const [formData, setFormData] = useState<FormData>(() =>
    collectionToForm(collection),
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const name = formData.name.trim();

  const handleSave = async () => {
    if (!collection?.aggregateId) {
      toast.error(t("saveError"));
      return;
    }
    try {
      await updateCollection.mutateAsync({
        collectionId: collection.aggregateId,
        name,
        description: formData.description,
        visibility: formData.visibility,
        color: formData.color,
        icon: formData.icon,
      });
      onOpenChange(false);
    } catch (error) {
      if (isDuplicateCollectionName(error)) {
        setNameError(t("duplicateName", { name }));
      } else {
        toast.error(t("saveError"));
      }
    }
  };

  // Deleting removes the collection only; its puzzles stay in the library. The default
  // collection can't be deleted (the domain refuses), so it gets no Delete at all.
  const deletable =
    collection?.aggregateId && !collection.isDefault ? collection : null;
  const handleDelete = async () => {
    if (!collection?.aggregateId) return;
    try {
      await deleteCollection.mutateAsync({
        collectionId: collection.aggregateId,
      });
      toast.success(t("deleted", { name: collection.name }));
      setConfirmDeleteOpen(false);
      onOpenChange(false);
      onDeleted?.();
    } catch {
      toast.error(t("deleteError"));
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("editCollection")}</DialogTitle>
        <DialogDescription>{t("editCollectionDescription")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="edit-col-name">{t("name")}</Label>
          <Input
            id="edit-col-name"
            value={formData.name}
            onChange={(e) => {
              setNameError(null);
              setFormData({ ...formData, name: e.target.value });
            }}
            placeholder={t("collectionNamePlaceholder")}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "edit-col-name-error" : undefined}
          />
          {nameError && (
            <p id="edit-col-name-error" className="text-destructive text-sm">
              {nameError}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-col-description">{t("description")}</Label>
          <Textarea
            id="edit-col-description"
            value={formData.description}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
            placeholder={t("descriptionPlaceholder")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-col-visibility">{t("visibility")}</Label>
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
          <div className="space-y-2">
            <Label htmlFor="edit-col-icon">{t("icon")}</Label>
            <EmojiPickerInput
              id="edit-col-icon"
              value={formData.icon}
              onChange={(emoji) => setFormData({ ...formData, icon: emoji })}
              placeholder="📦"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-col-color">{t("color")}</Label>
            <ColorPicker
              value={formData.color}
              onChange={(color) => setFormData({ ...formData, color: color })}
            />
          </div>
        </div>
      </div>
      <DialogFooter>
        {deletable && (
          <AlertDialog
            open={confirmDeleteOpen}
            onOpenChange={setConfirmDeleteOpen}
          >
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive sm:mr-auto"
              >
                <Trash2 className="h-4 w-4" />
                {t("deleteCollection")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("deleteConfirmTitle", { name: deletable.name })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("deleteConfirmBody")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                <Button
                  variant="destructive"
                  onClick={() => void handleDelete()}
                  disabled={deleteCollection.isPending}
                >
                  {t("deleteConfirmAction")}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {tCommon("cancel")}
        </Button>
        <Button
          onClick={() => void handleSave()}
          disabled={!name || updateCollection.isPending}
        >
          {t("save")}
        </Button>
      </DialogFooter>
    </>
  );
}
