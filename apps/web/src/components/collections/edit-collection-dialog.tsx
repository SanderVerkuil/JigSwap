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
import { useMutation } from "convex/react";
import { Globe, Lock } from "lucide-react";
import { useEffect, useState } from "react";
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: EditableCollection | null;
}) {
  const t = useTranslations("collections");
  const tCommon = useTranslations("common");

  const updateCollection = useMutation(gateway.collections.update);

  const [formData, setFormData] = useState<FormData>(() =>
    collectionToForm(collection),
  );

  // Re-seed form data whenever the target collection changes (dialog opened for
  // a different item) or when the dialog opens fresh.
  useEffect(() => {
    if (open) {
      setFormData(collectionToForm(collection));
    }
  }, [open, collection]);

  const handleSave = async () => {
    if (!collection?.aggregateId) {
      console.error("Cannot update: collection is missing its aggregateId.");
      return;
    }
    try {
      await updateCollection({
        collectionId: collection.aggregateId,
        name: formData.name,
        description: formData.description,
        visibility: formData.visibility,
        color: formData.color,
        icon: formData.icon,
      });
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to update collection:", error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editCollection")}</DialogTitle>
          <DialogDescription>
            {t("editCollectionDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-col-name">{t("name")}</Label>
            <Input
              id="edit-col-name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder={t("collectionNamePlaceholder")}
            />
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={() => void handleSave()}>{t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
