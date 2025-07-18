import { Separator } from '@/components/ui/separator';
import { Navigation } from '../navigation';
import { SidebarContent } from '../../../sidebar-content';
import { UserProfile } from '../user-profile';

export function Sidebar() {
  return (
    <aside className="w-64 min-h-[calc(100vh-73px)] bg-card/30 border-r backdrop-blur-sm">
      {/* Navigation */}
      <Navigation />

      <Separator className="mx-4" />

      {/* Dynamic Sidebar Content */}
      <div className="p-4">
        <SidebarContent />
      </div>

      {/* Bottom User Section */}
      <UserProfile />
    </aside>
  );
}
