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
    <div className="min-h-screen bg-background">
      {/* Top Header */}
      <Header />

      <div className="flex">
        {/* Sidebar */}
        <Sidebar />

        {/* Main Content */}
        <MainContent>{children}</MainContent>
      </div>
    </div>
  );
}
