import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import enMessages from "../../../locales/en.json";
import nlMessages from "../../../locales/nl.json";
import type { AnyInboxThread, Translator } from "./format";
import {
  circleHref,
  circleSnippet,
  groupThreadMessages,
  memberProfileHref,
  systemEventText,
} from "./format";

const tFor = (locale: "en" | "nl"): Translator =>
  createTranslator({
    locale,
    messages: locale === "en" ? enMessages : nlMessages,
    namespace: "messages",
  }) as Translator;
const displayName = (source: { name?: string | null }) =>
  source.name ?? "generic";

const member = (id: string, name: string) => ({
  anonymous: false as const,
  member: {
    _id: id,
    _creationTime: 0,
    name,
    isActive: true,
    createdAt: 0,
    updatedAt: 0,
  },
});
const anon = (ref: string) => ({ anonymous: true as const, anonRef: ref });

type Last = NonNullable<AnyInboxThread["lastMessage"]>;
const last = (fields: Partial<Last>): Last =>
  ({
    id: "m1",
    isMine: false,
    kind: "text",
    body: "Who has the Wasgij?",
    sentAt: 1,
    ...fields,
  }) as Last;

describe("systemEventText", () => {
  it.each([
    ["en", "joined", "Anna joined"],
    ["en", "left", "Anna is no longer in the circle"],
    ["nl", "joined", "Anna doet nu mee"],
    ["nl", "left", "Anna zit niet meer in de kring"],
  ] as const)("names a visible member (%s, %s)", (locale, kind, expected) => {
    expect(
      systemEventText(
        { kind, member: member("u_anna", "Anna") },
        "u_me",
        tFor(locale),
        displayName,
      ),
    ).toBe(expected);
  });

  it.each([
    ["en", "joined", "A member joined"],
    ["en", "left", "A member left"],
    ["nl", "joined", "Er doet een nieuw lid mee"],
    ["nl", "left", "Een lid zit niet meer in de kring"],
  ] as const)(
    "stays generic without a member (%s, %s)",
    (locale, kind, expected) => {
      expect(systemEventText({ kind }, "u_me", tFor(locale), displayName)).toBe(
        expected,
      );
    },
  );

  it("never names an anonymised member", () => {
    expect(
      systemEventText(
        { kind: "left", member: anon("ref") },
        "u_me",
        tFor("en"),
        displayName,
      ),
    ).toBe("A member left");
  });

  it.each([
    ["en", "You joined"],
    ["nl", "Je doet nu mee"],
  ] as const)("says the viewer's own join (%s)", (locale, expected) => {
    expect(
      systemEventText(
        { kind: "joined", member: member("u_me", "Me") },
        "u_me",
        tFor(locale),
        displayName,
      ),
    ).toBe(expected);
  });
});

describe("circleSnippet", () => {
  const snippet = (message: Last | null, locale: "en" | "nl" = "en") =>
    circleSnippet(message, "u_me", tFor(locale), displayName, "Removed");

  it("prefixes another member's message with their name", () => {
    expect(snippet(last({ author: member("u_bas", "Bas") }))).toBe(
      "Bas: Who has the Wasgij?",
    );
  });

  it.each([
    ["en", "You: Me too!"],
    ["nl", "Jij: Me too!"],
  ] as const)("prefixes the viewer's own message (%s)", (locale, expected) => {
    expect(
      snippet(
        last({
          isMine: true,
          body: "Me too!",
          author: member("u_me", "Me"),
        }),
        locale,
      ),
    ).toBe(expected);
  });

  it("labels an anonymised author without a name", () => {
    expect(snippet(last({ author: anon("ref") }))).toBe(
      "Anonymous user: Who has the Wasgij?",
    );
  });

  it("collapses a blocked author's text", () => {
    expect(
      snippet(
        last({ author: member("u_bas", "Bas"), authorBlockedByMe: true }),
      ),
    ).toBe("Message from a member you blocked");
  });

  it("renders a join row as its system text", () => {
    expect(
      snippet(
        last({
          kind: "system",
          body: "",
          systemEvent: { kind: "joined", member: member("u_me", "Me") },
        }),
      ),
    ).toBe("You joined");
  });

  it("names the sender of a photo and the empty state", () => {
    expect(
      snippet(
        last({ kind: "image", body: "", author: member("u_bas", "Bas") }),
      ),
    ).toBe("Bas sent a photo");
    expect(snippet(null)).toBe("No messages yet");
  });
});

describe("groupThreadMessages in a circle", () => {
  const msg = (
    id: string,
    author: ReturnType<typeof member> | ReturnType<typeof anon>,
    sentAt: number,
    isMine = false,
  ) => ({ id, isMine, kind: "text", body: id, sentAt, author });
  const at = (minute: number) => new Date(2026, 9, 19, 10, minute).getTime();

  it("starts a new run when another member writes", () => {
    const anna = member("u_anna", "Anna");
    const bas = member("u_bas", "Bas");
    const items = groupThreadMessages(
      [
        msg("a1", anna, at(0)),
        msg("a2", anna, at(1)),
        msg("b1", bas, at(2)),
        msg("x1", anon("ref1"), at(3)),
        msg("x2", anon("ref2"), at(4)),
        msg("b2", bas, at(5)),
      ],
      at(10),
      "en",
      tFor("en"),
    );
    expect(
      items
        .filter((item) => item.type === "group")
        .map((item) => item.messages.map((m) => m.id).join(",")),
    ).toEqual(["a1,a2", "b1", "x1", "x2", "b2"]);
  });
});

describe("circle links", () => {
  it("points the circle quick link at the circles page", () => {
    expect(circleHref("circle 1")).toBe("/circles?circle=circle%201");
  });

  it("links a revealed author's profile, never an anonymised one", () => {
    expect(memberProfileHref(member("u_bas", "Bas"))).toBe("/members/u_bas");
    expect(
      memberProfileHref({
        anonymous: false,
        member: { ...member("u_bas", "Bas").member, username: "bas" },
      }),
    ).toBe("/members/bas");
    expect(memberProfileHref(anon("ref"))).toBeNull();
  });
});
