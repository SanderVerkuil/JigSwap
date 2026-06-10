import { Outlet, createFileRoute } from "@tanstack/react-router";

import { HeaderLogo } from "@/components/common/header-logo";
import { UserProfile } from "@/components/common/user-profile";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { PageLoading } from "@/components/ui/loading";
import { Link } from "@/compat/link";
import { requireAdmin } from "@/lib/require-admin";
import { Home } from "lucide-react";

// Path layout for /admin. The Next admin layout was an async server component doing
// auth()+redirect with a TODO admin check; that becomes a beforeLoad (requireAdmin:
// authenticated AND publicMetadata.role === "admin"). Renders the admin sidebar chrome
// + Outlet; children are routes/admin/{index,categories,moderation}.tsx.
export const Route = createFileRoute("/admin")({
  beforeLoad: ({ location }) => requireAdmin({ location }),
  pendingComponent: () => <PageLoading message="Loading admin panel..." />,
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <div className="min-h-screen bg-background">
      <SidebarProvider>
        <Sidebar variant="inset">
          <SidebarHeader>
            <HeaderLogo className="pl-0 h-8" />
          </SidebarHeader>
          <SidebarContent />
          <SidebarFooter>
            <UserProfile />
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link href="/dashboard">
                    <Home />
                    Home
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <main className="container p-6 mx-auto">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
