"use client";

// The client half of the typing indicator (spec 4.3). Feed it the composer's
// value on every change: a non-empty value calls conversation.setTyping at
// most once per TYPING_SEND_INTERVAL_MS (leading edge), and only while the tab
// is visible. The server row lives 6 s, so once keystrokes stop the indicator
// lapses on its own; there is no idle clearTyping (it would save nothing and
// cost a call). clearTyping goes out only when the indicator is still live and
// the member clearly stopped: the input was emptied, the tab was hidden, or
// the thread view went away. A stop does NOT reset the 4 s leading edge, so
// emptying and retyping can't send faster than one setTyping per 4 s. A send
// clears the row on the server, so `onSent` only resets the local state (sends
// are rate-limited on their own). Failures are ignored: typing is best-effort.
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { TYPING_TTL_MS } from "@jigswap/contracts";
import { useCallback, useEffect, useRef } from "react";

/** The least time between two setTyping calls for one thread. */
export const TYPING_SEND_INTERVAL_MS = 4_000;

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
  // When setTyping last went out for the current thread (the leading edge's
  // clock); null = not since the thread opened or the last send.
  const lastSentAt = useRef<number | null>(null);
  // Whether that signal is still on (no stop or send since).
  const signalling = useRef(false);

  const stop = useCallback((id: string) => {
    const last = lastSentAt.current;
    const wasSignalling = signalling.current;
    signalling.current = false;
    if (wasSignalling && last !== null && Date.now() - last < TYPING_TTL_MS) {
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
      // The next thread starts afresh.
      lastSentAt.current = null;
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
      signalling.current = true;
      void mutations.current.setTyping({ threadId }).catch(() => {});
    },
    [threadId, stop],
  );

  const onSent = useCallback(() => {
    lastSentAt.current = null;
    signalling.current = false;
  }, []);

  return { onInput, onSent };
}
