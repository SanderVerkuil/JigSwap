"use client";

import { Button } from "@/components/ui/button";
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
import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Save, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// Dialog for editing the acting member's display name — the Social profile's
// other editable field (bio) is edited from the main profile editor's Bio
// field instead (that's the one that shows on the public profile). First-time
// editors create the profile via the same mutation; the server enforces a
// non-empty display name. editProfile always writes displayName + bio
// together (a full replace), so the currently loaded bio is sent through
// unchanged here to avoid clobbering it.
export function ProfileEditDialog() {
  const t = useTranslations("profile.editor");
  const { data: profile } = useQuery(convexQuery(gateway.social.profile, {}));
  const editProfile = useMutation({
    mutationFn: useConvexMutation(gateway.social.editProfile),
  });
  const saving = editProfile.isPending;

  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");

  // Reseed the form from the loaded profile every time the dialog opens, so a
  // reopen always starts from the saved value rather than a stale draft.
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDisplayName(profile?.displayName ?? "");
    }
    setOpen(nextOpen);
  };

  const handleSave = async () => {
    if (displayName.trim().length === 0) {
      toast.error(t("emptyNameError"));
      return;
    }
    try {
      await editProfile.mutateAsync({
        displayName: displayName.trim(),
        bio: profile?.bio,
      });
      toast.success(t("saved"));
      setOpen(false);
    } catch {
      toast.error(t("saveError"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="mr-2 h-4 w-4" />
          {t("edit")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("displayName")}</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t("displayNamePlaceholder")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={saving}
          >
            <X className="mr-2 h-4 w-4" />
            {t("cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || displayName.trim().length === 0}
          >
            <Save className="mr-2 h-4 w-4" />
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
