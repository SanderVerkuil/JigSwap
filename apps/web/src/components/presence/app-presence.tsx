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
/** Heartbeat interval for every presence room (spec G0/4.4; the backend allows 5–60 s). */
export const PRESENCE_INTERVAL_MS = 30_000;
/** No pointer or key input for this long on a visible tab reads as away. */
export const IDLE_AFTER_MS = 5 * 60_000;

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel"];

/**
 * "waiting" until the tab has been visible (so a tab opened in the background never heartbeats),
 * then "active", or "idle" after `idleAfterMs` without input. The idle timer is paused while the
 * tab is hidden and showing the tab again counts as activity.
 */
export function useAppActivity(
  idleAfterMs = IDLE_AFTER_MS,
): "waiting" | "active" | "idle" {
  const [activity, setActivity] = useState<"waiting" | "active" | "idle">(
    "waiting",
  );
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const markActive = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      setActivity("active");
      timer = setTimeout(() => setActivity("idle"), idleAfterMs);
    };
    const onVisibility = () => {
      if (document.hidden) clearTimeout(timer);
      else markActive();
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
