import type { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

type ActivityEntry = FunctionReturnType<
  typeof gateway.social.activityFeed
>[number];
type ActivityTarget = NonNullable<ActivityEntry["target"]>;

// Both links come from the server (getActivityFeed decides them after the target page's own gate);
// the client only maps a target kind to its route and never builds an id itself.

const FOCUS_RING = "outline-none focus-visible:ring-2 focus-visible:ring-ring";

// The actor's name (or avatar) linking to their profile. It sits above the row's target link
// (relative z-10); the vertical padding grows the touch target without moving the text.
export function ActorLink({
  actor,
  className,
  children,
  ...rest
}: {
  actor: NonNullable<ActivityEntry["actor"]>;
  className?: string;
  children: ReactNode;
  "aria-hidden"?: boolean;
  tabIndex?: number;
}) {
  return (
    <Link
      to="/members/$handle"
      params={{ handle: actor.handle }}
      className={cn(
        "relative z-10 rounded-sm hover:underline",
        FOCUS_RING,
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}

// The entry's primary link, stretched over the whole row (the row must be `relative`) so the row
// is one large touch target while the actor link stays a sibling, never nested inside it.
export function ActivityTargetLink({
  target,
  count,
}: {
  target: ActivityTarget;
  count: number;
}) {
  const t = useTranslations("activity");
  const className = cn("absolute inset-0 rounded-md", FOCUS_RING);
  switch (target.kind) {
    case "myCopy":
      return (
        <Link
          to="/my-puzzles/$id"
          params={{ id: target.id }}
          aria-label={t("open.puzzle")}
          className={className}
        />
      );
    case "copy":
      return (
        <Link
          to="/copies/$id"
          params={{ id: target.id }}
          aria-label={t("open.puzzle")}
          className={className}
        />
      );
    case "definition":
      return (
        <Link
          to="/puzzles/$id"
          params={{ id: target.id }}
          aria-label={t("open.puzzle")}
          className={className}
        />
      );
    case "memberPuzzles":
      return (
        <Link
          to="/members/$handle"
          params={{ handle: target.handle }}
          hash="puzzles"
          aria-label={t("acquisitionBatch.covers", { count })}
          className={className}
        />
      );
    case "trades":
      return (
        <Link
          to="/trades"
          aria-label={t("open.trades")}
          className={className}
        />
      );
    default:
      // Deploy-order safety: a newer server may send a kind this bundle doesn't know.
      return null;
  }
}
