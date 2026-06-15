"use client";

import { useUser } from "@/compat/clerk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { gateway, Id } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
import { Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import type { Member } from "./member-view";

// Best-effort extraction of a human message from a Clerk API error (e.g. an
// already-taken or too-short username), falling back to undefined.
function clerkErrorMessage(err: unknown): string | undefined {
  if (err && typeof err === "object" && "errors" in err) {
    const errs = (err as { errors?: Array<{ longMessage?: string }> }).errors;
    return errs?.[0]?.longMessage;
  }
  return undefined;
}

// The inline editor behind the header's Edit Profile toggle: username,
// location and bio as open labelled fields (no card). Username's source of
// truth is Clerk (updated here; mirrored to Convex by the user.updated
// webhook); location/bio are saved straight to Convex via the identity gateway.
// Clerk rejects taken/invalid usernames; we surface that as a toast.
export function EditProfileForm({
  member,
  onDone,
}: {
  member: Member;
  onDone: () => void;
}) {
  const t = useTranslations("profile");
  const { user } = useUser();
  const updateProfile = useMutation(gateway.identity.updateProfile);
  const setProfileVisibility = useMutation(gateway.social.setProfileVisibility);

  // The visibility setting lives on the Social profile (separate from the identity account fields
  // above). Treat an absent profile/value as the "public" default.
  const socialProfile = useQuery(gateway.social.profile, {});
  const isPrivate = socialProfile?.visibility === "private";

  const [username, setUsername] = useState(member.username ?? "");
  const [location, setLocation] = useState(member.location ?? "");
  const [bio, setBio] = useState(member.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [visibilitySaving, setVisibilitySaving] = useState(false);

  const handleVisibilityChange = async (nextPrivate: boolean) => {
    setVisibilitySaving(true);
    try {
      await setProfileVisibility({
        visibility: nextPrivate ? "private" : "public",
      });
      toast.success(t("saved"));
    } catch {
      toast.error(t("saveError"));
    } finally {
      setVisibilitySaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Username -> Clerk (the source of truth); the user.updated webhook mirrors
      // it into the Convex `users` cache. Only call when it actually changed.
      const nextUsername = username.trim();
      if (user && nextUsername !== (member.username ?? "")) {
        await user.update({ username: nextUsername });
      }
      // Location/bio live only in Convex.
      await updateProfile({
        userId: member._id as Id<"users">,
        location: location.trim() || undefined,
        bio: bio.trim() || undefined,
      });
      toast.success(t("saved"));
      onDone();
    } catch (err) {
      toast.error(clerkErrorMessage(err) ?? t("saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-x-6 gap-y-4 border-b pb-6 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="profile-username">{t("username")}</Label>
        <Input
          id="profile-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t("usernamePlaceholder")}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="profile-location">{t("location")}</Label>
        <Input
          id="profile-location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={t("locationPlaceholder")}
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="profile-bio">{t("bio")}</Label>
        <Textarea
          id="profile-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder={t("bioPlaceholder")}
          rows={3}
        />
      </div>
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4 sm:col-span-2">
        <div className="space-y-1">
          <Label htmlFor="profile-visibility">{t("visibility.label")}</Label>
          <p className="text-muted-foreground text-sm">
            {t("visibility.helper")}
          </p>
        </div>
        <Switch
          id="profile-visibility"
          checked={isPrivate}
          disabled={visibilitySaving || socialProfile === undefined}
          onCheckedChange={handleVisibilityChange}
          aria-label={t("visibility.label")}
        />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button onClick={handleSave} disabled={saving}>
          <Save aria-hidden />
          {saving ? t("saving") : t("save")}
        </Button>
        <Button variant="outline" onClick={onDone} disabled={saving}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
