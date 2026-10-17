import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type {
  NotificationActorView,
  NotificationViewType,
} from "@jigswap/contracts";
import { UserRound } from "lucide-react";
import { createElement } from "react";
import type { NotificationSurface } from "./notification-actions";
import { notificationAccent, notificationIcon } from "./notification-meta";

function ActorAvatar({
  actor,
  className,
}: {
  actor: NotificationActorView;
  className?: string;
}) {
  return (
    <Avatar className={className}>
      {!actor.anonymous && actor.avatar && (
        <AvatarImage src={actor.avatar} alt="" />
      )}
      <AvatarFallback className="text-xs font-semibold">
        {actor.anonymous ? (
          <UserRound className="size-[55%]" aria-hidden="true" />
        ) : (
          <MemberInitial source={{ name: actor.name }} />
        )}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * The row's leading visual (decorative: the sentence names the actor). One actor: their avatar with
 * the type's icon as a corner badge. Several: stacked avatars (3 in the popover, 4 on the page) plus
 * a "+k" chip. No actor: the type icon on its own.
 */
export function NotificationActor({
  actors,
  actorCount,
  type,
  surface,
}: {
  actors: NotificationActorView[];
  actorCount: number;
  type: NotificationViewType;
  surface: NotificationSurface;
}) {
  const icon = notificationIcon(type);
  const accent = notificationAccent(type);
  // The ring matches the surface behind it so overlapping avatars read as separate.
  const ring = surface === "popover" ? "ring-popover" : "ring-background";

  if (actors.length === 0) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "bg-muted flex size-9 shrink-0 items-center justify-center rounded-full",
          accent,
        )}
      >
        {createElement(icon, { className: "size-4" })}
      </span>
    );
  }

  if (actors.length === 1 || actorCount <= 1) {
    return (
      <span aria-hidden="true" className="relative size-9 shrink-0">
        <ActorAvatar actor={actors[0]} className="size-9" />
        <span
          className={cn(
            "bg-background absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full ring-2",
            surface === "popover" && "bg-popover",
            ring,
            accent,
          )}
        >
          {createElement(icon, { className: "size-3" })}
        </span>
      </span>
    );
  }

  const max = surface === "popover" ? 3 : 4;
  const shown = actors.slice(0, max);
  const rest = actorCount - shown.length;
  return (
    <span aria-hidden="true" className="flex shrink-0 -space-x-2">
      {shown.map((actor, index) => (
        <ActorAvatar
          key={actor.anonymous ? `anon-${index}` : actor.memberId}
          actor={actor}
          className={cn("size-7 ring-2", ring)}
        />
      ))}
      {rest > 0 && (
        <span
          className={cn(
            "bg-muted text-muted-foreground flex size-7 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums ring-2",
            ring,
          )}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
