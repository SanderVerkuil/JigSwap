import { useRouter } from "@/compat/navigation";
import { isDuplicateCollectionName } from "@/components/collections/collection-name";
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
import { useRelativeTime } from "@/hooks/use-relative-time";
import { rateLimitedRetryAt } from "@/lib/convex-error-code";
import { useConvexMutation } from "@convex-dev/react-query";
import { LIBRARY_TEXT_LIMITS } from "@jigswap/contracts";
import { useMutation } from "@tanstack/react-query";
// sanctioned convex/react exception: useConvex for the one-shot id lookup after creating
import { useConvex } from "convex/react";
import { Globe, Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

const EMPTY_FORM = {
  name: "",
  description: "",
  visibility: "private" as "private" | "public",
  color: "#3b82f6",
  icon: "📦",
};

// "New Collection": Create waits for a name; a taken name is said under the field, any other
// failure is toasted, and a created collection opens on its Add Puzzles page so it can be filled.
export function CreateCollectionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Radix mounts DialogContent's children only while open, so the form starts empty every time.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <CreateCollectionForm onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function CreateCollectionForm({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("collections");
  const tCommon = useTranslations("common");
  const relativeTime = useRelativeTime();
  const router = useRouter();
  const convex = useConvex();
  const createCollection = useConvexMutation(gateway.collections.create);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [nameError, setNameError] = useState<string | null>(null);
  const name = formData.name.trim();

  // createCollection answers with the domain CollectionId; the collection's page is keyed by its
  // row _id, so look that up among the member's collections. A failed lookup only changes where
  // the member lands (the collection exists either way).
  const create = useMutation({
    mutationFn: async () => {
      const aggregateId = await createCollection({
        name,
        description: formData.description,
        visibility: formData.visibility,
        color: formData.color,
        icon: formData.icon,
        personalNotes: "",
      });
      try {
        const collections = await convex.query(
          gateway.collections.listForUser,
          {},
        );
        return (
          collections.find((c) => c.aggregateId === aggregateId)?._id ?? null
        );
      } catch {
        return null;
      }
    },
    onSuccess: (collectionDocId) => {
      toast.success(t("created", { name }));
      onOpenChange(false);
      if (collectionDocId) {
        router.push(`/collections/${collectionDocId}/add-puzzles`);
      }
    },
    onError: (error) => {
      const retryAt = rateLimitedRetryAt(error, Date.now());
      if (isDuplicateCollectionName(error)) {
        setNameError(t("duplicateName", { name }));
      } else if (retryAt !== undefined) {
        toast.error(t("createRateLimited", { when: relativeTime(retryAt) }));
      } else {
        toast.error(t("createError"));
      }
    },
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("createCollection")}</DialogTitle>
        <DialogDescription>
          {t("createCollectionDescription")}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">{t("name")}</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => {
              setNameError(null);
              setFormData({ ...formData, name: e.target.value });
            }}
            placeholder={t("collectionNamePlaceholder")}
            maxLength={LIBRARY_TEXT_LIMITS.collectionName}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "name-error" : undefined}
          />
          {nameError && (
            <p id="name-error" className="text-destructive text-sm">
              {nameError}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">{t("description")}</Label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
            placeholder={t("descriptionPlaceholder")}
            maxLength={LIBRARY_TEXT_LIMITS.collectionDescription}
          />
        </div>
        <div className="space-y-2">
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
          <div className="space-y-2">
            <Label htmlFor="icon">{t("icon")}</Label>
            <EmojiPickerInput
              id="icon"
              value={formData.icon}
              onChange={(emoji) => setFormData({ ...formData, icon: emoji })}
              placeholder="📦"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="color">{t("color")}</Label>
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
        <Button
          onClick={() => create.mutate()}
          disabled={!name || create.isPending}
        >
          {t("create")}
        </Button>
      </DialogFooter>
    </>
  );
}
