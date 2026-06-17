"use client";

// Bottom-left user identity (the ONLY place the user appears in the shell on
// desktop): the Clerk user button (avatar → account dropdown, which carries the
// "My profile" link to /profile) plus the name + email. Clicking the name/email
// opens the same account dropdown as the avatar, so the whole row acts as one
// control instead of competing click targets. The email blurs (and becomes
// unselectable) when the hide-email preference is on.
//
// The shell preferences (content width, hide email) live INSIDE Clerk's own
// profile UI as a custom <UserButton.UserProfilePage> ("Preferences"), persisted
// to the Clerk user (see preferences.tsx). Admin users get a Shield badge that
// deep-links to /admin.

import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { CheckRole } from "@/components/utils/check-role/server";
import { cn } from "@/lib/utils";
import { Shield } from "lucide-react";
import { useRef } from "react";
import { useTranslations } from "use-intl";
import { useShellPreferences } from "./preferences";
import { ShellUserButton } from "./shell-user-button";

export function UserFooter() {
  const { user } = useUser();
  const { hideEmail } = useShellPreferences();
  const rootRef = useRef<HTMLDivElement>(null);

  if (!user) {
    return null;
  }

  const email = user.primaryEmailAddress?.emailAddress ?? user.username ?? "";

  // Make the whole identity block open the same account menu as the avatar.
  // Clerk's <UserButton> must stay its own <button> (the avatar), so rather than
  // nesting buttons we forward a click on the name/email to Clerk's trigger via
  // its stable .cl-userButtonTrigger class — clicking anywhere on the row opens
  // the menu, and /profile / sign out / preferences all live inside it.
  const openUserMenu = () => {
    rootRef.current
      ?.querySelector<HTMLButtonElement>(".cl-userButtonTrigger")
      ?.click();
  };

  return (
    <div
      ref={rootRef}
      className="flex items-center gap-2 rounded-md p-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
    >
      <ShellUserButton />
      <button
        type="button"
        onClick={openUserMenu}
        aria-haspopup="menu"
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
      </button>
      <AdminBadge />
    </div>
  );
}

// Admin-only quick link to /admin. Non-admins render nothing here (CheckRole
// gates on the Clerk session's publicMetadata.role).
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
