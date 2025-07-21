import {
  Sidebar as AppSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  ArrowLeftRight,
  Home,
  MessageSquare,
  Package,
  PlusCircle,
  Search,
  Settings,
} from "lucide-react";
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
      title: "Trades",
      url: "/trades",
      icon: ArrowLeftRight,
    },
    {
      title: "Messages",
      url: "/messages",
      icon: MessageSquare,
    },
    {
      title: "Admin",
      url: "/admin",
      icon: Settings,
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
        <SidebarSeparator />
        <UserProfile />
      </SidebarFooter>
      <SidebarRail />
    </AppSidebar>
  );
}
