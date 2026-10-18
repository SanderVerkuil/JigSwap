import { describe, expect, it } from "vitest";
import {
  INVITE_EMAIL_MAX_LENGTH,
  INVITER_NAME_MAX_LENGTH,
  inviterNameForEmail,
  normalizeInviteEmail,
} from "./invite-email";

const valueOf = (raw: string) => {
  const result = normalizeInviteEmail(raw);
  return result.isOk ? result.value : result.error.code;
};

describe("normalizeInviteEmail", () => {
  it("trims and lowercases a valid address", () => {
    expect(valueOf("  Anna.De-Vries+Puzzles@Example.COM \n")).toBe(
      "anna.de-vries+puzzles@example.com",
    );
  });

  it("accepts the HTML spec's local-part characters and a single-label domain", () => {
    expect(valueOf("a.b!#$%&'*+/=?^_`{|}~-@localhost")).toBe(
      "a.b!#$%&'*+/=?^_`{|}~-@localhost",
    );
    expect(valueOf("x@a-b.c0")).toBe("x@a-b.c0");
    expect(valueOf("x@a")).toBe("x@a");
    expect(valueOf("x@a.b")).toBe("x@a.b");
  });

  it.each([
    [""],
    ["   "],
    ["anna"],
    ["anna@"],
    ["@example.com"],
    ["anna@@example.com"],
    ["anna@example..com"],
    ["anna@-example.com"],
    ["anna@example-.com"],
    ["anna@exa_mple.com"],
    ["an na@example.com"],
    ["anna@example.com\nBcc: x@y.z"],
    ["<anna@example.com>"],
    ["anna@example.com."],
  ])("rejects %j as InvalidEmail", (raw) => {
    expect(valueOf(raw)).toBe("InvalidEmail");
  });

  it("rejects a domain label longer than 63 characters", () => {
    expect(valueOf(`a@${"b".repeat(63)}.com`)).toBe(`a@${"b".repeat(63)}.com`);
    expect(valueOf(`a@${"b".repeat(64)}.com`)).toBe("InvalidEmail");
  });

  it("accepts exactly the maximum length and rejects one more", () => {
    const domain = `${"d".repeat(60)}.${"d".repeat(60)}.${"d".repeat(60)}.com`;
    const local = (n: number) => "l".repeat(n - domain.length - 1);
    const atMax = `${local(INVITE_EMAIL_MAX_LENGTH)}@${domain}`;
    expect(atMax).toHaveLength(254);
    expect(valueOf(atMax)).toBe(atMax);
    expect(valueOf(`l${atMax}`)).toBe("InvalidEmail");
  });

  it("measures the length after trimming", () => {
    const domain = `${"d".repeat(60)}.${"d".repeat(60)}.${"d".repeat(60)}.com`;
    const atMax = `${"l".repeat(INVITE_EMAIL_MAX_LENGTH - domain.length - 1)}@${domain}`;
    expect(valueOf(`   ${atMax}   `)).toBe(atMax);
  });
});

describe("inviterNameForEmail", () => {
  it("keeps an ordinary name as is", () => {
    expect(inviterNameForEmail("Sander Verkuil")).toBe("Sander Verkuil");
  });

  it("returns undefined for a missing, empty or blank name", () => {
    expect(inviterNameForEmail(undefined)).toBeUndefined();
    expect(inviterNameForEmail("")).toBeUndefined();
    expect(inviterNameForEmail(" \r\n\t\u2028 ")).toBeUndefined();
  });

  it("turns line breaks and control characters into single spaces", () => {
    expect(inviterNameForEmail("Anna\r\nBcc: x@y.z")).toBe("Anna Bcc: x@y.z");
    expect(inviterNameForEmail("A\u0000B\u0007C\u007fD\u0085E\u009fF")).toBe(
      "A B C D E F",
    );
    expect(inviterNameForEmail("A\u2028B\u2029C")).toBe("A B C");
  });

  it("drops bidi controls and other invisible format characters", () => {
    for (const mark of [
      "\u061C",
      "\u200E",
      "\u200F",
      "\u202A",
      "\u202B",
      "\u202C",
      "\u202D",
      "\u202E",
      "\u2066",
      "\u2067",
      "\u2068",
      "\u2069",
      "\u200B",
      "\uFEFF",
    ]) {
      expect(inviterNameForEmail(`Ann${mark}a${mark}${mark}`)).toBe("Anna");
    }
    expect(inviterNameForEmail("\u202E\u2066")).toBeUndefined();
  });

  it("collapses whitespace runs and trims", () => {
    expect(inviterNameForEmail("  Anna    de   Vries  ")).toBe("Anna de Vries");
  });

  it("keeps a name of exactly the maximum length", () => {
    const name = "n".repeat(INVITER_NAME_MAX_LENGTH);
    expect(inviterNameForEmail(name)).toBe(name);
  });

  it("cuts a longer name with an ellipsis, at the maximum length", () => {
    const cut = inviterNameForEmail("n".repeat(INVITER_NAME_MAX_LENGTH + 1));
    expect(cut).toBe(`${"n".repeat(INVITER_NAME_MAX_LENGTH - 1)}…`);
    expect(Array.from(cut ?? "")).toHaveLength(INVITER_NAME_MAX_LENGTH);
  });

  it("does not leave a space before the ellipsis", () => {
    const name = `${"n".repeat(INVITER_NAME_MAX_LENGTH - 2)} xyz`;
    expect(inviterNameForEmail(name)).toBe(
      `${"n".repeat(INVITER_NAME_MAX_LENGTH - 2)}…`,
    );
  });

  it("counts characters, not UTF-16 units, and never splits an emoji", () => {
    const name = "🧩".repeat(INVITER_NAME_MAX_LENGTH + 5);
    expect(inviterNameForEmail(name)).toBe(
      `${"🧩".repeat(INVITER_NAME_MAX_LENGTH - 1)}…`,
    );
    const fits = "🧩".repeat(INVITER_NAME_MAX_LENGTH);
    expect(inviterNameForEmail(fits)).toBe(fits);
  });
});
