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
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
import { Pencil, Save, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// Dialog for editing the acting member's public Social profile (display name +
// bio). First-time editors create the profile via the same mutation; the server
// enforces a non-empty display name.
export function ProfileEditDialog() {
  const t = useTranslations("profile.editor");
  const profile = useQuery(gateway.social.profile, {});
  const editProfile = useMutation(gateway.social.editProfile);

  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);

  // Reseed the form from the loaded profile every time the dialog opens, so a
  // reopen always starts from the saved values rather than a stale draft.
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDisplayName(profile?.displayName ?? "");
      setBio(profile?.bio ?? "");
    }
    setOpen(nextOpen);
  };

  const handleSave = async () => {
    if (displayName.trim().length === 0) {
      toast.error(t("emptyNameError"));
      return;
    }
    setSaving(true);
    try {
      await editProfile({
        displayName: displayName.trim(),
        bio: bio.trim() === "" ? undefined : bio.trim(),
      });
      toast.success(t("saved"));
      setOpen(false);
    } catch {
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
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
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("bio")}</label>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder={t("bioPlaceholder")}
              rows={3}
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
