"use client";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { CheckRole } from "@/components/utils/check-role";
import { UserButton, useUser } from "@clerk/nextjs";
import { Settings } from "lucide-react";
import Link from "next/link";

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
      <CheckRole role="admin">
        <SidebarMenuItem>
          <SidebarMenuButton>
            <Settings />
            <Link href="/admin">Admin</Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </CheckRole>
    </SidebarMenu>
  );
}
