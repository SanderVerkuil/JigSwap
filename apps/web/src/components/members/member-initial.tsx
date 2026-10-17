import { memberInitialOf } from "@/lib/member-display-name";
import type { MemberNameSource } from "@jigswap/contracts";
import { UserRound } from "lucide-react";

// Avatar-fallback content for a member: the initial of their resolved display name, or a generic
// person icon when they have no identifiable name (never fabricated letters like "N" for a legacy
// "null null"). Render inside <AvatarFallback>.
export function MemberInitial({
  source,
}: {
  source: MemberNameSource | null | undefined;
}) {
  const initial = memberInitialOf(source);
  return initial ?? <UserRound className="size-[55%]" aria-hidden="true" />;
}
