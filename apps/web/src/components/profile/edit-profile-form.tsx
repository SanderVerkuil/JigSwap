"use client";

import {
  isReverificationCancelledError,
  useReverification,
  useUser,
} from "@/compat/clerk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useReportSurfaceBusy } from "@/components/whats-new/surface-busy";
import { gateway } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { CUSTOM_LINK_FIELD_ID } from "@/lib/profile-search";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

// Mirrors the domain's BIO_MAX_LENGTH (Profile); the server refuses a longer bio (BioTooLong).
const BIO_MAX_LENGTH = 500;

// Mirrors the domain's DISPLAY_NAME_MAX_LENGTH; the server refuses a longer name.
const DISPLAY_NAME_MAX_LENGTH = 50;

// Mirrors identity/setLocation's cap; the server refuses a longer location (invalid_location).
const LOCATION_MAX_LENGTH = 80;

// The inline editor behind the header's Edit Profile toggle: display name,
// username, the shareable slug, location and bio as open labelled fields (no
// card). One save model: every field waits for Save and Cancel drops them all.
// Settings that save the moment they change (profile visibility, the invite
// link reset) live in the always-visible PrivacySection instead.
// Username's source of truth is Clerk (updated here; mirrored to Convex by
// the user.updated webhook) — if the Clerk instance has Username disabled
// entirely, that specific rejection is swallowed into a friendly notice
// instead of blocking the rest of the save. The slug is Convex-owned
// (identity.setSlug) and is this form's primary shareable-handle control.
// Location is saved to Convex via the identity gateway (users.location).
// Display name and bio are the member's PUBLIC face — both live on the Social
// profile (profiles.displayName / profiles.bio, gateway.social.editProfile),
// the fields getPublicProfile reads, so editing them here is what actually
// changes what other members see. users.bio (identity) is no longer surfaced
// by this form.
//
// Wrapper: waits for BOTH Clerk (the username source of truth) and the Social
// profile to load before mounting the actual form, so every field's initial
// value can be seeded from the live value at mount without a setState-in-effect
// sync. In practice this is rarely visible — IdentityHeader (always mounted)
// queries the same profile, and Clerk loads early for auth.
export function EditProfileForm({
  member,
  focusCustomLink = false,
  onDone,
}: {
  member: Member;
  // Arriving to set a custom link (?edit=link): focus lands on that field, not the page top.
  focusCustomLink?: boolean;
  onDone: () => void;
}) {
  const { isLoaded } = useUser();
  const { data: socialProfile } = useQuery(
    convexQuery(gateway.social.profile, {}),
  );
  // /profile is not a form route, so the install tip would float over these fields; while the form
  // is open it steps aside, as it does on the form routes (installTipBlockedOn).
  useReportSurfaceBusy("profileEdit", true);
  if (!isLoaded || socialProfile === undefined) return null;
  return (
    <EditProfileFormLoaded
      member={member}
      socialProfile={socialProfile}
      focusCustomLink={focusCustomLink}
      onDone={onDone}
    />
  );
}

function EditProfileFormLoaded({
  member,
  socialProfile,
  focusCustomLink,
  onDone,
}: {
  member: Member;
  socialProfile: SocialProfile;
  focusCustomLink: boolean;
  onDone: () => void;
}) {
  const t = useTranslations("profile");
  const displayName = useMemberDisplayName();
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

  // Seed from Clerk (the username's source of truth), not the Convex mirror
  // (member.username) — the mirror is populated by the user.updated webhook,
  // which may be unconfigured in a review/preview environment and thus stale
  // or empty. Clerk's live value is always correct here.
  const [username, setUsername] = useState(
    user?.username ?? member.username ?? "",
  );
  const [slug, setSlugValue] = useState(member.slug ?? "");
  const slugInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusCustomLink) slugInput.current?.focus();
  }, [focusCustomLink]);
  const [location, setLocation] = useState(member.location ?? "");
  const [bio, setBio] = useState(socialProfile?.bio ?? "");
  // Empty when the member never chose one: other members then see the account
  // name, shown as the placeholder (never copied in, so it stays live).
  const savedDisplayName = socialProfile?.displayName ?? "";
  const [displayNameInput, setDisplayNameInput] = useState(savedDisplayName);

  // Server-side, per-field save errors mapped back onto the inputs. The form
  // stays open and keeps every value while these are set — nothing is lost on a
  // failed save; the member reads the error, adjusts, and retries.
  const [usernameError, setUsernameError] = useState<string | undefined>();
  const [slugServerError, setSlugServerError] = useState<string | undefined>();

  const trimmedSlug = slug.trim();
  const slugFormatError = trimmedSlug !== "" && !isValidSlugFormat(trimmedSlug);
  const trimmedDisplayName = displayNameInput.trim();
  const displayNameChanged = trimmedDisplayName !== savedDisplayName;
  // A chosen display name can be changed but not cleared (the server rejects
  // an empty one), so an emptied field blocks Save with an inline message.
  const displayNameError = displayNameChanged && trimmedDisplayName === "";
  // What `/members/<handle>` would be right now: the slug being typed, else
  // the username only when the server says it is this member's canonical
  // handle (it resolves back to them), else the id. Never the bare username:
  // another member may hold it as a slug (SEC-07).
  const slugPreviewHandle =
    trimmedSlug ||
    (username.trim() === member.handle ? member.handle : member._id);
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
        await updateProfile({ location: location.trim() });
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
      // Display name and bio live on the Social profile and go in ONE
      // editProfile call. displayName is sent only when it changed (omitted =
      // keep the current one, or none); bio is always sent, because an omitted
      // bio clears it.
      const trimmedBio = bio.trim();
      if (displayNameChanged || trimmedBio !== (socialProfile?.bio ?? "")) {
        try {
          await editProfile({
            displayName: displayNameChanged ? trimmedDisplayName : undefined,
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

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 border-b pb-6 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="profile-display-name">{t("displayName.label")}</Label>
        <Input
          id="profile-display-name"
          value={displayNameInput}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          onChange={(e) => setDisplayNameInput(e.target.value)}
          placeholder={displayName({
            name: member.name,
            username: member.username,
          })}
          aria-invalid={displayNameError}
          aria-describedby="profile-display-name-hint"
        />
        <p
          id="profile-display-name-hint"
          className={
            displayNameError
              ? "text-destructive text-xs"
              : "text-muted-foreground text-xs"
          }
        >
          {displayNameError
            ? t("displayName.emptyError")
            : t("displayName.helper")}
        </p>
      </div>
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
          maxLength={LOCATION_MAX_LENGTH}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={t("locationPlaceholder")}
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={CUSTOM_LINK_FIELD_ID}>{t("slug.label")}</Label>
        <Input
          ref={slugInput}
          id={CUSTOM_LINK_FIELD_ID}
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
        <p className="text-muted-foreground text-xs">
          {t("slug.preview")}{" "}
          <span className="font-mono break-all">
            {origin}/members/{slugPreviewHandle}
          </span>
        </p>
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="profile-bio">{t("bio")}</Label>
        <Textarea
          id="profile-bio"
          value={bio}
          maxLength={BIO_MAX_LENGTH}
          onChange={(e) => setBio(e.target.value)}
          placeholder={t("bioPlaceholder")}
          aria-describedby="profile-bio-counter"
          rows={3}
        />
        <p
          id="profile-bio-counter"
          className="text-muted-foreground text-right text-xs"
        >
          {t("bioCounter", { count: bio.length, max: BIO_MAX_LENGTH })}
        </p>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button
          onClick={() => saveProfile.mutate()}
          disabled={
            saveProfile.isPending || slugFormatError || displayNameError
          }
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
