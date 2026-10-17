import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useMemberDisplayName } from "@/lib/member-display-name";
import type { ReactNode } from "react";

export interface Person {
  memberId: string;
  // Absent when the member has no identifiable name: render via useMemberDisplayName.
  name?: string;
  avatar?: string;
}

export function PersonRow({
  person,
  children,
  badge,
}: {
  person: Person;
  children?: ReactNode;
  badge?: ReactNode;
}) {
  const displayName = useMemberDisplayName();
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="h-9 w-9">
          <AvatarImage src={person.avatar} />
          <AvatarFallback>
            <MemberInitial source={person} />
          </AvatarFallback>
        </Avatar>
        <span className="truncate text-sm font-medium">
          {displayName(person)}
        </span>
        {badge}
      </div>
      {children && (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      )}
    </div>
  );
}
