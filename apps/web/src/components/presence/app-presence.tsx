"use client";

// Dashboard-shell presence (spec 4.2): heartbeats "app:online" while the tab is visible and in
// use, and "app:away" after 5 minutes on a visible tab with no pointer or key input. Exactly one
// of the two is mounted at a time; switching unmounts one stock usePresence hook (which
// disconnects it) and mounts the other. A hidden tab is the stock hook's business: it stops
// heartbeating and disconnects, and reconnects when the tab shows again. Nothing heartbeats for
// a member who doesn't share or appears offline: nobody could see them, so it would only cost.
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { gateway } from "@/gateway";
import usePresence from "@convex-dev/presence/react";
import { useEffect, useState } from "react";
import { usePresenceSettings } from "./use-presence";

export const APP_ONLINE_ROOM = "app:online";
export const APP_AWAY_ROOM = "app:away";
/**
 * Heartbeat interval for the app:online / app:away rooms: the backend's 60 s maximum (it allows
 * 5–60 s), the cost lever from spec 4.4, where these heartbeats are the largest stream of
 * function calls. Joining, switching rooms, hiding the tab and unloading all disconnect or
 * heartbeat at once, so the interval only bounds how long a crashed tab stays listed (2.5
 * intervals = 150 s). The /messages room keeps its own 30 s interval (messages/route.tsx)
 * because it gates notification suppression.
 */
export const PRESENCE_INTERVAL_MS = 60_000;
/** No pointer or key input for this long on a visible tab reads as away. */
export const IDLE_AFTER_MS = 5 * 60_000;

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel"];

/**
 * "waiting" until the tab has been visible (so a tab opened in the background never heartbeats),
 * then "active", or "idle" after `idleAfterMs` without input. The idle timer is paused while the
 * tab is hidden and showing the tab again counts as activity.
 *
 * Input events (pointermove fires at frame rate) only record a timestamp and set state only when
 * it changes; the one idle timer re-arms itself for whatever is left of the window since the
 * latest input.
 */
export function useAppActivity(
  idleAfterMs = IDLE_AFTER_MS,
): "waiting" | "active" | "idle" {
  const [activity, setActivity] = useState<"waiting" | "active" | "idle">(
    "waiting",
  );
  useEffect(() => {
    let current: "waiting" | "active" | "idle" = "waiting";
    let lastInput = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const set = (next: "active" | "idle") => {
      if (next === current) return;
      current = next;
      setActivity(next);
    };
    const onIdleTimer = () => {
      const remaining = lastInput + idleAfterMs - Date.now();
      if (remaining > 0) {
        timer = setTimeout(onIdleTimer, remaining);
      } else {
        timer = undefined;
        set("idle");
      }
    };
    const markActive = () => {
      if (document.hidden) return;
      lastInput = Date.now();
      set("active");
      timer ??= setTimeout(onIdleTimer, idleAfterMs);
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        timer = undefined;
      } else markActive();
    };
    markActive();
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, markActive, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, markActive);
      }
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [idleAfterMs]);
  return activity;
}

export function AppPresence() {
  const { member } = useCurrentMember();
  const settings = usePresenceSettings();
  if (!member || settings?.share !== true || settings.override === "invisible")
    return null;
  return <AppPresenceRooms memberId={member._id} />;
}

function AppPresenceRooms({ memberId }: { memberId: string }) {
  const activity = useAppActivity();
  if (activity === "waiting") return null;
  return activity === "idle" ? (
    <PresenceRoom
      key={APP_AWAY_ROOM}
      room={APP_AWAY_ROOM}
      memberId={memberId}
    />
  ) : (
    <PresenceRoom
      key={APP_ONLINE_ROOM}
      room={APP_ONLINE_ROOM}
      memberId={memberId}
    />
  );
}

// One stock hook per mounted room (hooks can't be conditional; mounting can).
function PresenceRoom({ room, memberId }: { room: string; memberId: string }) {
  usePresence(gateway.presence, room, memberId, PRESENCE_INTERVAL_MS);
  return null;
}
