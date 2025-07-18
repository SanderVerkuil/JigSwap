import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Home,
  Search,
  PlusCircle,
  Package,
  MessageSquare,
  User,
  ArrowLeftRight,
} from 'lucide-react';

export function Navigation() {
  return (
    <nav className="p-4 space-y-1">
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
  );
}
