import {
  Sidebar as AppSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Navigation } from "../navigation";
import { UserProfile } from "../user-profile";
import { SidebarContent as SidebarContentComponent } from "./sidebar-content";

export function Sidebar() {
  return (
    <AppSidebar variant="inset">
      <SidebarContent>
        <Navigation />
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
