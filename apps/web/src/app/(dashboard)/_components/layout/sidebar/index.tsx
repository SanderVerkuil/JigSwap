import { Separator } from "@/components/ui/separator";
import { SidebarContent } from "../../../sidebar-content";
import { Navigation } from "../navigation";
import { UserProfile } from "../user-profile";

export function Sidebar() {
  return (
    <aside className="w-64 h-[calc(100vh-57px)] bg-card/30 border-r backdrop-blur-sm sticky top-[57px] flex flex-col">
      {/* Navigation - fixed at top */}
      <div className="flex-shrink-0">
        <Navigation />
        <Separator />
      </div>

      {/* Dynamic Sidebar Content - scrollable middle section */}
      <div className="flex-1 overflow-y-auto p-4">
        <SidebarContent />
      </div>

      {/* Bottom User Section - sticky at bottom */}
      <div className="flex-shrink-0">
        <UserProfile />
      </div>
    </aside>
  );
}
