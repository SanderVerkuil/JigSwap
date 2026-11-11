"use client";

// The shell's user menu: Clerk's <UserButton> account dropdown (manage account,
// sign out) plus a "My profile" link to the app's own profile page and a custom
// "Preferences" page (content width, hide email, solve-duration tracking) mounted
// inside Clerk's profile modal. Shared by the desktop sidebar footer and the mobile
// top bar so both open the same menu instead of hard-navigating to /profile.
// Once the member shares their presence it also offers the status choice
// (Automatic / Away / Appear offline) and shows their own status dot, except while
// the app is offline. "Help & guides" opens the Guides tab of What's new, so the
// tours are one tap from any page on desktop and phone (UX-91). What's new itself
// is listed only on the phone: the desktop sidebar has it right above the account row.
import { useClerk, UserButton, useUser } from "@/compat/clerk";
import { MemberInitial } from "@/components/members/member-initial";
import { NotificationPreferencesPanel } from "@/components/notifications/notification-preferences-panel";
import { useAppActivity } from "@/components/presence/app-presence";
import { PresenceDot } from "@/components/presence/presence-dot";
import { usePresenceSettings } from "@/components/presence/use-presence";
import { PrivacySafetyPanel } from "@/components/social/privacy-safety-panel";
import { showsSolveTime } from "@/components/solving/solve-time-fields";
import { Switch } from "@/components/ui/switch";
import { UnreadDot } from "@/components/whats-new/badges";
import { useWhatsNewUnreadCount } from "@/components/whats-new/use-whats-new-state";
import { gateway } from "@/gateway";
import { useUserSettings } from "@/hooks/use-user-settings";
import { openCookieSettings } from "@/lib/analytics-consent";
import { memberInitialOf } from "@/lib/member-display-name";
import { useConnectionState } from "@/lib/use-connection-state";
import { cn } from "@/lib/utils";
import { tearDownPushForSignOut } from "@/lib/web-push";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import type { PresenceSettingsView } from "@jigswap/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Bell,
  BookOpen,
  Check,
  CircleHelp,
  Cookie,
  House,
  ListChecks,
  LogOut,
  Shield,
  ShieldBan,
  SlidersHorizontal,
  Sparkles,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import {
  LanguageRadios,
  moveRadioWithArrows,
  ThemeRadios,
} from "./display-preferences";
import { useShellPreferences } from "./preferences";

// Clerk's own focus style is a faint 4px box-shadow, about 1.4:1 on the lavender sidebar: this is
// the ring every other control has. Important, to beat the box-shadow Clerk sets on focus.
const TRIGGER_FOCUS_RING =
  "focus-visible:ring-2! focus-visible:ring-ring! focus-visible:ring-offset-2! focus-visible:ring-offset-background!";

// Clerk's menu rows are about 50px. A mouse gets 36px rows, a touch screen keeps 44px targets, and
// the menu scrolls inside itself when it is taller than the window, so Sign out stays in reach.
const MENU_ROW =
  "pointer-fine:min-h-9! pointer-fine:py-1.5! pointer-coarse:min-h-11! pointer-coarse:py-2.5!";

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
  // desktop sidebar footer leaves it compact (a 24px avatar in a nav-height row).
  tapTarget = false,
}: {
  tapTarget?: boolean;
}) {
  const t = useTranslations("shell");
  const tWhatsNew = useTranslations("whatsNew");
  const tQuickStart = useTranslations("quickStart.menu");
  const tFooter = useTranslations("marketing.footer");
  const navigate = useNavigate();
  const recordQuickStart = useConvexMutation(
    gateway.onboarding.recordQuickStart,
  );
  const tPresence = useTranslations("presence");
  const { user } = useUser();
  const clerk = useClerk();
  const unregisterPush = useConvexMutation(
    gateway.notifications.unregisterPush,
  );
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
  // While this page is offline nobody sees the member online, so the dot goes too.
  const { connected } = useConnectionState();

  // Backend-confirmed admin role — same source as the /admin route guard and
  // the sidebar's gated group; Convex dedupes the shared subscription. This
  // menu item is the mobile path to /admin (no admin tab in the tab bar).
  const { data: isAdmin } = useQuery(
    convexQuery(gateway.identity.isAdmin, user?.id ? {} : "skip"),
  );
  // Without a photo the trigger shows this initial on canal (below), and the menu's header shows
  // the same in place of Clerk's default picture.
  const initial =
    user && !user.hasImage
      ? memberInitialOf({ name: user.fullName, username: user.username })
      : undefined;

  return (
    // The dot sits beside Clerk's avatar (absolute, no layout shift), not
    // inside Clerk's markup.
    <span className="relative inline-flex shrink-0">
      <UserButton
        appearance={{
          elements: {
            // Clerk's own Sign out stays hidden: ours (below) tears push down first. Clerk
            // still renders a default item that isn't re-listed, so hiding is the only way out.
            userButtonPopoverActionButton__signOut: "!hidden",
            // `!` because Clerk's own unlayered `overflow: hidden` beats Tailwind's layered utilities.
            userButtonPopoverMain:
              "max-h-[calc(100dvh-140px)]! overflow-y-auto! overscroll-contain!",
            userButtonPopoverCustomItemButton: MENU_ROW,
            userButtonPopoverActionButton: MENU_ROW,
            ...(initial
              ? {
                  userPreviewAvatarImage: { display: "none" },
                  userPreviewAvatarBox: {
                    backgroundColor: "var(--primary)",
                    color: "var(--primary-foreground)",
                    display: "grid",
                    placeItems: "center",
                    // Clerk's box packs its grid tracks to the start; centre them too.
                    placeContent: "center",
                    "&::after": {
                      content: JSON.stringify(initial),
                      fontSize: "15px",
                      fontWeight: 600,
                    },
                  },
                }
              : {}),
            ...(tapTarget
              ? {
                  userButtonAvatarBox: "!w-7 !h-7",
                  userButtonTrigger: cn(
                    "!flex !size-11 !items-center !justify-center !rounded-lg hover:!bg-accent",
                    TRIGGER_FOCUS_RING,
                  ),
                }
              : {
                  userButtonAvatarBox: "!w-6 !h-6",
                  // The desktop sidebar on a touch screen (tablets): a 44px target.
                  userButtonTrigger: cn(
                    "pointer-coarse:flex! pointer-coarse:size-11! pointer-coarse:items-center! pointer-coarse:justify-center! pointer-coarse:rounded-lg!",
                    TRIGGER_FOCUS_RING,
                  ),
                }),
          },
        }}
      >
        {/* Custom menu items: a link to the app's own /profile alongside Clerk's
          default account action (re-listed so it keeps its place in the custom
          MenuItems block) and our own sign-out. */}
        <UserButton.MenuItems>
          <UserButton.Link
            label={t("pages.profile.title")}
            labelIcon={<User className="size-4" />}
            href="/profile"
          />
          {/* Clerk's label is a plain string, so the count goes in the text ("What's new (2)"),
            which also gives screen readers the count; the icon dot is decorative. Phone only:
            on desktop the sidebar lists What's new right above this menu's trigger. */}
          {tapTarget && (
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
          )}
          {/* Clerk parses the query, so this lands on the Guides tab. */}
          <UserButton.Link
            label={t("user.helpGuides")}
            labelIcon={<CircleHelp className="size-4" />}
            href="/whats-new?tab=guides"
          />
          <UserButton.Link
            label={t("user.docs")}
            labelIcon={<BookOpen className="size-4" />}
            href="/docs"
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
          {/* In the menu, not on the Privacy & safety page: that page is in Clerk's modal, which
            would cover the banner this reopens. Consent can be changed or withdrawn at any time
            (GDPR Art. 7(3)). Reopened once the menu has closed and handed focus back to its
            trigger, so the banner takes focus and returns it there. */}
          <UserButton.Action
            label={tFooter("cookieSettings")}
            labelIcon={<Cookie className="size-4" />}
            onClick={() => window.setTimeout(openCookieSettings)}
          />
          <UserButton.Action label="manageAccount" />
          {/* Sign out stops push to this browser first (SEC-54), while the
            session can still unregister it on the server, so a shared browser
            gets no more of this member's notifications. Bounded and
            best-effort: sign-out always follows, to Clerk's afterSignOutUrl. */}
          <UserButton.Action
            label={t("user.signOut")}
            labelIcon={<LogOut className="size-4" />}
            onClick={() => {
              void tearDownPushForSignOut((endpoint) =>
                unregisterPush({ endpoint }),
              )
                .then(() => clerk.signOut())
                .catch((error: unknown) =>
                  console.error("Failed to sign out:", error),
                );
            }}
          />
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
      {/* Clerk's default picture is a violet gradient, so without a real photo the initial covers
          it. Clicks fall through to Clerk's trigger. */}
      {user && !user.hasImage && (
        <span
          aria-hidden
          className={cn(
            "bg-primary text-primary-foreground pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[10px] font-semibold",
            // The phone's presence dot is larger, so the letter steps clear of it.
            tapTarget ? "size-7 pr-1 pb-1" : "size-6",
          )}
        >
          <MemberInitial
            source={{ name: user.fullName, username: user.username }}
          />
        </span>
      )}
      <PresenceDot
        status={connected ? ownStatus : undefined}
        className={
          tapTarget
            ? "right-2 bottom-2"
            : "-right-0.5 -bottom-0.5 size-2.5 ring-sidebar-skyline"
        }
      />
    </span>
  );
}

// Content of the Clerk custom profile page: the theme and language choices (the
// only way to reach them on a phone besides the quick sheet; the desktop top
// bar has menus for them), the content-width choice and the hide-email toggle
// (useShellPreferences, Clerk metadata) plus the solve-duration tracking and
// share-in-progress toggles (useUserSettings, the Solving-context Convex
// preferences). Uses the shell.theme/language/user.* and solving.settings.*
// translations.
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
  const tTheme = useTranslations("shell.theme");
  const tLanguage = useTranslations("shell.language");

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">{t("preferences")}</h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{tTheme("label")}</h2>
        <ThemeRadios />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{tLanguage("label")}</h2>
        <LanguageRadios />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{t("contentWidth")}</h2>
        <div
          role="radiogroup"
          aria-label={t("contentWidth")}
          onKeyDown={moveRadioWithArrows}
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
            // On by default: the solve dialogs ask for a time until the member turns it off.
            checked={showsSolveTime(trackCompletionDuration)}
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
      tabIndex={selected ? 0 : -1}
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
