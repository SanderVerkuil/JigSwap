"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  ArrowLeftRight,
  Award,
  BarChart3,
  Bell,
  Bookmark,
  BookOpen,
  Calendar,
  Clock,
  Filter,
  Globe,
  Home,
  Lock,
  MapPin,
  MessageCircle,
  MessageSquare,
  Package,
  PlusCircle,
  Search,
  Settings,
  Shield,
  Star,
  Target,
  ThumbsUp,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { usePathname } from "next/navigation";

// Dynamic sidebar content based on current page
function getSidebarContent(pathname: string) {
  const baseFilters = [
    { label: "All Items", value: "all", icon: Package },
    { label: "Favorites", value: "favorites", icon: Star },
    { label: "Recent", value: "recent", icon: Clock },
  ];

  const locationFilters = [
    { label: "Nearby", value: "nearby", icon: MapPin },
    { label: "My City", value: "city", icon: MapPin },
    { label: "My Region", value: "region", icon: MapPin },
  ];

  const categoryFilters = [
    { label: "Jigsaw Puzzles", value: "jigsaw", icon: Package },
    { label: "Crossword", value: "crossword", icon: Package },
    { label: "Brain Teasers", value: "brain-teasers", icon: Package },
    { label: "Board Games", value: "board-games", icon: Package },
  ];

  const statusFilters = [
    { label: "Available", value: "available", icon: Zap },
    { label: "In Progress", value: "in-progress", icon: Activity },
    { label: "Completed", value: "completed", icon: Star },
  ];

  const visibilityFilters = [
    { label: "Public", value: "public", icon: Globe },
    { label: "Friends Only", value: "friends", icon: Users },
    { label: "Private", value: "private", icon: Lock },
  ];

  const analyticsFilters = [
    { label: "Completion Stats", value: "completion", icon: BarChart3 },
    { label: "Time Tracking", value: "time", icon: Clock },
    { label: "Goals", value: "goals", icon: Target },
    { label: "Trends", value: "trends", icon: TrendingUp },
  ];

  const communityFilters = [
    { label: "All Users", value: "all", icon: Users },
    { label: "Following", value: "following", icon: UserCheck },
    { label: "Followers", value: "followers", icon: UserPlus },
    { label: "Nearby", value: "nearby", icon: MapPin },
  ];

  const friendCircleFilters = [
    { label: "My Circles", value: "my-circles", icon: Shield },
    { label: "Invitations", value: "invitations", icon: Bell },
    { label: "Discover", value: "discover", icon: Search },
  ];

  switch (pathname) {
    case "/browse":
      return {
        title: "Browse Filters",
        icon: Filter,
        sections: [
          { title: "Quick Filters", items: baseFilters },
          { title: "Location", items: locationFilters },
          { title: "Categories", items: categoryFilters },
          { title: "Visibility", items: visibilityFilters },
        ],
      };
    case "/my-puzzles":
      return {
        title: "My Puzzles",
        icon: Package,
        sections: [
          { title: "Status", items: statusFilters },
          { title: "Categories", items: categoryFilters },
          { title: "Visibility", items: visibilityFilters },
        ],
      };
    case "/trades":
      return {
        title: "Trade Filters",
        icon: ArrowLeftRight,
        sections: [
          {
            title: "Trade Status",
            items: [
              { label: "Active Trades", value: "active", icon: Activity },
              { label: "Pending", value: "pending", icon: Clock },
              { label: "Completed", value: "completed", icon: Star },
            ],
          },
          {
            title: "Exchange Type",
            items: [
              { label: "Lending", value: "lending", icon: BookOpen },
              { label: "Swapping", value: "swapping", icon: ArrowLeftRight },
              { label: "Trading", value: "trading", icon: Package },
            ],
          },
        ],
      };
    case "/messages":
      return {
        title: "Messages",
        icon: MessageSquare,
        sections: [
          {
            title: "Conversations",
            items: [
              { label: "All Messages", value: "all", icon: MessageSquare },
              { label: "Unread", value: "unread", icon: Bell },
              { label: "Important", value: "important", icon: Star },
            ],
          },
        ],
      };
    case "/analytics":
      return {
        title: "Analytics",
        icon: BarChart3,
        sections: [
          { title: "Personal Stats", items: analyticsFilters },
          {
            title: "Goals",
            items: [
              { label: "Monthly Goals", value: "monthly", icon: Calendar },
              { label: "Yearly Goals", value: "yearly", icon: Calendar },
              { label: "Custom Goals", value: "custom", icon: Target },
            ],
          },
        ],
      };
    case "/community":
      return {
        title: "Community",
        icon: Users,
        sections: [
          { title: "Users", items: communityFilters },
          {
            title: "Content",
            items: [
              { label: "Reviews", value: "reviews", icon: Star },
              {
                label: "Discussions",
                value: "discussions",
                icon: MessageCircle,
              },
              { label: "Trending", value: "trending", icon: TrendingUp },
            ],
          },
        ],
      };
    case "/friend-circles":
      return {
        title: "Friend Circles",
        icon: Shield,
        sections: [
          { title: "Circles", items: friendCircleFilters },
          {
            title: "Privacy",
            items: [
              { label: "Private", value: "private", icon: Lock },
              { label: "Invite Only", value: "invite-only", icon: UserPlus },
              { label: "Public", value: "public", icon: Globe },
            ],
          },
        ],
      };
    case "/profiles":
      return {
        title: "Profiles",
        icon: Users,
        sections: [
          { title: "User Discovery", items: communityFilters },
          {
            title: "Activity",
            items: [
              { label: "Recent Activity", value: "recent", icon: Activity },
              { label: "Achievements", value: "achievements", icon: Award },
              { label: "Collections", value: "collections", icon: Package },
            ],
          },
        ],
      };
    case "/reviews":
      return {
        title: "Reviews",
        icon: Star,
        sections: [
          {
            title: "My Reviews",
            items: [
              { label: "Written", value: "written", icon: Star },
              { label: "Drafts", value: "drafts", icon: Bookmark },
              { label: "Helpful", value: "helpful", icon: ThumbsUp },
            ],
          },
          {
            title: "Community",
            items: [
              { label: "Recent", value: "recent", icon: Clock },
              { label: "Top Rated", value: "top-rated", icon: Star },
              { label: "Most Helpful", value: "helpful", icon: ThumbsUp },
            ],
          },
        ],
      };
    case "/goals":
      return {
        title: "Goals",
        icon: Target,
        sections: [
          {
            title: "Goal Types",
            items: [
              { label: "Completion Goals", value: "completion", icon: Target },
              { label: "Time Goals", value: "time", icon: Clock },
              { label: "Collection Goals", value: "collection", icon: Package },
            ],
          },
          {
            title: "Timeframes",
            items: [
              { label: "Monthly", value: "monthly", icon: Calendar },
              { label: "Yearly", value: "yearly", icon: Calendar },
              { label: "Custom", value: "custom", icon: Settings },
            ],
          },
        ],
      };
    case "/completion-tracking":
      return {
        title: "Progress Tracking",
        icon: Target,
        sections: [
          {
            title: "Tracking",
            items: [
              { label: "Active Puzzles", value: "active", icon: Activity },
              { label: "Completed", value: "completed", icon: Star },
              { label: "Time Logs", value: "time-logs", icon: Clock },
            ],
          },
          {
            title: "Analytics",
            items: [
              { label: "Progress Stats", value: "stats", icon: BarChart3 },
              {
                label: "Time Analysis",
                value: "time-analysis",
                icon: TrendingUp,
              },
              { label: "Achievements", value: "achievements", icon: Award },
            ],
          },
        ],
      };
    default:
      return {
        title: "Quick Access",
        icon: Home,
        sections: [
          { title: "Recent Activity", items: baseFilters },
          {
            title: "Quick Actions",
            items: [
              { label: "Add Puzzle", value: "add-puzzle", icon: PlusCircle },
              { label: "Browse", value: "browse", icon: Search },
              { label: "My Collection", value: "my-collection", icon: Package },
            ],
          },
        ],
      };
  }
}

export function SidebarContent() {
  const pathname = usePathname();
  const content = getSidebarContent(pathname);
  const IconComponent = content.icon;

  // Helper function to check if a feature is coming soon
  const isComingSoon = (pathname: string, itemValue: string) => {
    const comingSoonFeatures = {
      "/analytics": ["completion", "time", "goals", "trends"],
      "/community": ["all", "following", "followers", "nearby"],
      "/friend-circles": ["my-circles", "invitations", "discover"],
      "/profiles": ["all", "following", "followers", "nearby"],
      "/reviews": ["written", "drafts", "helpful", "recent", "top-rated"],
      "/goals": [
        "completion",
        "time",
        "collection",
        "monthly",
        "yearly",
        "custom",
      ],
      "/completion-tracking": [
        "active",
        "completed",
        "time-logs",
        "stats",
        "time-analysis",
        "achievements",
      ],
    };

    return (
      comingSoonFeatures[pathname as keyof typeof comingSoonFeatures]?.includes(
        itemValue,
      ) || false
    );
  };

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
              const comingSoon = isComingSoon(pathname, item.value);

              return (
                <Button
                  key={itemIndex}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start px-4 h-8 text-xs"
                  disabled={comingSoon}
                >
                  <ItemIcon className="mr-2 h-3 w-3" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {comingSoon && (
                    <Badge variant="secondary" className="text-xs ml-auto">
                      Soon™
                    </Badge>
                  )}
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
