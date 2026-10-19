// Pure display helpers for the messaging surfaces, kept free of React/Convex
// runtime imports so they unit-test in a plain node environment.

import type { gateway } from "@/gateway";
import { stripFormatting, type MemberNameSource } from "@jigswap/contracts";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";

// The web tier derives Convex view types from the gateway (not @jigswap/contracts directly).
// Every getMyInbox row: an exchange, DM or circle (group) thread.
export type AnyInboxThread = FunctionReturnType<
  typeof gateway.conversation.getMyInbox
>[number];

// A two-party (exchange or DM) thread: the subject carries the other member. The pair surfaces
// (quick links, puzzle stack, partner actions) take this.
export type InboxThread = AnyInboxThread & {
  subject: Exclude<AnyInboxThread["subject"], { kind: "circle" }>;
};

// A friend circle's group thread.
export type CircleThread = AnyInboxThread & {
  subject: Extract<AnyInboxThread["subject"], { kind: "circle" }>;
};

export const isCircleThread = (
  thread: AnyInboxThread,
): thread is CircleThread => thread.subject.kind === "circle";

// A circle's own page (/circles/$circleId): the circle thread's quick link and the circles list
// rows both link here, through this one helper.
export function circleHref(circleId: string): string {
  return `/circles/${encodeURIComponent(circleId)}`;
}

// A privacy-projected member as getMyInbox / listThreadMessages ship it.
type ProjectedMember = CircleThread["subject"]["memberPreview"][number];

// A projected member's label in the messaging surfaces: the revealed member's display name, else
// the anonymous ("Deleted member" once departed) label. Never a real identity for a hidden member.
export function projectedMemberLabel(
  member: ProjectedMember,
  t: Translator,
  displayName: (source: MemberNameSource) => string,
): string {
  return member.anonymous
    ? anonymousLabel(member, t)
    : displayName(member.member);
}

// The /members/<handle> link of a message author in a circle thread: a revealed, active member
// only (an anonymised member has no handle; the route resolves a username or an id).
export function memberProfileHref(member: ProjectedMember): string | null {
  if (member.anonymous || !member.member.isActive) return null;
  return `/members/${encodeURIComponent(member.member.username ?? member.member._id)}`;
}

type SystemEvent = NonNullable<AnyInboxThread["lastMessage"]>["systemEvent"];

// A circle thread's join/leave row: named only when the server sent the member (the viewer may
// see them), "You joined" for the viewer's own join, otherwise generic. Leaving and removal read
// the same (R.2 Q17), and who removed someone is never said.
export function systemEventText(
  event: NonNullable<SystemEvent>,
  meId: string | undefined,
  t: Translator,
  displayName: (source: MemberNameSource) => string,
): string {
  const { member } = event;
  if (!member || member.anonymous) {
    return t(
      event.kind === "joined" ? "circle.someoneJoined" : "circle.someoneLeft",
    );
  }
  if (
    event.kind === "joined" &&
    meId !== undefined &&
    member.member._id === meId
  ) {
    return t("circle.youJoined");
  }
  return t(event.kind === "joined" ? "circle.joined" : "circle.left", {
    name: displayName(member.member),
  });
}

type TradeEvent = NonNullable<AnyInboxThread["lastMessage"]>["tradeEvent"];

// An exchange thread's lifecycle row ("Exchange accepted"), in the reader's language. The server
// also sets `tradeEvent` on rows stored as English text before it existed.
export function tradeEventText(
  event: NonNullable<TradeEvent>,
  t: Translator,
): string {
  return t(`tradeEvent.${event.kind}`);
}

// A `useTranslations("messages")` translator, loosened so these helpers can be
// shared between the list rows, the thread header, and the nav badge.
export type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

// Pull the stable domain error code (e.g. "MessageTooLong", "NotConnected")
// out of a conversation mutation rejection; undefined for anything else.
export function conversationErrorCode(error: unknown): string | undefined {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: unknown } | undefined;
    if (data && typeof data.code === "string") return data.code;
  }
  return undefined;
}

// Unread badge text. The backend caps counts at 50 (both per-thread and the
// nav total), so a value of 50 genuinely means "50 or more" and reads "50+".
export function formatUnreadCount(count: number): string {
  return count >= 50 ? "50+" : String(count);
}

// The label of an anonymised member: "Deleted member" once their account is
// gone (`departed`), the app's anonymous label otherwise.
export function anonymousLabel(
  member: { anonymous: true; departed?: true },
  t: Translator,
): string {
  return member.departed ? t("deletedMember") : t("anonymous");
}

// A thread's display title: the other member for a DM (an anonymised member
// renders the app's anonymous label — never a real identity; a revealed one is
// named via `displayName`, i.e. useMemberDisplayName), "<Type>: <puzzle>"
// for an exchange thread, or the circle's name for a circle thread.
export function threadSubjectTitle(
  subject: AnyInboxThread["subject"],
  t: Translator,
  displayName: (source: MemberNameSource) => string,
): string {
  if (subject.kind === "circle") return subject.name;
  if (subject.kind === "dm") {
    return subject.otherMember.anonymous
      ? anonymousLabel(subject.otherMember, t)
      : displayName(subject.otherMember.member);
  }
  return t("exchangeThread", {
    type: t(`exchangeType.${subject.exchangeType}`),
    title: subject.puzzleTitle ?? t("untitledPuzzle"),
  });
}

// A circle thread row's snippet (spec §6.1): the newest visible message with its
// projected author ("Bas: …", "You: …"), a photo or location named by its
// sender, a join/leave row as its system text, and a blocked author's message
// as the placeholder (never its text). `removedLabel` names a moderator removal.
export function circleSnippet(
  last: AnyInboxThread["lastMessage"],
  meId: string | undefined,
  t: Translator,
  displayName: (source: MemberNameSource) => string,
  removedLabel: string,
): string {
  if (!last) return t("noMessages");
  if (last.kind === "system") {
    return last.systemEvent
      ? systemEventText(last.systemEvent, meId, t, displayName)
      : last.body;
  }
  if (last.authorBlockedByMe) return t("circle.blockedSnippet");
  // Undefined for the viewer's own message.
  const name = last.isMine
    ? undefined
    : last.author
      ? projectedMemberLabel(last.author, t, displayName)
      : t("otherMember");
  const body = last.removed
    ? removedLabel
    : stripFormatting(last.body).replace(/\s+/g, " ").trim();
  if (!last.removed && last.kind === "location") {
    return name === undefined
      ? t("locations.youSharedALocation")
      : t("locations.sharedALocation", { name });
  }
  if (!last.removed && last.kind === "image" && !body) {
    return name === undefined
      ? t("photos.youSentAPhoto")
      : t("photos.sentAPhoto", { name });
  }
  return name === undefined
    ? t("youPrefix", { body })
    : t("circle.authorPrefix", { name, body });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Local-calendar-day index (DST-safe: rounds the 23h/25h days to whole days).
function dayNumber(at: number): number {
  const date = new Date(at);
  return Math.round(
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() /
      DAY,
  );
}

// Full date + time for `title` attributes and screen-reader labels:
// "Monday, October 12, 2026 at 2:05 PM" / "maandag 12 oktober 2026 om 14:05".
export function formatFullDateTime(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeStyle: "short",
  }).format(at);
}

// Time of day under a message group: "2:05 PM" / "14:05".
export function formatMessageTime(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(at);
}

// Fixed-width-ish inbox row timestamp (≤ ~11 chars) so every row's name and
// snippet truncate at the same x: now / 5m / 2h / Mon / Oct 12 / Oct 12, 2025.
export function formatCompactTime(
  at: number,
  now: number,
  locale: string,
  t: Translator,
): string {
  const age = Math.max(0, now - at);
  if (age < MINUTE) return t("time.now");
  if (age < HOUR) return t("time.minutes", { count: Math.floor(age / MINUTE) });
  if (age < DAY) return t("time.hours", { count: Math.floor(age / HOUR) });
  if (age < 7 * DAY) {
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(at);
  }
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(at);
}

// Day-separator label in a thread: Today / Yesterday / Monday (< 7 days) /
// Mon, Oct 12 (this year) / Oct 12, 2025 (older).
export function formatDayLabel(
  at: number,
  now: number,
  locale: string,
  t: Translator,
): string {
  const daysAgo = dayNumber(now) - dayNumber(at);
  if (daysAgo <= 0) return t("dayToday");
  if (daysAgo === 1) return t("dayYesterday");
  if (daysAgo < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: "long" }).format(at);
  }
  if (new Date(at).getFullYear() === new Date(now).getFullYear()) {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(at);
  }
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(at);
}

// The fields grouping needs; ThreadMessageView satisfies it. `author` is set in
// circle threads only, where others' messages come from several members.
type GroupableMessage = {
  readonly id: string;
  readonly isMine: boolean;
  readonly kind: string;
  readonly sentAt: number;
  readonly author?:
    | { readonly anonymous: false; readonly member: { readonly _id: string } }
    | { readonly anonymous: true; readonly anonRef: string };
};

// Who wrote a message, as far as grouping can tell: the projected author in a
// circle thread (an anonymised one by its per-thread ref), else just the side.
function authorKey(message: GroupableMessage): string {
  const { author } = message;
  if (!author) return message.isMine ? "mine" : "theirs";
  return author.anonymous ? `anon:${author.anonRef}` : author.member._id;
}

export type ThreadItem<M extends GroupableMessage> =
  | { type: "day"; key: string; label: string }
  | { type: "system"; key: string; message: M }
  | { type: "group"; key: string; own: boolean; messages: M[] };

// Consecutive messages within this gap (same author, same day) share a group.
const GROUP_GAP = 5 * MINUTE;

// Lay out an ascending message list as day separators, standalone system
// messages, and author groups: consecutive non-system messages by the same
// author on the same local day, each ≤ 5 minutes after the previous one. In a
// DM "the same author" is the same side; in a circle thread, the same member.
export function groupThreadMessages<M extends GroupableMessage>(
  messages: readonly M[],
  now: number,
  locale: string,
  t: Translator,
): ThreadItem<M>[] {
  const items: ThreadItem<M>[] = [];
  let currentDay: number | undefined;
  let group: Extract<ThreadItem<M>, { type: "group" }> | undefined;

  for (const message of messages) {
    const day = dayNumber(message.sentAt);
    if (day !== currentDay) {
      currentDay = day;
      group = undefined;
      items.push({
        type: "day",
        key: `day-${message.id}`,
        label: formatDayLabel(message.sentAt, now, locale, t),
      });
    }
    if (message.kind === "system") {
      group = undefined;
      items.push({ type: "system", key: message.id, message });
      continue;
    }
    const previous = group?.messages.at(-1);
    if (
      group &&
      previous &&
      previous.isMine === message.isMine &&
      authorKey(previous) === authorKey(message) &&
      message.sentAt - previous.sentAt <= GROUP_GAP
    ) {
      group.messages.push(message);
      continue;
    }
    group = {
      type: "group",
      key: `group-${message.id}`,
      own: message.isMine,
      messages: [message],
    };
    items.push(group);
  }
  return items;
}

// Photos sent within this gap of each other (same author) share a gallery.
const PHOTO_RUN_GAP = MINUTE;
// A gallery is a 2x2 grid at most.
const PHOTO_RUN_MAX = 4;

export type MessageSegment<M extends GroupableMessage> =
  { type: "message"; message: M } | { type: "photos"; messages: M[] };

// Split one author group into the segments it renders as: each photo message
// joins the preceding photo when it follows within a minute (galleries of up
// to 4); every other message stands alone.
export function segmentMessages<M extends GroupableMessage>(
  messages: readonly M[],
): MessageSegment<M>[] {
  const segments: MessageSegment<M>[] = [];
  let run: Extract<MessageSegment<M>, { type: "photos" }> | undefined;
  for (const message of messages) {
    if (message.kind !== "image") {
      run = undefined;
      segments.push({ type: "message", message });
      continue;
    }
    const previous = run?.messages.at(-1);
    if (
      run &&
      previous &&
      run.messages.length < PHOTO_RUN_MAX &&
      previous.isMine === message.isMine &&
      message.sentAt - previous.sentAt <= PHOTO_RUN_GAP
    ) {
      run.messages.push(message);
      continue;
    }
    run = { type: "photos", messages: [message] };
    segments.push(run);
  }
  return segments;
}

export type InboxContextCopy = InboxThread["contextCopies"][number];

export type ThreadQuickLink = {
  kind: "profile" | "exchange";
  href: string;
};

// Header quick links for a thread, in display order; each appears only when the
// server says the target is reachable: the DM or trading partner's profile
// (profileHandle non-null — not anonymised or inactive), then the exchange on
// /trades. The puzzles live in the header's cover stack, not here.
export function threadQuickLinks(thread: InboxThread): ThreadQuickLink[] {
  const links: ThreadQuickLink[] = [];
  const { subject } = thread;
  if (subject.profileHandle !== null) {
    links.push({
      kind: "profile",
      href: `/members/${encodeURIComponent(subject.profileHandle)}`,
    });
  }
  if (subject.kind === "exchange") {
    links.push({
      kind: "exchange",
      href: `/trades?exchange=${encodeURIComponent(subject.exchangeId)}`,
    });
  }
  return links;
}

export function contextCopyHref(copy: InboxContextCopy): string {
  return `/copies/${encodeURIComponent(copy.copyId)}`;
}

// Screen-reader summary of a thread's puzzles: "About 5 puzzles: A, B, C and
// 2 more" — the first `shown` titles named, the rest counted (an inbox row,
// which shows one cover, names one: "About 5 puzzles: A and 4 more").
export function coverStackSummary(
  titles: readonly string[],
  locale: string,
  t: Translator,
  shown = 3,
): string {
  const named = titles.slice(0, shown);
  const rest = titles.length - named.length;
  const items = rest > 0 ? [...named, t("moreCount", { count: rest })] : named;
  const list = new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(items);
  return t("coverStackSummary", { count: titles.length, list });
}

// Whose copy a context copy is, for the header puzzle menu and the cover
// tooltips: "Your copy", "<Name>'s copy", or a generic label when the other
// member is anonymised (never a real identity).
export function copyOwnerHint(
  owner: InboxContextCopy["owner"],
  otherMember: InboxThread["subject"]["otherMember"],
  t: Translator,
  displayName: (source: MemberNameSource) => string,
): string {
  if (owner === "viewer") return t("copyOwnerYou");
  if (otherMember.anonymous) return t("copyOwnerOther");
  return t("copyOwnerNamed", { name: displayName(otherMember.member) });
}
