"use client";

// A circle thread's avatar (circle-chat identity spec §2): the most recent
// other member's avatar top-left with the circle mark (a violet Users disc)
// bottom-right, inside the same square a DM avatar takes, or a full-size
// circle mark when there is nobody to show. It never shows a lone person, so
// a circle can't pass for a DM. Decorative: the circle's name always sits
// beside it. Static on purpose: it lives inside the row's link, so
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
  const [first] = members;
  if (!first) {
    return (
      <span
        aria-hidden
        className={cn(
          "bg-accent text-primary-text flex shrink-0 items-center justify-center rounded-full",
          className,
        )}
      >
        <Users className="size-[45%]" />
      </span>
    );
  }
  // The circle mark sits in front so it is never clipped: it is what tells a
  // group from a person.
  return (
    <span aria-hidden className={cn("relative shrink-0", className)}>
      <PreviewAvatar member={first} className="top-0 left-0 size-[70%]" />
      <span className="bg-accent text-primary-text ring-card absolute right-0 bottom-0 z-[1] flex size-[70%] items-center justify-center rounded-full ring-2">
        <Users className="size-[55%]" />
      </span>
    </span>
  );
}
