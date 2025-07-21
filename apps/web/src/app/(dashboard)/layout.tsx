import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Header } from "./_components/layout/header";
import { MainContent } from "./_components/layout/main-content";
import { Sidebar } from "./_components/layout/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  return (
    <div className="bg-background ">
      {/* Top Header */}
      <SidebarProvider className="pt-[57px]">
        <Sidebar />
        <SidebarInset>
          <Header />
          {/* Main Content */}
          <MainContent>{children}</MainContent>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
