import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, TrendingUp, HelpCircle, Settings } from 'lucide-react';

export function Header() {
  return (
    <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50 h-[57px]">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center space-x-2">
          <Link
            href="/"
            className="flex items-center space-x-2 hover:opacity-80 transition-opacity"
          >
            <span className="text-2xl">🧩</span>
            <span className="text-xl font-bold bg-gradient-to-r from-jigsaw-primary to-jigsaw-secondary bg-clip-text text-transparent">
              JigSwap
            </span>
          </Link>
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
