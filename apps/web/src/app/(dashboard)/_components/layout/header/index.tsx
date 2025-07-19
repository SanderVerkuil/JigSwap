import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ModeToggle } from "@/components/ui/theme-toggle";
import Link from "next/link";

export function Header() {
  return (
    <header className="border-b bg-card/50 backdrop-blur-sm fixed top-0 left-0 right-0 z-50 h-[57px]">
      <div className="mx-auto pl-4 pr-6 py-3 flex items-center justify-between ">
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
          <ModeToggle />
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
