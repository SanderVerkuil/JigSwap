import { Outlet, createFileRoute } from "@tanstack/react-router";

import { Header } from "@/components/dashboard-layout/header";
import { MainContent } from "@/components/dashboard-layout/main-content";
import { Sidebar } from "@/components/dashboard-layout/sidebar";
import { PageLoading } from "@/components/ui/loading";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireAuth } from "@/lib/require-auth";

// Pathless layout for the (dashboard) shell. The Next layout was an async server
// component running auth()+redirect("/sign-in"); that gate becomes a beforeLoad
// (requireAuth reads the Clerk userId off the root context and redirects to the
// Clerk sign-in catch-all when absent). The sidebar shell renders the chrome and
// part 2's leaf routes hang off this layout as routes/_dashboard/<page>.tsx.
export const Route = createFileRoute("/_dashboard")({
  beforeLoad: ({ context, location }) => requireAuth({ context, location }),
  pendingComponent: () => <PageLoading message="Loading dashboard..." />,
  component: DashboardLayout,
});

function DashboardLayout() {
  return (
    <div className="bg-background ">
      {/* Top Header */}
      <SidebarProvider className="pt-[57px]">
        <Sidebar />
        <SidebarInset>
          <Header />
          {/* Main Content */}
          <MainContent>
            <Outlet />
          </MainContent>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
