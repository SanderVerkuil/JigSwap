"use client";

// Bottom-left user identity (the ONLY place the user appears in the shell):
// avatar + name + email. The email blurs (and becomes unselectable) when the
// hide-email preference is on. The small settings affordance opens the shell
// preferences menu (content width, hide email) and carries the admin link.

import { UserButton, useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CheckRole } from "@/components/utils/check-role/server";
import { cn } from "@/lib/utils";
import { Settings2, Shield } from "lucide-react";
import { useTranslations } from "use-intl";
import { useShellPreferences } from "./preferences";

export function UserFooter() {
  const { user } = useUser();
  const { hideEmail } = useShellPreferences();

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
      />
      <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
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
      <PreferencesMenu />
    </div>
  );
}

function PreferencesMenu() {
  const { fullWidth, hideEmail, setPreference } = useShellPreferences();
  const t = useTranslations("shell.user");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden"
          aria-label={t("openPreferences")}
        >
          <Settings2 className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-56">
        <DropdownMenuLabel>{t("preferences")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t("contentWidth")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={fullWidth ? "full" : "centered"}
          onValueChange={(value) =>
            setPreference("fullWidth", value === "full")
          }
        >
          <DropdownMenuRadioItem value="centered">
            {t("centered")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="full">
            {t("fullWidth")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={hideEmail}
          onCheckedChange={(checked) =>
            setPreference("hideEmail", checked === true)
          }
        >
          {t("hideEmail")}
        </DropdownMenuCheckboxItem>
        <CheckRole role="admin">
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <Shield className="size-4" />
              {t("admin")}
            </Link>
          </DropdownMenuItem>
        </CheckRole>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
