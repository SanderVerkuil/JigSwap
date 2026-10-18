"use client";

// A circle thread's avatar (spec §6.1): up to two overlapping member avatars
// from the inbox row's memberPreview, inside the same square a DM avatar takes,
// or a Users glyph when there is nobody to show. Decorative: the circle's name
// always sits beside it. Static on purpose: it lives inside the row's link, so
// the interactive CircleAvatarStack (buttons with tooltips) doesn't fit here.
import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { UserRound, Users } from "lucide-react";
import type { CircleThread } from "./format";

type PreviewMember = CircleThread["subject"]["memberPreview"][number];

function PreviewAvatar({
  member,
  className,
}: {
  member: PreviewMember;
  className: string;
}) {
  return (
    <Avatar className={cn("ring-card absolute ring-2", className)}>
      {!member.anonymous && member.member.avatar && (
        <AvatarImage src={member.member.avatar} alt="" />
      )}
      <AvatarFallback className="text-[11px]">
        {member.anonymous ? (
          <UserRound className="size-[55%]" aria-hidden />
        ) : (
          <MemberInitial source={member.member} />
        )}
      </AvatarFallback>
    </Avatar>
  );
}

export function CircleThreadAvatar({
  members,
  className = "size-10",
}: {
  members: readonly PreviewMember[];
  className?: string;
}) {
  const [first, second] = members;
  if (!first) {
    return (
      <span
        aria-hidden
        className={cn(
          "bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-full",
          className,
        )}
      >
        <Users className="size-[18px]" />
      </span>
    );
  }
  return (
    <span aria-hidden className={cn("relative shrink-0", className)}>
      {second ? (
        <>
          <PreviewAvatar
            member={first}
            className="top-0 left-0 z-[1] size-[70%]"
          />
          <PreviewAvatar
            member={second}
            className="right-0 bottom-0 size-[70%]"
          />
        </>
      ) : (
        <PreviewAvatar member={first} className="inset-0 size-full ring-0" />
      )}
    </span>
  );
}
