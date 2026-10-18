import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { gateway } from "@/gateway";
import {
  useMemberDisplayName,
  useProjectedMemberName,
} from "@/lib/member-display-name";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { useTranslations } from "use-intl";

type CopyInstanceView = NonNullable<
  FunctionReturnType<typeof gateway.library.getCopyInstanceView>
>;

// The copy's owner: avatar + display name. The server projects `owner` per the viewer's
// connection; only a revealed owner links to their profile (handle = username, else id; the
// profile route redirects to the canonical slug). An anonymised owner who is the viewer's
// housemate is still named from the household view, as the library's household badge does, but
// without a link. The viewer's own copy gets the page's existing "· you" marker.
export function CopyOwner({
  owner,
  householdOwner,
  viewerIsOwner,
}: {
  owner: CopyInstanceView["owner"];
  householdOwner?: NonNullable<CopyInstanceView["household"]>["owner"];
  viewerIsOwner: boolean;
}) {
  const t = useTranslations("copyOwner");
  const displayName = useMemberDisplayName();
  const projectedName = useProjectedMemberName();

  const revealed = owner.anonymous ? null : owner.member;
  const source =
    revealed ?? (householdOwner ? { name: householdOwner.name } : null);
  const avatar = revealed?.avatar ?? householdOwner?.avatar;
  const name = source
    ? displayName(source)
    : projectedName(owner, t("anonymous"));

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Avatar className="size-6 shrink-0" aria-hidden="true">
        {avatar && <AvatarImage src={avatar} alt="" />}
        <AvatarFallback className="text-[10px] font-semibold">
          <MemberInitial source={source} />
        </AvatarFallback>
      </Avatar>
      {revealed ? (
        <Link
          to="/members/$handle"
          params={{ handle: revealed.username ?? revealed._id }}
          className="truncate hover:underline"
        >
          {name}
        </Link>
      ) : (
        <span className="truncate">{name}</span>
      )}
      {viewerIsOwner && (
        <span className="text-muted-foreground shrink-0 font-medium">
          · {t("you")}
        </span>
      )}
    </span>
  );
}
