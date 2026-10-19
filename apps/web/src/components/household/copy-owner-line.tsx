import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useMemberDisplayName } from "@/lib/member-display-name";
import type { HouseholdPersonView } from "@jigswap/contracts";
import { Eye } from "lucide-react";
import { useTranslations } from "use-intl";

// Whose copy a puzzle card shows, as the first line of the card (PuzzleCard's `owner` slot): the
// owner's avatar and name, or "You" for the viewer's own copy. A housemate's copy the owner left
// at "view" says "View only"; manage is the default and needs no marker.
export function CopyOwnerLine({
  owner,
  isYou = false,
  viewOnly = false,
}: {
  owner: HouseholdPersonView;
  isYou?: boolean;
  viewOnly?: boolean;
}) {
  const t = useTranslations("household.puzzles");
  const displayName = useMemberDisplayName();
  return (
    <p className="mb-2 flex min-w-0 items-center gap-1.5 text-xs">
      <Avatar className="size-5 shrink-0">
        <AvatarImage src={owner.avatar} alt="" />
        <AvatarFallback className="text-[10px]">
          <MemberInitial source={owner} />
        </AvatarFallback>
      </Avatar>
      <span className="sr-only">{t("ownedBy")}</span>
      <span
        className={
          isYou
            ? "text-muted-foreground truncate font-medium"
            : "text-foreground truncate font-medium"
        }
      >
        {isYou ? t("you") : displayName(owner)}
      </span>
      {viewOnly && (
        <span className="text-muted-foreground ml-auto inline-flex shrink-0 items-center gap-1">
          <Eye className="size-3" aria-hidden />
          {t("viewOnly")}
        </span>
      )}
    </p>
  );
}
