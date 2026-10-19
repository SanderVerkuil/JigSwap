import { ConvexError } from "convex/values";
import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import enMessages from "../../../locales/en.json";
import nlMessages from "../../../locales/nl.json";
import sourceMessages from "../../../locales/source.json";
import type { AnyInboxThread, InboxThread, Translator } from "./format";
import {
  contextCopyHref,
  conversationErrorCode,
  copyOwnerHint,
  coverStackSummary,
  formatCompactTime,
  formatDayLabel,
  formatFullDateTime,
  formatUnreadCount,
  groupThreadMessages,
  threadQuickLinks,
  threadSubjectTitle,
  tradeEventText,
} from "./format";

// Deterministic translator stub: bare key when no values, key + values when
// interpolating — enough to assert both the key chosen and what was passed.
const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}:${Object.values(values).join("|")}` : key;
// Stand-in for useMemberDisplayName: the name, or a marker for the generic label.
const displayName = (source: { name?: string | null }) =>
  source.name ?? "generic";

describe("conversationErrorCode", () => {
  it("extracts the code from a ConvexError carrying one", () => {
    expect(
      conversationErrorCode(new ConvexError({ code: "MessageTooLong" })),
    ).toBe("MessageTooLong");
  });

  it("yields nothing for a non-ConvexError rejection", () => {
    expect(conversationErrorCode(new Error("boom"))).toBeUndefined();
  });
});

describe("formatUnreadCount", () => {
  it("renders counts below the cap verbatim", () => {
    expect(formatUnreadCount(1)).toBe("1");
    expect(formatUnreadCount(49)).toBe("49");
  });

  it('renders the capped value 50 as "50+" (50 means "50 or more")', () => {
    expect(formatUnreadCount(50)).toBe("50+");
  });

  it('renders anything above the cap as "50+" too', () => {
    expect(formatUnreadCount(120)).toBe("50+");
  });
});

describe("threadSubjectTitle", () => {
  it("uses the revealed member's name for a DM", () => {
    const subject = {
      kind: "dm",
      otherMember: { anonymous: false, member: { name: "Alice Johnson" } },
    } as InboxThread["subject"];
    expect(threadSubjectTitle(subject, t, displayName)).toBe("Alice Johnson");
  });

  it("delegates a nameless revealed member to the display-name resolver", () => {
    const subject = {
      kind: "dm",
      otherMember: { anonymous: false, member: {} },
    } as InboxThread["subject"];
    expect(threadSubjectTitle(subject, t, displayName)).toBe("generic");
  });

  it("uses the anonymous label for an anonymised DM partner — never an id", () => {
    const subject = {
      kind: "dm",
      otherMember: { anonymous: true, anonRef: "anon-123" },
    } as InboxThread["subject"];
    expect(threadSubjectTitle(subject, t, displayName)).toBe("anonymous");
  });

  it("names a DM partner who deleted their account 'Deleted member'", () => {
    const subject = {
      kind: "dm",
      otherMember: { anonymous: true, anonRef: "anon-123", departed: true },
    } as InboxThread["subject"];
    expect(threadSubjectTitle(subject, t, displayName)).toBe("deletedMember");
  });

  it("titles an exchange thread with its type and puzzle title", () => {
    const subject = {
      kind: "exchange",
      exchangeId: "ex-1",
      exchangeType: "trade",
      puzzleTitle: "Neuschwanstein Castle",
    } as InboxThread["subject"];
    expect(threadSubjectTitle(subject, t, displayName)).toBe(
      "exchangeThread:exchangeType.trade|Neuschwanstein Castle",
    );
  });

  it("falls back to the untitled label when the puzzle title is unresolved", () => {
    const subject = {
      kind: "exchange",
      exchangeId: "ex-1",
      exchangeType: "loan",
      puzzleTitle: null,
    } as InboxThread["subject"];
    expect(threadSubjectTitle(subject, t, displayName)).toBe(
      "exchangeThread:exchangeType.loan|untitledPuzzle",
    );
  });
});

// Real ICU-backed translator for the time/day keys, per locale, mirroring the
// en/nl message catalogues (§10 of the message-center spec).
const catalogue: Record<string, Record<string, string>> = {
  en: {
    "time.now": "now",
    "time.minutes": "{count}m",
    "time.hours": "{count}h",
    dayToday: "Today",
    dayYesterday: "Yesterday",
  },
  nl: {
    "time.now": "nu",
    "time.minutes": "{count} min",
    "time.hours": "{count} u",
    dayToday: "Vandaag",
    dayYesterday: "Gisteren",
  },
};
const tFor =
  (locale: string) => (key: string, values?: Record<string, string | number>) =>
    catalogue[locale][key].replace(/\{(\w+)\}/g, (_, name: string) =>
      String(values?.[name]),
    );
// ICU separates time and day period with a narrow no-break space; compare on plain spaces.
const plain = (value: string) => value.replace(/\s/g, " ");

// Local-time fixtures so the assertions hold in any test-runner time zone.
// "now" is Monday 19 Oct 2026, 15:00.
const NOW = new Date(2026, 9, 19, 15, 0).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("formatCompactTime", () => {
  it.each([
    ["en", NOW - 30_000, "now"],
    ["nl", NOW - 30_000, "nu"],
    ["en", NOW - 5 * MIN, "5m"],
    ["nl", NOW - 5 * MIN, "5 min"],
    ["en", NOW - 2 * HOUR, "2h"],
    ["nl", NOW - 2 * HOUR, "2 u"],
    // Thu 15 Oct (4 days back) → weekday
    ["en", new Date(2026, 9, 15, 9, 0).getTime(), "Thu"],
    ["nl", new Date(2026, 9, 15, 9, 0).getTime(), "do"],
    // Same year, ≥ 7 days → day + month
    ["en", new Date(2026, 9, 12, 14, 5).getTime(), "Oct 12"],
    ["nl", new Date(2026, 9, 12, 14, 5).getTime(), "12 okt"],
    // Previous year → with year
    ["en", new Date(2025, 9, 12, 14, 5).getTime(), "Oct 12, 2025"],
    ["nl", new Date(2025, 9, 12, 14, 5).getTime(), "12 okt 2025"],
  ])("%s: renders %i compactly as %s", (locale, at, expected) => {
    expect(formatCompactTime(at, NOW, locale, tFor(locale))).toBe(expected);
  });

  it("treats a slightly-future timestamp (clock skew) as now", () => {
    expect(formatCompactTime(NOW + 5_000, NOW, "en", tFor("en"))).toBe("now");
  });

  it("switches from minutes to hours at 60 minutes", () => {
    expect(formatCompactTime(NOW - 59 * MIN, NOW, "en", tFor("en"))).toBe(
      "59m",
    );
    expect(formatCompactTime(NOW - 60 * MIN, NOW, "en", tFor("en"))).toBe("1h");
  });
});

describe("formatFullDateTime", () => {
  it.each([
    ["en", "Monday, October 12, 2026 at 2:05 PM"],
    ["nl", "maandag 12 oktober 2026 om 14:05"],
  ])("%s: renders the full date and time", (locale, expected) => {
    const at = new Date(2026, 9, 12, 14, 5).getTime();
    expect(plain(formatFullDateTime(at, locale))).toBe(expected);
  });
});

describe("formatDayLabel", () => {
  it.each([
    ["en", new Date(2026, 9, 19, 0, 5).getTime(), "Today"],
    ["nl", new Date(2026, 9, 19, 0, 5).getTime(), "Vandaag"],
    ["en", new Date(2026, 9, 18, 23, 55).getTime(), "Yesterday"],
    ["nl", new Date(2026, 9, 18, 23, 55).getTime(), "Gisteren"],
    // 6 calendar days back → long weekday
    ["en", new Date(2026, 9, 13, 10, 0).getTime(), "Tuesday"],
    ["nl", new Date(2026, 9, 13, 10, 0).getTime(), "dinsdag"],
    // 7 calendar days back, this year → short weekday + date
    ["en", new Date(2026, 9, 12, 10, 0).getTime(), "Mon, Oct 12"],
    ["nl", new Date(2026, 9, 12, 10, 0).getTime(), "ma 12 okt"],
    // Older year → date with year
    ["en", new Date(2025, 9, 12, 10, 0).getTime(), "Oct 12, 2025"],
    ["nl", new Date(2025, 9, 12, 10, 0).getTime(), "12 okt 2025"],
  ])("%s: labels %i as %s", (locale, at, expected) => {
    expect(formatDayLabel(at, NOW, locale, tFor(locale))).toBe(expected);
  });
});

describe("groupThreadMessages", () => {
  // Who wrote it, from the viewer's side: "me", "her" (the other party), or a
  // system message (never isMine).
  const msg = (id: string, from: "me" | "her" | "system", sentAt: number) => ({
    id,
    isMine: from === "me",
    kind: from === "system" ? "system" : "text",
    body: id,
    sentAt,
  });
  const at = (hour: number, minute: number, day = 19) =>
    new Date(2026, 9, day, hour, minute).getTime();
  // Compact shape for assertions: day labels, system ids, and groups as "own|other:ids".
  const shape = (items: ReturnType<typeof groupThreadMessages>) =>
    items.map((item) =>
      item.type === "day"
        ? `day:${item.label}`
        : item.type === "system"
          ? `system:${item.message.id}`
          : `${item.own ? "own" : "other"}:${item.messages.map((m) => m.id).join(",")}`,
    );

  it("returns nothing for an empty thread", () => {
    expect(groupThreadMessages([], NOW, "en", tFor("en"))).toEqual([]);
  });

  it("groups consecutive same-author messages within 5 minutes", () => {
    const items = groupThreadMessages(
      [
        msg("a", "her", at(10, 0)),
        msg("b", "her", at(10, 3)),
        msg("c", "her", at(10, 8)), // exactly 5 min after b → same group
        msg("d", "me", at(10, 9)),
        msg("e", "me", at(10, 10)),
      ],
      NOW,
      "en",
      tFor("en"),
    );
    expect(shape(items)).toEqual(["day:Today", "other:a,b,c", "own:d,e"]);
  });

  it("starts a new group after a gap of more than 5 minutes", () => {
    const items = groupThreadMessages(
      [
        msg("a", "her", at(10, 0)),
        msg("b", "her", at(10, 5, 19) + 1), // 5 min + 1 ms
      ],
      NOW,
      "en",
      tFor("en"),
    );
    expect(shape(items)).toEqual(["day:Today", "other:a", "other:b"]);
  });

  it("breaks groups and inserts a day separator at a calendar-day boundary", () => {
    const items = groupThreadMessages(
      [msg("a", "her", at(23, 58, 18)), msg("b", "her", at(0, 1, 19))],
      NOW,
      "nl",
      tFor("nl"),
    );
    expect(shape(items)).toEqual([
      "day:Gisteren",
      "other:a",
      "day:Vandaag",
      "other:b",
    ]);
  });

  it("renders system messages on their own and lets them break a group", () => {
    const items = groupThreadMessages(
      [
        msg("a", "me", at(10, 0)),
        msg("sys", "system", at(10, 1)),
        msg("b", "me", at(10, 2)),
      ],
      NOW,
      "en",
      tFor("en"),
    );
    expect(shape(items)).toEqual(["day:Today", "own:a", "system:sys", "own:b"]);
  });

  it("starts a new group for the other party's message after a system message", () => {
    const items = groupThreadMessages(
      [
        msg("a", "her", at(10, 0)),
        msg("sys", "system", at(10, 1)),
        msg("b", "her", at(10, 2)),
        msg("c", "her", at(10, 3)),
      ],
      NOW,
      "en",
      tFor("en"),
    );
    expect(shape(items)).toEqual([
      "day:Today",
      "other:a",
      "system:sys",
      "other:b,c",
    ]);
  });

  it("splits alternating own and other messages into separate groups", () => {
    const items = groupThreadMessages(
      [
        msg("a", "me", at(10, 0)),
        msg("b", "her", at(10, 1)),
        msg("c", "me", at(10, 2)),
      ],
      NOW,
      "en",
      tFor("en"),
    );
    expect(shape(items)).toEqual(["day:Today", "own:a", "other:b", "own:c"]);
  });
});

describe("threadQuickLinks", () => {
  const member = { anonymous: false, member: { name: "Joost" } };
  const dm = (profileHandle: string | null) =>
    ({
      kind: "dm",
      otherMember: member,
      profileHandle,
    }) as InboxThread["subject"];
  const exchange = (profileHandle: string | null) =>
    ({
      kind: "exchange",
      exchangeId: "ex 1",
      exchangeType: "trade",
      puzzleTitle: "Canals",
      otherMember: member,
      profileHandle,
    }) as InboxThread["subject"];
  const thread = (subject: InboxThread["subject"]) =>
    ({ subject, contextCopies: [] }) as unknown as InboxThread;

  it("links a DM to the member profile", () => {
    expect(threadQuickLinks(thread(dm("joost")))).toEqual([
      { kind: "profile", href: "/members/joost" },
    ]);
  });

  it("omits the profile link when the server withholds the handle", () => {
    expect(threadQuickLinks(thread(dm(null)))).toEqual([]);
  });

  it("links an exchange thread to the partner and /trades?exchange=<id>", () => {
    expect(threadQuickLinks(thread(exchange("joost")))).toEqual([
      { kind: "profile", href: "/members/joost" },
      { kind: "exchange", href: "/trades?exchange=ex%201" },
    ]);
  });

  it("drops the exchange partner's profile when anonymised or inactive", () => {
    expect(threadQuickLinks(thread(exchange(null)))).toEqual([
      { kind: "exchange", href: "/trades?exchange=ex%201" },
    ]);
  });
});

describe("contextCopyHref", () => {
  it("links to the copy page, escaping the id", () => {
    expect(
      contextCopyHref({
        copyId: "c 1",
        title: "x",
        brand: null,
        pieceCount: null,
        coverUrl: null,
        owner: "viewer",
      }),
    ).toBe("/copies/c%201");
  });
});

describe("coverStackSummary", () => {
  // The real catalogues through use-intl's ICU formatter.
  const en = createTranslator({
    locale: "en",
    messages: enMessages,
    namespace: "messages",
  }) as unknown as Translator;
  const nl = createTranslator({
    locale: "nl",
    messages: nlMessages,
    namespace: "messages",
  }) as unknown as Translator;

  it("names a single puzzle", () => {
    expect(coverStackSummary(["Canals"], "en", en)).toBe(
      "About 1 puzzle: Canals",
    );
  });

  it("lists up to three titles", () => {
    expect(coverStackSummary(["A", "B", "C"], "en", en)).toBe(
      "About 3 puzzles: A, B, and C",
    );
  });

  it("names only as many titles as asked (an inbox row names one)", () => {
    expect(coverStackSummary(["A", "B", "C", "D", "E"], "en", en, 1)).toBe(
      "About 5 puzzles: A and 4 more",
    );
    expect(coverStackSummary(["A", "B", "C", "D", "E"], "nl", nl, 1)).toBe(
      "Over 5 puzzels: A en nog 4",
    );
  });

  it("counts the titles beyond the visible three", () => {
    expect(coverStackSummary(["A", "B", "C", "D", "E"], "en", en)).toBe(
      "About 5 puzzles: A, B, C, and 2 more",
    );
    expect(coverStackSummary(["A", "B", "C", "D", "E"], "nl", nl)).toBe(
      "Over 5 puzzels: A, B, C en nog 2",
    );
  });
});

describe("copyOwnerHint", () => {
  const translators = {
    en: createTranslator({
      locale: "en",
      messages: enMessages,
      namespace: "messages",
    }) as unknown as Translator,
    nl: createTranslator({
      locale: "nl",
      messages: nlMessages,
      namespace: "messages",
    }) as unknown as Translator,
  };
  const named = {
    anonymous: false,
    member: { name: "Esther" },
  } as InboxThread["subject"]["otherMember"];
  const anonymised = {
    anonymous: true,
    anonRef: "anon-1",
  } as InboxThread["subject"]["otherMember"];
  const displayName = (source: { name?: string | null }) =>
    source.name ?? "generic";

  it.each([
    ["en", "viewer", named, "Your copy"],
    ["nl", "viewer", named, "Jouw exemplaar"],
    ["en", "other", named, "Esther's copy"],
    ["nl", "other", named, "Exemplaar van Esther"],
    ["en", "other", anonymised, "The other member's copy"],
    ["nl", "other", anonymised, "Exemplaar van de ander"],
  ] as const)("%s: %s copy → %s", (locale, owner, member, expected) => {
    expect(copyOwnerHint(owner, member, translators[locale], displayName)).toBe(
      expected,
    );
  });

  it("never names an anonymised owner", () => {
    expect(
      copyOwnerHint("other", anonymised, translators.en, () => "Leaked Name"),
    ).not.toContain("Leaked");
  });
});

describe("tradeEventText", () => {
  type Kind = NonNullable<
    NonNullable<AnyInboxThread["lastMessage"]>["tradeEvent"]
  >["kind"];
  // A Record so a new kind fails type-check here until it is listed (and so translated).
  const KINDS: Record<Kind, true> = {
    proposed: true,
    accepted: true,
    rejected: true,
    cancelled: true,
    completed: true,
    cancelled_member_deleted: true,
  };

  it.each([
    ["en", enMessages],
    ["nl", nlMessages],
    ["source", sourceMessages],
  ] as const)("has a %s string for every kind", (locale, messages) => {
    const t = createTranslator({
      locale: locale === "nl" ? "nl" : "en",
      messages,
      namespace: "messages",
    }) as unknown as Translator;
    for (const kind of Object.keys(KINDS) as Kind[]) {
      const text = tradeEventText({ kind }, t);
      expect(text).not.toContain("tradeEvent.");
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("reads in the viewer's language", () => {
    const t = createTranslator({
      locale: "nl",
      messages: nlMessages,
      namespace: "messages",
    }) as unknown as Translator;
    expect(tradeEventText({ kind: "rejected" }, t)).toBe(
      "Uitwisseling afgewezen",
    );
  });
});
