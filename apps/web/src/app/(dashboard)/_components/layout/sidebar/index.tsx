import {
  Sidebar as AppSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { CheckRole } from "@/components/utils/check-role/server";
import {
  ArrowLeftRight,
  FolderOpen,
  Home,
  MessageSquare,
  Package,
  PlusCircle,
  Search,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { UserProfile } from "../user-profile";
import { Item, Navigation } from "./navigation";
import { SidebarContent as SidebarContentComponent } from "./sidebar-content";

const getItems: () => Item[] = () => {
  return [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: Home,
    },
    {
      title: "Browse Puzzles",
      url: "/browse",
      icon: Search,
    },
    {
      title: "Add Puzzle",
      url: "/puzzles/add",
      icon: PlusCircle,
    },
    {
      title: "My Puzzles",
      url: "/puzzles",
      icon: Package,
    },
    {
      title: "Collections",
      url: "/collections",
      icon: FolderOpen,
    },
    {
      title: "Trades",
      url: "/trades",
      icon: ArrowLeftRight,
    },
    {
      title: "Messages",
      url: "/messages",
      icon: MessageSquare,
    },
  ];
};

export function Sidebar() {
  return (
    <AppSidebar variant="inset" collapsible="icon" className="top-[57px]">
      <SidebarContent>
        <Navigation items={getItems()} />
        <SidebarSeparator />
        <SidebarContentComponent />
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator className="mx-0 w-full" />
        <UserProfile />

        <CheckRole role="admin">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton>
                <Settings />
                <Link href="/admin">Admin</Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </CheckRole>
      </SidebarFooter>
      <SidebarRail />
    </AppSidebar>
  );
}
