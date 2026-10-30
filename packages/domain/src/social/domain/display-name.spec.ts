import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_MAX_LENGTH, DisplayName } from "./display-name";

const valueOf = (raw: string): string => {
  const result = DisplayName.create(raw);
  if (!result.isOk) throw new Error(`expected ok for ${JSON.stringify(raw)}`);
  return result.value.value;
};

const errorOf = (raw: string) => {
  const result = DisplayName.create(raw);
  if (!result.isErr) throw new Error(`expected err for ${JSON.stringify(raw)}`);
  return result.error;
};

describe("DisplayName.create", () => {
  it("accepts a name and trims it", () => {
    expect(valueOf("  Alice  ")).toBe("Alice");
  });

  it("collapses runs of whitespace and turns line breaks into a single space", () => {
    expect(valueOf("Alice \n\t  B.")).toBe("Alice B.");
    expect(valueOf("Alice\u2028B.")).toBe("Alice B.");
  });

  it("drops bidi marks, embeddings, overrides and isolates", () => {
    expect(valueOf("\u202Eecila\u202C")).toBe("ecila");
    expect(valueOf("A\u200Eb\u200Fc\u061Cd")).toBe("Abcd");
    expect(valueOf("\u2066A\u2067B\u2068C\u2069")).toBe("ABC");
    expect(valueOf("\u202AA\u202BB\u202DC")).toBe("ABC");
  });

  it("drops C0 and C1 control characters", () => {
    expect(valueOf("Al\u0000ice\u0085")).toBe("Al ice");
    expect(valueOf("Al\u0007ice")).toBe("Al ice");
  });

  it("drops invisible zero-width spaces, word joiners and byte-order marks", () => {
    expect(valueOf("\uFEFFAl\u200Bi\u2060ce")).toBe("Alice");
  });

  it("keeps the zero-width joiner and variation selectors so emoji names survive", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    const heart = "\u2764\uFE0F";
    expect(valueOf(`Fam ${family} ${heart}`)).toBe(`Fam ${family} ${heart}`);
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(errorOf("").code).toBe("InvalidDisplayName");
    expect(errorOf("   \n").code).toBe("InvalidDisplayName");
  });

  it("rejects a name with nothing visible left once invisible characters are dropped", () => {
    expect(errorOf("\u202E\u200B\u2066").code).toBe("InvalidDisplayName");
  });

  it("accepts a name of exactly the maximum length and rejects one character more", () => {
    expect(valueOf("a".repeat(DISPLAY_NAME_MAX_LENGTH))).toHaveLength(
      DISPLAY_NAME_MAX_LENGTH,
    );
    const tooLong = errorOf("a".repeat(DISPLAY_NAME_MAX_LENGTH + 1));
    expect(tooLong.code).toBe("InvalidDisplayName");
    expect(tooLong.message).not.toBe(errorOf("").message);
  });

  it("measures the length after cleaning, so stripped characters do not count", () => {
    const padded = `\u202E${"a".repeat(DISPLAY_NAME_MAX_LENGTH)}\u202C   `;
    expect(valueOf(padded)).toBe("a".repeat(DISPLAY_NAME_MAX_LENGTH));
  });

  it("caps the limit at 50 characters", () => {
    expect(DISPLAY_NAME_MAX_LENGTH).toBe(50);
  });
});

describe("DisplayName.fromState", () => {
  it("rehydrates a stored name without re-validating it", () => {
    const legacy = "x".repeat(400);
    expect(DisplayName.fromState(legacy).value).toBe(legacy);
  });
});
