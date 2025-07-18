'use client';

import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Home,
  Package,
  Star,
  Clock,
  MapPin,
  Filter,
  ArrowLeftRight,
  MessageSquare,
  Bell,
  Activity,
  Zap,
} from 'lucide-react';

// Dynamic sidebar content based on current page
function getSidebarContent(pathname: string) {
  const baseFilters = [
    { label: 'All Items', value: 'all', icon: Package },
    { label: 'Favorites', value: 'favorites', icon: Star },
    { label: 'Recent', value: 'recent', icon: Clock },
  ];

  const locationFilters = [
    { label: 'Nearby', value: 'nearby', icon: MapPin },
    { label: 'My City', value: 'city', icon: MapPin },
    { label: 'My Region', value: 'region', icon: MapPin },
  ];

  const categoryFilters = [
    { label: 'Jigsaw Puzzles', value: 'jigsaw', icon: Package },
    { label: 'Crossword', value: 'crossword', icon: Package },
    { label: 'Brain Teasers', value: 'brain-teasers', icon: Package },
    { label: 'Board Games', value: 'board-games', icon: Package },
  ];

  const statusFilters = [
    { label: 'Available', value: 'available', icon: Zap },
    { label: 'In Progress', value: 'in-progress', icon: Activity },
    { label: 'Completed', value: 'completed', icon: Star },
  ];

  switch (pathname) {
    case '/browse':
      return {
        title: 'Browse Filters',
        icon: Filter,
        sections: [
          { title: 'Quick Filters', items: baseFilters },
          { title: 'Location', items: locationFilters },
          { title: 'Categories', items: categoryFilters },
        ],
      };
    case '/my-puzzles':
      return {
        title: 'My Puzzles',
        icon: Package,
        sections: [
          { title: 'Status', items: statusFilters },
          { title: 'Categories', items: categoryFilters },
        ],
      };
    case '/trades':
      return {
        title: 'Trade Filters',
        icon: ArrowLeftRight,
        sections: [
          {
            title: 'Trade Status',
            items: [
              { label: 'Active Trades', value: 'active', icon: Activity },
              { label: 'Pending', value: 'pending', icon: Clock },
              { label: 'Completed', value: 'completed', icon: Star },
            ],
          },
        ],
      };
    case '/messages':
      return {
        title: 'Messages',
        icon: MessageSquare,
        sections: [
          {
            title: 'Conversations',
            items: [
              { label: 'All Messages', value: 'all', icon: MessageSquare },
              { label: 'Unread', value: 'unread', icon: Bell },
              { label: 'Important', value: 'important', icon: Star },
            ],
          },
        ],
      };
    default:
      return {
        title: 'Quick Access',
        icon: Home,
        sections: [{ title: 'Recent Activity', items: baseFilters }],
      };
  }
}

export function SidebarContent() {
  const pathname = usePathname();
  const content = getSidebarContent(pathname);
  const IconComponent = content.icon;

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 px-4">
        <IconComponent className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold text-sm">{content.title}</h3>
      </div>

      {content.sections.map((section, sectionIndex) => (
        <div key={sectionIndex} className="space-y-2">
          <h4 className="px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {section.title}
          </h4>
          <div className="space-y-1">
            {section.items.map((item, itemIndex) => {
              const ItemIcon = item.icon;
              return (
                <Button
                  key={itemIndex}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start px-4 h-8 text-xs"
                >
                  <ItemIcon className="mr-2 h-3 w-3" />
                  {item.label}
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
