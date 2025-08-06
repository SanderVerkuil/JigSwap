"use client";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { UserButton, useUser } from "@clerk/nextjs";

export function UserProfile() {
  const { user } = useUser();

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
              {user.firstName} {user.lastName}
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
