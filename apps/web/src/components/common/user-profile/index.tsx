"use client";

import { UserButton, useUser } from "@/compat/clerk";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useMemberDisplayName } from "@/lib/member-display-name";

export function UserProfile() {
  const { user } = useUser();
  const displayName = useMemberDisplayName();

  if (!user) {
    return null;
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <UserButton
            appearance={{
              elements: {
                userButtonAvatarBox: "!w-8 !h-8",
              },
            }}
          />
          <div className="grid flex-1 text-left text-sm leading-right">
            <span className="truncate font-medium">
              {displayName({
                name: [user.firstName, user.lastName].filter(Boolean).join(" "),
                username: user.username,
              })}
            </span>
            <span className="truncate text-xs">
              {user.username || user.primaryEmailAddress?.emailAddress || ""}
            </span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
