import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { UserButton } from "@clerk/nextjs";
import { useTranslations } from 'next-intl';
import {
  Home,
  Search,
  PlusCircle,
  Package,
  MessageSquare,
  User,
  ArrowLeftRight
} from "lucide-react";

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
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Link href="/" className="flex items-center space-x-2">
              <span className="text-2xl">🧩</span>
              <span className="text-xl font-bold text-jigsaw-primary">JigSwap</span>
            </Link>
          </div>
          <div className="flex items-center space-x-4">
            <LanguageSwitcher />
            <ThemeToggle />
            <UserButton 
              appearance={{
                elements: {
                  avatarBox: "w-8 h-8"
                }
              }}
            />
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 min-h-[calc(100vh-73px)] bg-card border-r">
          <nav className="p-4 space-y-2">
            <Link href="/dashboard">
              <Button variant="ghost" className="w-full justify-start">
                <Home className="mr-2 h-4 w-4" />
                Dashboard
              </Button>
            </Link>
            <Link href="/browse">
              <Button variant="ghost" className="w-full justify-start">
                <Search className="mr-2 h-4 w-4" />
                Browse Puzzles
              </Button>
            </Link>
            <Link href="/puzzles/new">
              <Button variant="ghost" className="w-full justify-start">
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Puzzle
              </Button>
            </Link>
            <Link href="/my-puzzles">
              <Button variant="ghost" className="w-full justify-start">
                <Package className="mr-2 h-4 w-4" />
                My Puzzles
              </Button>
            </Link>
            <Link href="/trades">
              <Button variant="ghost" className="w-full justify-start">
                <ArrowLeftRight className="mr-2 h-4 w-4" />
                Trades
              </Button>
            </Link>
            <Link href="/messages">
              <Button variant="ghost" className="w-full justify-start">
                <MessageSquare className="mr-2 h-4 w-4" />
                Messages
              </Button>
            </Link>
            <Link href="/profile">
              <Button variant="ghost" className="w-full justify-start">
                <User className="mr-2 h-4 w-4" />
                Profile
              </Button>
            </Link>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}