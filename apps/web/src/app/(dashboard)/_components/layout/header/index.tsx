import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Bell, HelpCircle, Settings, TrendingUp } from "lucide-react";
import Link from "next/link";

export function Header() {
  return (
    <header className="border-b bg-card/50 backdrop-blur-sm fixed top-0 left-0 right-0 z-50 h-[57px]">
      <div className="mx-auto px-4 py-3 flex items-center justify-between ">
        <div className="flex items-center w-[calc(var(--sidebar-width)-(var(--spacing)*8))]">
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center space-x-2 hover:opacity-80 transition-opacity"
          >
            <span className="text-2xl">🧩</span>
            <span className="text-xl font-bold bg-gradient-to-r from-jigsaw-primary to-jigsaw-secondary bg-clip-text text-transparent">
              JigSwap
            </span>
          </Link>
          <SidebarTrigger className="ml-auto" />
        </div>
        {/* Top Navigation */}
        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="sm" className="relative">
            <Bell className="h-4 w-4" />
            <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 text-xs">
              3
            </Badge>
          </Button>

          <Button variant="ghost" size="sm">
            <TrendingUp className="h-4 w-4" />
          </Button>

          <Button variant="ghost" size="sm">
            <HelpCircle className="h-4 w-4" />
          </Button>

          <Button variant="ghost" size="sm">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
