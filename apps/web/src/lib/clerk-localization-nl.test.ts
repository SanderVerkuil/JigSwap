import { enUS, nlNL } from "@clerk/localizations";
import { describe, expect, it } from "vitest";
import { nlNLLocalization } from "./clerk-localization-nl";

// Dot-path → leaf value, so two localization trees can be compared key by key.
function flatten(value: unknown, prefix = ""): Map<string, unknown> {
  if (value === null || typeof value !== "object") {
    return new Map([[prefix, value]]);
  }
  const out = new Map<string, unknown>();
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    for (const [leafPath, leaf] of flatten(child, path))
      out.set(leafPath, leaf);
  }
  return out;
}

const OVERRIDDEN = [
  "signUp.restrictedAccess.title",
  "signUp.restrictedAccess.subtitle",
  "signUp.restrictedAccess.subtitleWaitlist",
  "signUp.restrictedAccess.actionText",
  "signUp.restrictedAccess.actionLink",
  "signUp.restrictedAccess.blockButton__emailSupport",
];

describe("nlNLLocalization", () => {
  const restricted = nlNLLocalization.signUp?.restrictedAccess;

  it("links the closed sign-up card back to sign-in, as English does", () => {
    expect(enUS.signUp?.restrictedAccess?.actionLink).toBe("Sign in");
    expect(restricted?.actionText).toBe("Heb je al een account?");
    expect(restricted?.actionLink).toBe("Inloggen");
  });

  it("says plainly that new accounts can't be made right now", () => {
    expect(restricted?.title).toBe("Registratie gesloten");
    expect(restricted?.subtitle).toBe(
      "Je kunt op dit moment geen account aanmaken. Denk je dat je wel toegang zou moeten hebben? Neem dan contact met ons op.",
    );
    expect(restricted?.subtitleWaitlist).toBe(
      "Je kunt op dit moment geen account aanmaken. Zet je op de wachtlijst, dan hoor je het als eerste zodra het kan.",
    );
    expect(restricted?.blockButton__emailSupport).toBe("Stuur ons een e-mail");
  });

  it("changes only those strings and leaves every other Clerk string as shipped", () => {
    const ours = flatten(nlNLLocalization);
    const stock = flatten(nlNL);
    expect([...ours.keys()].sort()).toEqual([...stock.keys()].sort());
    for (const [path, value] of stock) {
      if (OVERRIDDEN.includes(path)) {
        expect(ours.get(path), path).not.toBe(value);
      } else {
        expect(ours.get(path), path).toBe(value);
      }
    }
  });
});
