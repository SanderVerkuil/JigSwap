"use client";

import {
  isReverificationCancelledError,
  useReverification,
  useUser,
} from "@/compat/clerk";
import { ProfileEditDialog } from "@/components/social/profile-edit-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import type { Member } from "./member-view";

// The Social profile as returned by gateway.social.profile — undefined while loading, null when
// the member has never saved one yet.
type SocialProfile = FunctionReturnType<typeof gateway.social.profile>;

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

// Reads the machine-readable `code` off a Clerk API error (each entry in its
// `errors` array carries one), independent of the human message/locale.
function hasClerkErrorCode(err: unknown, code: string): boolean {
  if (err && typeof err === "object" && "errors" in err) {
    const errs = (err as { errors?: Array<{ code?: string }> }).errors;
    return errs?.some((e) => e.code === code) ?? false;
  }
  return false;
}

// Clerk requires a freshly re-verified session (step-up auth) before some
// sensitive changes like username. We don't have a reverification UI wired in
// this SDK build, so we surface an actionable notice rather than a raw error;
// the member can re-authenticate and retry, or just use their slug.
function isSessionReverificationRequired(err: unknown): boolean {
  return hasClerkErrorCode(err, "session_reverification_required");
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
// Location is saved to Convex via the identity gateway (users.location).
// Bio is the member's PUBLIC "story" shown on their profile — it lives on
// the Social profile (profiles.bio, gateway.social.editProfile), the same
// field getPublicProfile reads, so editing it here is what actually changes
// what other members see. users.bio (identity) is no longer surfaced by this
// form. Display name stays on the Social profile editor (ProfileEditDialog,
// embedded below) rather than being duplicated here.
//
// Wrapper: waits for BOTH Clerk (the username source of truth) and the Social
// profile to load before mounting the actual form, so every field's initial
// value can be seeded from the live value at mount without a setState-in-effect
// sync. In practice this is rarely visible — IdentityHeader (always mounted)
// queries the same profile, and Clerk loads early for auth.
export function EditProfileForm({
  member,
  onDone,
}: {
  member: Member;
  onDone: () => void;
}) {
  const { isLoaded } = useUser();
  const { data: socialProfile } = useQuery(
    convexQuery(gateway.social.profile, {}),
  );
  if (!isLoaded || socialProfile === undefined) return null;
  return (
    <EditProfileFormLoaded
      member={member}
      socialProfile={socialProfile}
      onDone={onDone}
    />
  );
}

function EditProfileFormLoaded({
  member,
  socialProfile,
  onDone,
}: {
  member: Member;
  socialProfile: SocialProfile;
  onDone: () => void;
}) {
  const t = useTranslations("profile");
  const { user } = useUser();
  // Wrap the Clerk username change so a session that needs step-up
  // reverification triggers Clerk's built-in modal and the update retries
  // automatically once verified — no sign-out/in required. If the member
  // cancels the modal, the wrapped call rejects with a cancellation error.
  const updateUsername = useReverification((name: string) =>
    user?.update({ username: name }),
  );
  const updateProfile = useConvexMutation(gateway.identity.updateProfile);
  const editProfile = useConvexMutation(gateway.social.editProfile);
  const setSlug = useConvexMutation(gateway.identity.setSlug);
  const setProfileVisibility = useMutation({
    mutationFn: useConvexMutation(gateway.social.setProfileVisibility),
  });

  // The visibility setting (and display name, surfaced via the embedded
  // ProfileEditDialog below) live on the Social profile, separate from the
  // identity account fields above. Treat an absent profile/value as the
  // "public" default.
  const isPrivate = socialProfile?.visibility === "private";

  // Seed from Clerk (the username's source of truth), not the Convex mirror
  // (member.username) — the mirror is populated by the user.updated webhook,
  // which may be unconfigured in a review/preview environment and thus stale
  // or empty. Clerk's live value is always correct here.
  const [username, setUsername] = useState(
    user?.username ?? member.username ?? "",
  );
  const [slug, setSlugValue] = useState(member.slug ?? "");
  const [location, setLocation] = useState(member.location ?? "");
  const [bio, setBio] = useState(socialProfile?.bio ?? "");

  // Server-side, per-field save errors mapped back onto the inputs. The form
  // stays open and keeps every value while these are set — nothing is lost on a
  // failed save; the member reads the error, adjusts, and retries.
  const [usernameError, setUsernameError] = useState<string | undefined>();
  const [slugServerError, setSlugServerError] = useState<string | undefined>();

  const trimmedSlug = slug.trim();
  const slugFormatError = trimmedSlug !== "" && !isValidSlugFormat(trimmedSlug);
  // What `/members/<handle>` would resolve to right now — mirrors the
  // canonical-handle fallback (slug -> username -> id) so an empty slug still
  // previews a real, working link instead of a dead one.
  const slugPreviewHandle = trimmedSlug || username.trim() || member._id;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  // The WHOLE save — the Clerk username update, the slug write and the Convex
  // profile write — runs as one mutationFn so isPending spans every step with
  // no gap. Each independent write is attempted and its failure captured
  // per-field rather than aborting the rest, so a rejected username never
  // discards the location/slug/bio the member also changed. The form is closed
  // ONLY when the whole save comes back clean (see onSuccess) — on any error it
  // stays open with every value intact and the message mapped onto its field.
  const saveProfile = useMutation({
    mutationFn: async () => {
      const errors: {
        username?: string;
        slug?: string;
        general?: string;
      } = {};

      // Username -> Clerk (the source of truth); the user.updated webhook mirrors
      // it into the Convex `users` cache. Only call when it actually changed.
      const nextUsername = username.trim();
      if (user && nextUsername !== (member.username ?? "")) {
        try {
          // Reverification (if the session needs stepping up) is handled inline
          // by Clerk's modal via useReverification; on success the update retries.
          await updateUsername(nextUsername);
        } catch (err) {
          // The member closed the reverification modal -> username left unchanged;
          // instance has Username disabled outright (admin-level config they can't
          // fix) -> the "use your slug instead" notice; a step-up requirement that
          // somehow escaped the modal -> a re-verify notice; any other Clerk
          // rejection (taken, too short, ...) -> its own message.
          errors.username = isReverificationCancelledError(err)
            ? t("usernameReverifyCancelled")
            : isUsernameDisabledError(err)
              ? t("usernameUnavailable")
              : isSessionReverificationRequired(err)
                ? t("usernameReverify")
                : (clerkErrorMessage(err) ?? t("saveError"));
        }
      }
      // Location lives on the identity user row.
      try {
        await updateProfile({ location: location.trim() || undefined });
      } catch {
        errors.general = t("saveError");
      }
      // The slug is Convex-owned and validated/uniqueness-checked server-side;
      // only call when it actually changed.
      if (trimmedSlug !== (member.slug ?? "")) {
        try {
          await setSlug({ slug: trimmedSlug === "" ? null : trimmedSlug });
        } catch (err) {
          errors.slug = convexErrorMessage(err) ?? t("saveError");
        }
      }
      // Bio lives on the Social profile (the public "story"). editProfile always
      // writes displayName + bio together (a full replace), so the current
      // displayName is sent through unchanged to avoid clobbering it.
      const trimmedBio = bio.trim();
      if (trimmedBio !== (socialProfile?.bio ?? "")) {
        try {
          await editProfile({
            displayName: socialProfile?.displayName ?? member.name,
            bio: trimmedBio === "" ? undefined : trimmedBio,
          });
        } catch (err) {
          errors.general = convexErrorMessage(err) ?? t("saveError");
        }
      }
      return errors;
    },
    onSuccess: (errors) => {
      // Reflect (or clear) the per-field messages every save.
      setUsernameError(errors.username);
      setSlugServerError(errors.slug);
      if (errors.username || errors.slug || errors.general) {
        // Something failed — keep the form open with all input intact. A general
        // (non-field) failure still gets a toast; field ones show inline.
        if (errors.general) toast.error(errors.general);
        return;
      }
      toast.success(t("saved"));
      onDone();
    },
    // Only reached for a genuinely unexpected throw outside the per-field guards.
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
          onChange={(e) => {
            setUsername(e.target.value);
            if (usernameError) setUsernameError(undefined);
          }}
          placeholder={t("usernamePlaceholder")}
          aria-invalid={usernameError !== undefined}
        />
        {usernameError && (
          <p className="text-destructive text-xs">{usernameError}</p>
        )}
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
          onChange={(e) => {
            setSlugValue(e.target.value);
            if (slugServerError) setSlugServerError(undefined);
          }}
          placeholder={t("slug.placeholder")}
          aria-invalid={slugFormatError || slugServerError !== undefined}
        />
        <p
          className={
            slugFormatError || slugServerError
              ? "text-destructive text-xs"
              : "text-muted-foreground text-xs"
          }
        >
          {slugServerError ??
            (slugFormatError ? t("slug.formatError") : t("slug.hint"))}
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
          disabled={setProfileVisibility.isPending}
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
