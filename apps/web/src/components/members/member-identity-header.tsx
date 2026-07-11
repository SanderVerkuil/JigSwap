"use client";

// Shared identity block for every /members/$handle tier: avatar, display name,
// @username (muted mono), member-since — with an optional right-aligned action
// slot (Follow/Message on the full profile; nothing on the teaser).

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useFormatter, useTranslations } from "use-intl";

export function MemberIdentityHeader({
  displayName,
  username,
  avatar,
  memberSince,
  location,
  actions,
}: {
  displayName: string;
  username?: string;
  avatar?: string;
  memberSince: number;
  location?: string;
  actions?: React.ReactNode;
}) {
  const t = useTranslations("members");
  const format = useFormatter();

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar className="size-20 shrink-0">
        {avatar && <AvatarImage src={avatar} alt={displayName} />}
        <AvatarFallback className="text-2xl">
          {displayName.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <h1 className="font-heading truncate text-3xl">{displayName}</h1>
        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
          {username && <span className="font-mono">@{username}</span>}
          <span>
            {t("memberSince", {
              date: format.dateTime(new Date(memberSince), {
                year: "numeric",
                month: "long",
              }),
            })}
          </span>
          {location && <span>{location}</span>}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
