"use client";

// The viewer's own seat in a circle as a badge: "Owner" for the circle's
// owner, otherwise their permission level (View only, Can exchange, Admin), so
// every member can see what they may do there. A tooltip says what that seat
// allows.
//
// Inside a link (a circle row on /circles) the badge stays plain text and the
// tooltip shows on hover only: nothing interactive may nest in a link, and the
// link's page shows the badge again. With `interactive` (the circle's own
// page) the badge is a button, so keyboard focus and a tap open the tooltip
// too.
import { type CirclePermissionLevel } from "@/components/circles/circle-seat";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useTranslations } from "use-intl";

export function CircleRoleBadge({
  isOwner,
  permission,
  interactive = false,
  className,
}: {
  isOwner: boolean;
  permission: CirclePermissionLevel;
  interactive?: boolean;
  className?: string;
}) {
  const t = useTranslations("circles");
  const [open, setOpen] = useState(false);
  const role = isOwner ? "Owner" : permission;
  const label = isOwner ? t("roleOwner") : t(`permissions.${permission}`);

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        {interactive ? (
          <Badge
            asChild
            variant="secondary"
            className={cn("h-6 cursor-help outline-none", className)}
          >
            <button
              type="button"
              // Touch has no hover: a tap opens the tooltip (Radix would
              // close it again on click). A tap elsewhere or Escape closes it.
              onClick={(event) => {
                event.preventDefault();
                setOpen(true);
              }}
            >
              {label}
            </button>
          </Badge>
        ) : (
          <Badge variant="secondary" className={cn("shrink-0", className)}>
            {label}
          </Badge>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {t(`roleHints.${role}`)}
      </TooltipContent>
    </Tooltip>
  );
}
