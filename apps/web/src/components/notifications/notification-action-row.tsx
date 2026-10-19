"use client";

import { Link } from "@/compat/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { gateway, type Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { cn } from "@/lib/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import type {
  NotificationActAction,
  NotificationActionKind,
  NotificationResolvedAs,
  NotificationView,
} from "@jigswap/contracts";
import { useConvex } from "convex/react";
import { ConvexError } from "convex/values";
import { Loader2, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import {
  ACTION_META,
  actionsFor,
  type NotificationSurface,
} from "./notification-actions";
import { useActorName } from "./notification-sentence";
import { ResolvedChip } from "./resolved-chip";

const UNDO_MS = 5000;

// 44px touch targets on coarse pointers (spec 4.4).
const TOUCH = "pointer-coarse:h-11 pointer-coarse:px-4";

/** The `code` (and stale `resolvedAs`) of a notifications.act ConvexError; null for anything else. */
export function actErrorOf(
  error: unknown,
): { code: string; resolvedAs?: NotificationResolvedAs } | null {
  if (!(error instanceof ConvexError)) return null;
  let data: unknown = error.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data !== "object" || data === null || !("code" in data)) {
    return null;
  }
  const { code, resolvedAs } = data as { code: unknown; resolvedAs?: unknown };
  return {
    code: String(code),
    ...(typeof resolvedAs === "string"
      ? { resolvedAs: resolvedAs as NotificationResolvedAs }
      : {}),
  };
}

// What this row resolved to locally (after the viewer acted, or a stale race), until the reactive
// view catches up. `resolvedAs` absent on a stale result: the action is simply gone.
type LocalOutcome = { resolvedAs?: NotificationResolvedAs; focus: boolean };

/**
 * The row's inline actions and their pending / success / failure states. Confirm-then-flip: the
 * clicked button spins (keeping its width) while the others disable; on success the actions give
 * way to a ResolvedChip that takes focus. A stale action shows the server's resolved chip silently;
 * any other failure toasts and returns focus to the button.
 */
export function NotificationActions({
  view,
  surface,
}: {
  view: NotificationView;
  surface: NotificationSurface;
}) {
  const t = useTranslations("notifications.rich");
  const actorName = useActorName();
  const displayName = useMemberDisplayName();
  const convex = useConvex();
  const act = useConvexMutation(gateway.notifications.act);
  const unfollow = useConvexMutation(gateway.social.unfollow);
  const cancelFollowRequest = useConvexMutation(
    gateway.social.cancelFollowRequest,
  );

  const [pending, setPending] = useState<NotificationActionKind | null>(null);
  const [outcome, setOutcome] = useState<LocalOutcome | null>(null);
  const buttons = useRef(new Map<NotificationActionKind, HTMLElement>());
  const refocus = useRef<NotificationActionKind | null>(null);

  // Return focus to the failed button once it is enabled again.
  useEffect(() => {
    if (pending !== null || refocus.current === null) return;
    buttons.current.get(refocus.current)?.focus();
    refocus.current = null;
  }, [pending]);

  const actor = view.actors[0];
  // A privacy-hidden (living) actor gets the generic member label, not "Deleted member".
  const name =
    actor?.anonymous && !actor.departed ? displayName(null) : actorName(actor);
  const memberId =
    actor && !actor.anonymous ? (actor.memberId as Id<"users">) : null;
  const { inline, overflow } = actionsFor(view, surface);

  const resolvedAs =
    outcome !== null
      ? outcome.resolvedAs
      : view.state === "resolved"
        ? view.resolvedAs
        : undefined;

  if (outcome !== null || view.state === "resolved") {
    if (resolvedAs === undefined) {
      return outcome ? (
        <p className="text-muted-foreground text-xs">{t("unavailable")}</p>
      ) : null;
    }
    return (
      <ResolvedChip
        label={t(`${view.type}.resolved.${resolvedAs}`)}
        focusOnMount={outcome?.focus ?? false}
      />
    );
  }
  if (inline.length === 0 && overflow.length === 0) return null;

  const undoFollow = async (result: NotificationResolvedAs) => {
    if (!memberId) return;
    try {
      if (result === "requested") {
        // Withdraw the request follow back just sent (its id comes from the live relation).
        const relation = await convex.query(gateway.social.followRelation, {
          memberId,
        });
        if (relation.pendingRequest) {
          await cancelFollowRequest({
            requestId: relation.pendingRequest.requestId,
          });
        }
      } else {
        await unfollow({ followeeId: memberId });
      }
      setOutcome(null);
    } catch {
      toast.error(t("undoError"));
    }
  };

  const run = async (kind: NotificationActAction) => {
    if (pending) return;
    setPending(kind);
    try {
      const result = await act({ notificationId: view.id, action: kind });
      setOutcome({ resolvedAs: result.resolvedAs, focus: true });
      if (kind === "follow_back") {
        toast.success(
          t(
            result.resolvedAs === "requested"
              ? "requestedToast"
              : "followedToast",
            {
              actor: name,
            },
          ),
          {
            duration: UNDO_MS,
            action: {
              label: t("undo"),
              onClick: () => void undoFollow(result.resolvedAs),
            },
          },
        );
      }
    } catch (error) {
      const data = actErrorOf(error);
      if (data?.code === "NOTIFICATION_ACTION_STALE") {
        setOutcome({ resolvedAs: data.resolvedAs, focus: true });
      } else {
        refocus.current = kind;
        toast.error(
          t(`${view.type}.actions.${ACTION_META[kind].labelKey}Error`, {
            actor: name,
          }),
        );
      }
    } finally {
      setPending(null);
    }
  };

  const size = "sm" as const;
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-2">
      {inline.map((kind) => {
        const meta = ACTION_META[kind];
        const Icon = meta.icon;
        const label = t(`${view.type}.actions.${meta.labelKey}`);
        const aria = t(`${view.type}.actions.${meta.labelKey}Aria`, {
          actor: name,
        });
        if (kind === "reply_message") {
          return view.href ? (
            <Button
              key={kind}
              asChild
              variant={meta.variant}
              size={size}
              className={TOUCH}
            >
              <Link href={view.href} aria-label={aria}>
                <Icon aria-hidden="true" />
                {label}
              </Link>
            </Button>
          ) : null;
        }
        const busy = pending === kind;
        return (
          <Button
            key={kind}
            ref={(node) => {
              if (node) buttons.current.set(kind, node);
              else buttons.current.delete(kind);
            }}
            type="button"
            variant={meta.variant}
            size={size}
            className={cn("relative", TOUCH)}
            aria-label={aria}
            aria-busy={busy || undefined}
            // The busy button keeps focus (aria-disabled, guarded in run); the others disable.
            aria-disabled={busy || undefined}
            disabled={pending !== null && !busy}
            onClick={() => void run(kind)}
          >
            <span
              className={cn(
                "inline-flex items-center gap-1.5",
                busy && "invisible",
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </span>
            {busy && (
              <Loader2
                aria-hidden="true"
                className="absolute size-4 animate-spin motion-reduce:animate-none"
              />
            )}
          </Button>
        );
      })}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 pointer-coarse:size-11"
              aria-label={t("moreActions", { actor: name })}
              disabled={pending !== null}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {overflow.map((kind) => {
              const meta = ACTION_META[kind];
              const Icon = meta.icon;
              return (
                <DropdownMenuItem
                  key={kind}
                  onSelect={() => void run(kind as NotificationActAction)}
                >
                  <Icon aria-hidden="true" />
                  {t(`${view.type}.actions.${meta.labelKey}`)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
