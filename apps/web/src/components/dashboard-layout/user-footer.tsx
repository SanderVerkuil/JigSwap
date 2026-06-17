"use client";

// Bottom-left user identity (the ONLY place the user appears in the shell on
// desktop): the Clerk user button (avatar → account dropdown, which now carries
// the "My profile" link to /profile) plus a display-only name + email label.
// The email blurs (and becomes unselectable) when the hide-email preference is
// on. The avatar is the single control — the name is no longer a competing link
// to /profile; that route lives inside the dropdown (see ShellUserButton).
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
import { useTranslations } from "use-intl";
import { useShellPreferences } from "./preferences";
import { ShellUserButton } from "./shell-user-button";

export function UserFooter() {
  const { user } = useUser();
  const { hideEmail } = useShellPreferences();

  if (!user) {
    return null;
  }

  const email = user.primaryEmailAddress?.emailAddress ?? user.username ?? "";

  return (
    <div className="flex items-center gap-2 rounded-md p-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0">
      <ShellUserButton />
      {/* Display-only identity: every action (account management, sign out, and
          the link to /profile) lives in the avatar's dropdown, so this is no
          longer a click target of its own. */}
      <div className="grid min-w-0 flex-1 px-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
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
      </div>
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
