import { UserProfile } from "@/components/common/user-profile";
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
import { Link } from "@/compat/link";
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  CircleCheck,
  FolderOpen,
  Home,
  MessageSquare,
  Package,
  PlusCircle,
  Puzzle,
  Search,
  Settings,
  Target,
  Users,
} from "lucide-react";
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
      url: "/puzzles",
      icon: Puzzle,
      action: {
        title: "Add Puzzle",
        url: "/puzzles/add",
        icon: PlusCircle,
      },
    },
    {
      title: "My Puzzles",
      url: "/my-puzzles",
      icon: Package,
      action: {
        title: "Add Puzzle",
        url: "/my-puzzles/add",
        icon: PlusCircle,
      },
    },
    {
      title: "Collections",
      url: "/collections",
      icon: FolderOpen,
    },
    {
      title: "Circles",
      url: "/circles",
      icon: Users,
    },
    {
      title: "Completions",
      url: "/completions",
      icon: CircleCheck,
    },
    {
      title: "Goals",
      url: "/goals",
      icon: Target,
    },
    {
      title: "Insights",
      url: "/insights",
      icon: BarChart3,
    },
    {
      title: "Exchanges",
      url: "/trades",
      icon: ArrowLeftRight,
    },
    {
      title: "Community",
      url: "/community",
      icon: Users,
    },
    {
      title: "Messages",
      url: "/messages",
      icon: MessageSquare,
    },
    {
      title: "Notifications",
      url: "/notifications",
      icon: Bell,
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
