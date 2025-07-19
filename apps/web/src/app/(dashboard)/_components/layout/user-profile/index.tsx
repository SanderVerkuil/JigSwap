"use client";

import { UserButton, useUser } from "@clerk/nextjs";

export function UserProfile() {
  const { user } = useUser();

  if (!user) {
    return null;
  }

  return (
    <div className="bg-card/50 backdrop-blur-sm">
      <div className="space-y-3">
        {/* User Profile */}
        <div className="flex items-center space-x-3 p-3 rounded-lg bg-muted/30">
          <UserButton
            appearance={{
              elements: {
                avatarBox: "w-6 h-6",
              },
            }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {user.firstName} {user.lastName}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
