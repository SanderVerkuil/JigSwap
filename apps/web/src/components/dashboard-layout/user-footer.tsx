"use client";

// Bottom-left user identity (the ONLY place the user appears in the shell):
// avatar + name + email. The email blurs (and becomes unselectable) when the
// hide-email preference is on.
//
// The shell preferences (content width, hide email) now live INSIDE Clerk's
// own profile UI as a custom <UserButton.UserProfilePage> ("Preferences"),
// persisted to the Clerk user (see preferences.tsx). The old standalone
// Settings gear dropdown is gone; its trigger slot is replaced by an admin-
// only Shield badge that deep-links to /admin.

import { UserButton, useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { Switch } from "@/components/ui/switch";
import { CheckRole } from "@/components/utils/check-role/server";
import { cn } from "@/lib/utils";
import { Shield, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "use-intl";
import { useShellPreferences } from "./preferences";

export function UserFooter() {
  const { user } = useUser();
  const { hideEmail } = useShellPreferences();
  const t = useTranslations("shell");

  if (!user) {
    return null;
  }

  const email = user.primaryEmailAddress?.emailAddress ?? user.username ?? "";

  return (
    <div className="flex items-center gap-2 rounded-md p-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0">
      <UserButton
        appearance={{
          elements: {
            userButtonAvatarBox: "!w-8 !h-8",
          },
        }}
      >
        {/* Custom page mounted inside Clerk's own UserProfile modal. */}
        <UserButton.UserProfilePage
          label="Preferences"
          labelIcon={<SlidersHorizontal className="size-4" />}
          url="shell-preferences"
        >
          <PreferencesPage />
        </UserButton.UserProfilePage>
      </UserButton>
      {/* The identity block links to the member's own profile — the avatar
          (Clerk UserButton) owns account management, so this is the only
          in-shell route to /profile on desktop. */}
      <Link
        href="/profile"
        title={t("pages.profile.title")}
        className="grid min-w-0 flex-1 rounded-md px-1 py-0.5 text-left text-sm leading-tight transition-colors hover:bg-accent group-data-[collapsible=icon]:hidden"
      >
        <span className="truncate font-medium">
          {user.firstName} {user.lastName}
        </span>
        <span
          aria-hidden={hideEmail}
          className={cn(
            "truncate text-xs text-muted-foreground transition-[filter]",
            hideEmail && "blur-[4px] select-none",
          )}
        >
          {email}
        </span>
      </Link>
      <AdminBadge />
    </div>
  );
}

// Admin-only quick link to /admin, sitting where the preferences gear used to
// be. Non-admins render nothing here (CheckRole gates on the Clerk session's
// publicMetadata.role).
function AdminBadge() {
  const t = useTranslations("shell.user");

  return (
    <CheckRole role="admin">
      <Link
        href="/admin"
        aria-label={t("admin")}
        title={t("admin")}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground group-data-[collapsible=icon]:hidden"
      >
        <Shield className="size-4" />
      </Link>
    </CheckRole>
  );
}

// Content of the Clerk custom profile page: the content-width choice and the
// hide-email toggle, wired to the same useShellPreferences() store the shell
// reads from. Uses the existing shell.user.* translations.
function PreferencesPage() {
  const { fullWidth, hideEmail, setPreference } = useShellPreferences();
  const t = useTranslations("shell.user");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">{t("preferences")}</h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{t("contentWidth")}</h2>
        <div
          role="radiogroup"
          aria-label={t("contentWidth")}
          className="flex gap-2"
        >
          <ContentWidthOption
            label={t("centered")}
            selected={!fullWidth}
            onSelect={() => setPreference("fullWidth", false)}
          />
          <ContentWidthOption
            label={t("fullWidth")}
            selected={fullWidth}
            onSelect={() => setPreference("fullWidth", true)}
          />
        </div>
      </section>

      <section className="flex items-center justify-between gap-4">
        <label htmlFor="shell-hide-email" className="text-sm font-medium">
          {t("hideEmail")}
        </label>
        <Switch
          id="shell-hide-email"
          checked={hideEmail}
          onCheckedChange={(checked) => setPreference("hideEmail", checked)}
        />
      </section>
    </div>
  );
}

function ContentWidthOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex-1 rounded-md border px-3 py-2 text-sm transition-colors",
        selected
          ? "border-primary bg-primary/10 font-medium text-foreground"
          : "border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {label}
    </button>
  );
}
