// Pure display helpers for the messaging surfaces, kept free of React/Convex
// runtime imports so they unit-test in a plain node environment.

import type { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";

// The web tier derives Convex view types from the gateway (not @jigswap/contracts directly).
export type InboxThread = FunctionReturnType<
  typeof gateway.conversation.getMyInbox
>[number];

// A `useTranslations("messages")` translator, loosened so these helpers can be
// shared between the list rows, the thread header, and the nav badge.
export type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

// Unread badge text. The backend caps counts at 50 (both per-thread and the
// nav total), so a value of 50 genuinely means "50 or more" and reads "50+".
export function formatUnreadCount(count: number): string {
  return count >= 50 ? "50+" : String(count);
}

// A thread's display title: the other member for a DM (an anonymised member
// renders the app's anonymous label — never a real identity), or
// "<Type>: <puzzle>" for an exchange thread.
export function threadSubjectTitle(
  subject: InboxThread["subject"],
  t: Translator,
): string {
  if (subject.kind === "dm") {
    return subject.otherMember.anonymous
      ? t("anonymous")
      : subject.otherMember.member.name;
  }
  return t("exchangeThread", {
    type: t(`exchangeType.${subject.exchangeType}`),
    title: subject.puzzleTitle ?? t("untitledPuzzle"),
  });
}
