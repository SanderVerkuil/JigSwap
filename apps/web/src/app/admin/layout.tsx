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
import { auth } from "@clerk/nextjs/server";
import { Home } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  // TODO: Add proper admin role check
  // For now, we'll allow any authenticated user to access admin
  // In production, you should check if the user has admin privileges

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
          <main className="container p-6 mx-auto">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
