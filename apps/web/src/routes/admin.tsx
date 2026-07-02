import { Outlet, createFileRoute } from "@tanstack/react-router";

import { Link } from "@/compat/link";
import { AdminNotFound } from "@/components/NotFound";
import { HeaderLogo } from "@/components/common/header-logo";
import { UserProfile } from "@/components/common/user-profile";
import { PageLoading } from "@/components/ui/loading";
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
import { requireAdmin } from "@/lib/require-admin";
import { Home } from "lucide-react";
import { useTranslations } from "use-intl";

// Path layout for /admin. beforeLoad (requireAdmin) requires an authenticated user AND
// the backend-confirmed admin role (gateway.identity.isAdmin); non-admins are redirected.
// The guard is cosmetic — every admin Convex function re-checks isAdmin server-side.
// Renders the admin sidebar chrome + Outlet; children are
// routes/admin/{index,categories,moderation,contact,feedback}.tsx.
export const Route = createFileRoute("/admin")({
  beforeLoad: ({ location }) => requireAdmin({ location }),
  pendingComponent: AdminPending,
  // 404 inside /admin renders within the admin shell (this layout's Outlet).
  notFoundComponent: AdminNotFound,
  component: AdminLayout,
});

function AdminPending() {
  const t = useTranslations("admin.layout");
  return <PageLoading message={t("loading")} />;
}

function AdminLayout() {
  const t = useTranslations("admin.layout");
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
                    {t("home")}
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
