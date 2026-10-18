"use client";

// The client half of the typing indicator (spec 4.3). Feed it the composer's
// value on every change: a non-empty value calls conversation.setTyping at
// most once per TYPING_SEND_INTERVAL_MS (leading edge), and only while the tab
// is visible. The server row lives 6 s, so once keystrokes stop the indicator
// lapses on its own; there is no idle clearTyping (it would save nothing and
// cost a call). clearTyping goes out only when the indicator is still live and
// the member clearly stopped: the input was emptied, the tab was hidden, or
// the thread view went away. A send clears the row on the server, so `onSent`
// only resets the local throttle. Failures are ignored: typing is best-effort.
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useCallback, useEffect, useRef } from "react";

/** The least time between two setTyping calls for one thread. */
export const TYPING_SEND_INTERVAL_MS = 4_000;

// How long the server treats a typing row as live (conversation/typingIndicators).
const TYPING_TTL_MS = 6_000;

export function useTypingIndicator(threadId: string): {
  onInput: (value: string) => void;
  onSent: () => void;
} {
  const setTyping = useConvexMutation(gateway.conversation.setTyping);
  const clearTyping = useConvexMutation(gateway.conversation.clearTyping);
  // Latest mutation functions, so the effect below depends on the thread only.
  const mutations = useRef({ setTyping, clearTyping });
  useEffect(() => {
    mutations.current = { setTyping, clearTyping };
  }, [setTyping, clearTyping]);
  // When setTyping last went out for the current thread; null = not typing.
  const lastSentAt = useRef<number | null>(null);

  const stop = useCallback((id: string) => {
    const last = lastSentAt.current;
    lastSentAt.current = null;
    if (last !== null && Date.now() - last < TYPING_TTL_MS) {
      void mutations.current.clearTyping({ threadId: id }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") stop(threadId);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop(threadId);
    };
  }, [threadId, stop]);

  const onInput = useCallback(
    (value: string) => {
      if (value.trim() === "") {
        stop(threadId);
        return;
      }
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      const last = lastSentAt.current;
      if (last !== null && now - last < TYPING_SEND_INTERVAL_MS) return;
      lastSentAt.current = now;
      void mutations.current.setTyping({ threadId }).catch(() => {});
    },
    [threadId, stop],
  );

  const onSent = useCallback(() => {
    lastSentAt.current = null;
  }, []);

  return { onInput, onSent };
}
