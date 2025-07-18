'use client';

import { UserButton, useUser } from '@clerk/nextjs';
import { ModeToggle } from '@/components/ui/theme-toggle';
import { LanguageSwitcher } from '@/components/ui/language-switcher';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Activity } from 'lucide-react';

export function UserProfile() {
  const { user } = useUser();

  if (!user) {
    return null;
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 p-4 border-t bg-card/50 backdrop-blur-sm">
      <div className="space-y-3">
        {/* User Profile */}
        <div className="flex items-center space-x-3 p-3 rounded-lg bg-muted/30">
          <UserButton
            appearance={{
              elements: {
                avatarBox: 'w-6 h-6',
              },
            }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {user.firstName} {user.lastName}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <LanguageSwitcher />
            <ModeToggle />
          </div>
          <div className="flex items-center space-x-1">
            <Badge variant="secondary" className="text-xs">
              <Activity className="mr-1 h-3 w-3" />
              Online
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}
