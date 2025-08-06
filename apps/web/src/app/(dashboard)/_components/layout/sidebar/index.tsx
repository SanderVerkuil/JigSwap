import {
  Sidebar as AppSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { CheckRole } from "@/components/utils/check-role/server";
import {
  ArrowLeftRight,
  FolderOpen,
  Home,
  MessageSquare,
  Package,
  PlusCircle,
  Puzzle,
  Search,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { UserProfile } from "../../../../../components/common/user-profile";
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
      title: "Puzzles",
      url: "/puzzles/products",
      icon: Puzzle,
      action: {
        title: "Add Puzzle",
        url: "/puzzles/products/add",
        icon: PlusCircle,
      },
    },
    {
      title: "My Puzzles",
      url: "/puzzles",
      icon: Package,
      action: {
        title: "Add Puzzle",
        url: "/puzzles/add",
        icon: PlusCircle,
      },
    },
    {
      title: "Collections",
      url: "/collections",
      icon: FolderOpen,
    },
    {
      title: "Exchanges",
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
    <AppSidebar
      variant="inset"
      collapsible="icon"
      className="h-[calc(100svh-57px)] top-[57px]"
    >
      <SidebarContent>
        <Navigation items={getItems()} />
        <SidebarContentComponent />
      </SidebarContent>

      <SidebarFooter>
        <UserProfile />
        <CheckRole role="admin">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link href="/admin">
                  <Settings />
                  Admin
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </CheckRole>
      </SidebarFooter>
      <SidebarRail />
    </AppSidebar>
  );
}
