"use client";

// The shell's user menu: Clerk's <UserButton> account dropdown (manage account,
// sign out) plus a "My profile" link to the app's own profile page and a custom
// "Preferences" page (content width, hide email, solve-duration tracking) mounted
// inside Clerk's profile modal. Shared by the desktop sidebar footer and the mobile
// top bar so both open the same menu instead of hard-navigating to /profile.

import { UserButton } from "@/compat/clerk";
import { NotificationPreferencesPanel } from "@/components/notifications/notification-preferences-panel";
import { Switch } from "@/components/ui/switch";
import { useUserSettings } from "@/hooks/use-user-settings";
import { cn } from "@/lib/utils";
import { Bell, SlidersHorizontal, User } from "lucide-react";
import { useTranslations } from "use-intl";
import { useShellPreferences } from "./preferences";

export function ShellUserButton({
  // When set, the avatar's trigger fills a 44px touch target (with the avatar
  // itself at 28px) so it matches the other controls in the mobile top bar. The
  // desktop sidebar footer leaves it compact (a 32px avatar, no extra hit area).
  tapTarget = false,
}: {
  tapTarget?: boolean;
}) {
  const t = useTranslations("shell");

  return (
    <UserButton
      appearance={{
        elements: tapTarget
          ? {
              userButtonAvatarBox: "!w-7 !h-7",
              userButtonTrigger:
                "!flex !size-11 !items-center !justify-center !rounded-lg hover:!bg-accent",
            }
          : {
              userButtonAvatarBox: "!w-8 !h-8",
            },
      }}
    >
      {/* Custom menu items: a link to the app's own /profile alongside Clerk's
          default account + sign-out actions (re-listed so they survive the
          custom MenuItems block). */}
      <UserButton.MenuItems>
        <UserButton.Link
          label={t("pages.profile.title")}
          labelIcon={<User className="size-4" />}
          href="/profile"
        />
        <UserButton.Action label="manageAccount" />
        <UserButton.Action label="signOut" />
      </UserButton.MenuItems>
      {/* Custom pages mounted inside Clerk's own UserProfile modal. */}
      <UserButton.UserProfilePage
        label="Preferences"
        labelIcon={<SlidersHorizontal className="size-4" />}
        url="shell-preferences"
      >
        <PreferencesPage />
      </UserButton.UserProfilePage>
      <UserButton.UserProfilePage
        label={t("user.notifications")}
        labelIcon={<Bell className="size-4" />}
        url="notifications"
      >
        <NotificationPreferencesPanel />
      </UserButton.UserProfilePage>
    </UserButton>
  );
}

// Content of the Clerk custom profile page: the content-width choice and the
// hide-email toggle (useShellPreferences, Clerk metadata) plus the solve-duration
// tracking toggle (useUserSettings, the Solving-context Convex preference). Uses
// the shell.user.* and solving.settings.* translations.
function PreferencesPage() {
  const { fullWidth, hideEmail, setPreference } = useShellPreferences();
  const { trackCompletionDuration, setTrackDuration } = useUserSettings();
  const t = useTranslations("shell.user");
  const ts = useTranslations("solving.settings");

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

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{ts("sectionTitle")}</h2>
        <div className="flex items-center justify-between gap-4">
          <label
            htmlFor="track-completion-duration"
            className="text-muted-foreground text-sm"
          >
            {ts("trackDurationLabel")}
          </label>
          <Switch
            id="track-completion-duration"
            checked={trackCompletionDuration === true}
            onCheckedChange={(checked) => void setTrackDuration(checked)}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {ts("trackDurationHint")}
        </p>
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
