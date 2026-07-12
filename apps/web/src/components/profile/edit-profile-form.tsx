"use client";

import { useUser } from "@/compat/clerk";
import { ProfileEditDialog } from "@/components/social/profile-edit-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ConvexError } from "convex/values";
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

// Clerk throws this specific, cryptic rejection when the Clerk instance has the
// Username attribute disabled entirely (an instance-level config the member has
// no control over) — not a validation problem with the value they typed. Detected
// by substring so it doesn't depend on the exact Clerk error object shape.
function isUsernameDisabledError(err: unknown): boolean {
  const message =
    clerkErrorMessage(err) ?? (err instanceof Error ? err.message : "");
  return /username.*not a valid parameter/i.test(message);
}

// Extract the plain-string message a Convex mutation throws via `new ConvexError("...")`
// (setSlug's shape) — as opposed to a structured `{ code }` payload.
function convexErrorMessage(err: unknown): string | undefined {
  return err instanceof ConvexError && typeof err.data === "string"
    ? err.data
    : undefined;
}

// Mirrors identity/setSlug's format check (server is the authoritative validator; this is
// only an inline hint so the member gets format feedback before hitting Save).
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
function isValidSlugFormat(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= 30 &&
    SLUG_PATTERN.test(value) &&
    !value.includes("--")
  );
}

// The inline editor behind the header's Edit Profile toggle: username, the
// shareable slug, location and bio as open labelled fields (no card).
// Username's source of truth is Clerk (updated here; mirrored to Convex by
// the user.updated webhook) — if the Clerk instance has Username disabled
// entirely, that specific rejection is swallowed into a friendly notice
// instead of blocking the rest of the save. The slug is Convex-owned
// (identity.setSlug) and is this form's primary shareable-handle control.
// Location/bio are saved straight to Convex via the identity gateway. Display
// name stays on the Social profile editor (ProfileEditDialog, embedded below)
// rather than being duplicated here, since that mutation also owns the
// Social-profile bio and always requires both fields together.
export function EditProfileForm({
  member,
  onDone,
}: {
  member: Member;
  onDone: () => void;
}) {
  const t = useTranslations("profile");
  const { user } = useUser();
  const updateProfile = useConvexMutation(gateway.identity.updateProfile);
  const setSlug = useConvexMutation(gateway.identity.setSlug);
  const setProfileVisibility = useMutation({
    mutationFn: useConvexMutation(gateway.social.setProfileVisibility),
  });

  // The visibility setting (and display name, surfaced via the embedded
  // ProfileEditDialog below) live on the Social profile, separate from the
  // identity account fields above. Treat an absent profile/value as the
  // "public" default.
  const { data: socialProfile } = useQuery(
    convexQuery(gateway.social.profile, {}),
  );
  const isPrivate = socialProfile?.visibility === "private";

  const [username, setUsername] = useState(member.username ?? "");
  const [slug, setSlugValue] = useState(member.slug ?? "");
  const [location, setLocation] = useState(member.location ?? "");
  const [bio, setBio] = useState(member.bio ?? "");

  const trimmedSlug = slug.trim();
  const slugFormatError = trimmedSlug !== "" && !isValidSlugFormat(trimmedSlug);
  // What `/members/<handle>` would resolve to right now — mirrors the
  // canonical-handle fallback (slug -> username -> id) so an empty slug still
  // previews a real, working link instead of a dead one.
  const slugPreviewHandle = trimmedSlug || username.trim() || member._id;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  // The WHOLE save — the Clerk username update, the slug write and the Convex
  // profile write — runs as one mutationFn so isPending spans every step with
  // no gap (busy-state rule v2).
  const saveProfile = useMutation({
    mutationFn: async () => {
      // Username -> Clerk (the source of truth); the user.updated webhook mirrors
      // it into the Convex `users` cache. Only call when it actually changed.
      let usernameUnavailable = false;
      const nextUsername = username.trim();
      if (user && nextUsername !== (member.username ?? "")) {
        try {
          await user.update({ username: nextUsername });
        } catch (err) {
          // The Clerk instance has Username disabled outright — not a per-value
          // rejection. Skip it (other fields still save) and flag it for a
          // friendly notice; any other Clerk error (taken, too short, ...)
          // still surfaces as before.
          if (isUsernameDisabledError(err)) {
            usernameUnavailable = true;
          } else {
            throw err;
          }
        }
      }
      // Location/bio live only in Convex.
      await updateProfile({
        location: location.trim() || undefined,
        bio: bio.trim() || undefined,
      });
      // The slug is Convex-owned and validated/uniqueness-checked server-side;
      // only call when it actually changed.
      if (trimmedSlug !== (member.slug ?? "")) {
        await setSlug({ slug: trimmedSlug === "" ? null : trimmedSlug });
      }
      return { usernameUnavailable };
    },
    onSuccess: ({ usernameUnavailable }) => {
      if (usernameUnavailable) {
        toast.warning(t("usernameUnavailable"));
      } else {
        toast.success(t("saved"));
      }
      onDone();
    },
    onError: (err) => {
      toast.error(
        clerkErrorMessage(err) ?? convexErrorMessage(err) ?? t("saveError"),
      );
    },
  });

  const handleVisibilityChange = async (nextPrivate: boolean) => {
    try {
      await setProfileVisibility.mutateAsync({
        visibility: nextPrivate ? "private" : "public",
      });
      toast.success(t("saved"));
    } catch {
      toast.error(t("saveError"));
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
        <Label htmlFor="profile-slug">{t("slug.label")}</Label>
        <Input
          id="profile-slug"
          value={slug}
          onChange={(e) => setSlugValue(e.target.value)}
          placeholder={t("slug.placeholder")}
          aria-invalid={slugFormatError}
        />
        <p
          className={
            slugFormatError
              ? "text-destructive text-xs"
              : "text-muted-foreground text-xs"
          }
        >
          {slugFormatError ? t("slug.formatError") : t("slug.hint")}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          {t("slug.preview")}{" "}
          <span className="font-mono">
            {origin}/members/{slugPreviewHandle}
          </span>
        </p>
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
          <Label>{t("displayName.label")}</Label>
          <p className="text-muted-foreground text-sm">
            {t("displayName.helper", {
              name: socialProfile?.displayName ?? member.name,
            })}
          </p>
        </div>
        <ProfileEditDialog />
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
          disabled={
            setProfileVisibility.isPending || socialProfile === undefined
          }
          onCheckedChange={handleVisibilityChange}
          aria-label={t("visibility.label")}
        />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button
          onClick={() => saveProfile.mutate()}
          disabled={saveProfile.isPending || slugFormatError}
        >
          <Save aria-hidden />
          {saveProfile.isPending ? t("saving") : t("save")}
        </Button>
        <Button
          variant="outline"
          onClick={onDone}
          disabled={saveProfile.isPending}
        >
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
