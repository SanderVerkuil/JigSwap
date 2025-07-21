import { HeaderLogo } from "@/components/common/header-logo";
import {
  Sidebar,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
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
            <HeaderLogo className="pl-0 h-16" />
          </SidebarHeader>
        </Sidebar>
        <SidebarInset>
          <main className="container mx-auto px-4 py-8">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
