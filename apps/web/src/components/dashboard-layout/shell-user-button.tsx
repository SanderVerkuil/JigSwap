"use client";

// The shell's user menu: Clerk's <UserButton> account dropdown (manage account,
// sign out) plus a "My profile" link to the app's own profile page and a custom
// "Preferences" page (content width, hide email, solve-duration tracking) mounted
// inside Clerk's profile modal. Shared by the desktop sidebar footer and the mobile
// top bar so both open the same menu instead of hard-navigating to /profile.
// Once the member shares their presence it also offers the status choice
// (Automatic / Away / Appear offline) and shows their own status dot.
import { UserButton, useUser } from "@/compat/clerk";
import { NotificationPreferencesPanel } from "@/components/notifications/notification-preferences-panel";
import { useAppActivity } from "@/components/presence/app-presence";
import { PresenceDot } from "@/components/presence/presence-dot";
import { usePresenceSettings } from "@/components/presence/use-presence";
import { PrivacySafetyPanel } from "@/components/social/privacy-safety-panel";
import { Switch } from "@/components/ui/switch";
import { UnreadDot } from "@/components/whats-new/badges";
import { useWhatsNewUnreadCount } from "@/components/whats-new/use-whats-new-state";
import { gateway } from "@/gateway";
import { useUserSettings } from "@/hooks/use-user-settings";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import type { PresenceSettingsView } from "@jigswap/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Bell,
  Check,
  House,
  ListChecks,
  Shield,
  ShieldBan,
  SlidersHorizontal,
  Sparkles,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { useShellPreferences } from "./preferences";

const STATUS_OPTIONS = [
  { override: "auto", label: "statusAuto" },
  { override: "away", label: "statusAway" },
  { override: "invisible", label: "statusInvisible" },
] as const satisfies readonly {
  override: PresenceSettingsView["override"];
  label: string;
}[];

export function ShellUserButton({
  // When set, the avatar's trigger fills a 44px touch target (with the avatar
  // itself at 28px) so it matches the other controls in the mobile top bar. The
  // desktop sidebar footer leaves it compact (a 32px avatar, no extra hit area).
  tapTarget = false,
}: {
  tapTarget?: boolean;
}) {
  const t = useTranslations("shell");
  const tWhatsNew = useTranslations("whatsNew");
  const tQuickStart = useTranslations("quickStart.menu");
  const navigate = useNavigate();
  const recordQuickStart = useConvexMutation(
    gateway.onboarding.recordQuickStart,
  );
  const tPresence = useTranslations("presence");
  const { user } = useUser();
  const whatsNewCount = useWhatsNewUnreadCount();
  // The status choice only means something once the member shares (spec 6.5).
  const presence = usePresenceSettings();
  const showStatus = presence?.share === true;
  const setPresence = useConvexMutation(gateway.social.setPresencePreferences);
  // The member's own dot mirrors what mutual followers see: nothing when
  // appearing offline, Away when chosen or idle, else Online.
  const activity = useAppActivity();
  const ownStatus = !showStatus
    ? undefined
    : presence.override === "invisible"
      ? undefined
      : presence.override === "away" || activity === "idle"
        ? "away"
        : "online";

  // Backend-confirmed admin role — same source as the /admin route guard and
  // the sidebar's gated group; Convex dedupes the shared subscription. This
  // menu item is the mobile path to /admin (no admin tab in the tab bar).
  const { data: isAdmin } = useQuery(
    convexQuery(gateway.identity.isAdmin, user?.id ? {} : "skip"),
  );

  return (
    // The dot sits beside Clerk's avatar (absolute, no layout shift), not
    // inside Clerk's markup.
    <span className="relative inline-flex shrink-0">
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
          {/* Clerk's label is a plain string, so the count goes in the text ("What's new (2)"),
            which also gives screen readers the count; the icon dot is decorative. */}
          <UserButton.Link
            label={
              whatsNewCount > 0
                ? tWhatsNew("menuLabelUnread", { count: whatsNewCount })
                : tWhatsNew("menuLabel")
            }
            labelIcon={
              <span className="relative">
                <Sparkles className="size-4" />
                {whatsNewCount > 0 && (
                  <UnreadDot className="ring-popover -top-1 -right-1 size-2" />
                )}
              </span>
            }
            href="/whats-new"
          />
          {/* Always here (spec §2.3): reopens the quick start and brings back a hidden card.
            restoreCard is a no-op when the card was never hidden. */}
          <UserButton.Action
            label={tQuickStart("quickSetup")}
            labelIcon={<ListChecks className="size-4" />}
            onClick={() => {
              recordQuickStart({ kind: "restoreCard" }).catch(
                (error: unknown) =>
                  console.error("Failed to restore quick setup:", error),
              );
              void navigate({ to: "/welcome" });
            }}
          />
          {isAdmin && (
            <UserButton.Link
              label={t("user.admin")}
              labelIcon={<Shield className="size-4" />}
              href="/admin"
            />
          )}
          {/* The app's logos all point at /dashboard, so this is the signed-in
            way back to the landing page. Clerk navigates client-side, which / does
            not redirect (only a document load does; see lib/home-redirect). */}
          <UserButton.Link
            label={t("user.homepage")}
            labelIcon={<House className="size-4" />}
            href="/"
          />
          {showStatus &&
            STATUS_OPTIONS.map((option) => (
              <UserButton.Action
                key={option.override}
                // The state is in the label itself: Clerk's labels are plain
                // strings and the check icon alone isn't announced.
                label={
                  presence.override === option.override
                    ? tPresence("statusCurrent", {
                        label: tPresence(option.label),
                      })
                    : tPresence(option.label)
                }
                labelIcon={
                  presence.override === option.override ? (
                    <Check className="size-4" />
                  ) : (
                    <span className="size-4" />
                  )
                }
                onClick={() => {
                  setPresence({ override: option.override }).catch(
                    (error: unknown) => {
                      console.error("Failed to set presence status:", error);
                      toast.error(tPresence("statusFailed"));
                    },
                  );
                }}
              />
            ))}
          <UserButton.Action label="manageAccount" />
          <UserButton.Action label="signOut" />
        </UserButton.MenuItems>
        {/* Custom pages mounted inside Clerk's own UserProfile modal. */}
        <UserButton.UserProfilePage
          label={t("user.preferences")}
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
        <UserButton.UserProfilePage
          label={t("user.privacySafety")}
          labelIcon={<ShieldBan className="size-4" />}
          url="privacy-safety"
        >
          <PrivacySafetyPanel />
        </UserButton.UserProfilePage>
      </UserButton>
      <PresenceDot
        status={ownStatus}
        className={tapTarget ? "right-2 bottom-2" : undefined}
      />
    </span>
  );
}

// Content of the Clerk custom profile page: the content-width choice and the
// hide-email toggle (useShellPreferences, Clerk metadata) plus the solve-duration
// tracking and share-in-progress toggles (useUserSettings, the Solving-context
// Convex preferences). Uses the shell.user.* and solving.settings.* translations.
function PreferencesPage() {
  const { fullWidth, hideEmail, setPreference } = useShellPreferences();
  const {
    trackCompletionDuration,
    setTrackDuration,
    shareInProgress,
    setShareInProgress,
  } = useUserSettings();
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
        <div className="flex items-center justify-between gap-4">
          <label
            htmlFor="share-in-progress"
            className="text-muted-foreground text-sm"
          >
            {ts("shareInProgressLabel")}
          </label>
          <Switch
            id="share-in-progress"
            checked={shareInProgress === true}
            onCheckedChange={(checked) => void setShareInProgress(checked)}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {ts("shareInProgressHint")}
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
