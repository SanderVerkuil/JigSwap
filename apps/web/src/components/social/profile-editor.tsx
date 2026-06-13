"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
import { Pencil, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// View + inline edit of the acting member's public Social profile (display name + bio). First-time
// editors create the profile via the same mutation; the server enforces a non-empty display name.
export function ProfileEditor() {
  const t = useTranslations("profile.editor");
  const profile = useQuery(gateway.social.profile, {});
  const editProfile = useMutation(gateway.social.editProfile);

  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);

  // Seed the form from the loaded profile when entering edit mode.
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName);
      setBio(profile.bio ?? "");
    }
  }, [profile]);

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
      setIsEditing(false);
    } catch {
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        {!isEditing && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
          >
            <Pencil className="mr-2 h-4 w-4" />
            {t("edit")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isEditing ? (
          <>
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
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {t("save")}
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsEditing(false)}
                disabled={saving}
              >
                <X className="mr-2 h-4 w-4" />
                {t("cancel")}
              </Button>
            </div>
          </>
        ) : profile ? (
          <>
            <div>
              <p className="text-sm font-medium">{profile.displayName}</p>
              {profile.bio && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {profile.bio}
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("notSetUp")}</p>
        )}
      </CardContent>
    </Card>
  );
}
