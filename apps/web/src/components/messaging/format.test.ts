import { ConvexError } from "convex/values";
import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import enMessages from "../../../locales/en.json";
import nlMessages from "../../../locales/nl.json";
import type { InboxThread, Translator } from "./format";
import {
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
  const ME = "me";
  const msg = (
    id: string,
    authorId: string | null,
    sentAt: number,
    kind: "text" | "system" = authorId === null ? "system" : "text",
  ) => ({ id, authorId, kind, body: id, sentAt });
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
    expect(groupThreadMessages([], ME, NOW, "en", tFor("en"))).toEqual([]);
  });

  it("groups consecutive same-author messages within 5 minutes", () => {
    const items = groupThreadMessages(
      [
        msg("a", "her", at(10, 0)),
        msg("b", "her", at(10, 3)),
        msg("c", "her", at(10, 8)), // exactly 5 min after b → same group
        msg("d", ME, at(10, 9)),
        msg("e", ME, at(10, 10)),
      ],
      ME,
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
      ME,
      NOW,
      "en",
      tFor("en"),
    );
    expect(shape(items)).toEqual(["day:Today", "other:a", "other:b"]);
  });

  it("breaks groups and inserts a day separator at a calendar-day boundary", () => {
    const items = groupThreadMessages(
      [msg("a", "her", at(23, 58, 18)), msg("b", "her", at(0, 1, 19))],
      ME,
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
        msg("a", ME, at(10, 0)),
        msg("sys", null, at(10, 1)),
        msg("b", ME, at(10, 2)),
      ],
      ME,
      NOW,
      "en",
      tFor("en"),
    );
    expect(shape(items)).toEqual(["day:Today", "own:a", "system:sys", "own:b"]);
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
  const copy = (copyId: string) => ({
    copyId,
    title: copyId,
    brand: null,
    pieceCount: null,
    coverUrl: null,
  });
  const thread = (
    subject: InboxThread["subject"],
    contextCopies: ReturnType<typeof copy>[],
  ) => ({ subject, contextCopies }) as unknown as InboxThread;

  it("links a DM to the member profile and the one puzzle it is about", () => {
    expect(threadQuickLinks(thread(dm("joost"), [copy("copy1")]))).toEqual([
      { kind: "profile", href: "/members/joost" },
      { kind: "puzzle", href: "/copies/copy1" },
    ]);
  });

  it("omits the profile link when the server withholds the handle", () => {
    expect(threadQuickLinks(thread(dm(null), []))).toEqual([]);
  });

  it("groups two or more puzzles into one menu, keeping the server's order", () => {
    const copies = [copy("newest"), copy("older"), copy("oldest")];
    expect(threadQuickLinks(thread(dm("joost"), copies))).toEqual([
      { kind: "profile", href: "/members/joost" },
      { kind: "puzzles", copies },
    ]);
  });

  it("links an exchange thread to the partner, /trades?exchange=<id> and its puzzles", () => {
    const copies = [copy("requested"), copy("offered")];
    expect(threadQuickLinks(thread(exchange("joost"), copies))).toEqual([
      { kind: "profile", href: "/members/joost" },
      { kind: "exchange", href: "/trades?exchange=ex%201" },
      { kind: "puzzles", copies },
    ]);
  });

  it("drops the exchange partner's profile when anonymised or inactive", () => {
    expect(
      threadQuickLinks(thread(exchange(null), [copy("requested")])),
    ).toEqual([
      { kind: "exchange", href: "/trades?exchange=ex%201" },
      { kind: "puzzle", href: "/copies/requested" },
    ]);
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
