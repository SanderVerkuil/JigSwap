import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COACHMARK_COOKIE_NAME,
  parseCoachmarkDismissed,
  readCoachmarkDismissed,
  writeCoachmarkDismissed,
} from "./coachmark-state";

// Outside the Start build, createIsomorphicFn runs its server half: the request's cookies.
const request = vi.hoisted(() => ({
  getCookie: (_name: string): string | undefined => undefined,
}));
vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => request.getCookie(name),
}));

describe("parseCoachmarkDismissed", () => {
  it("finds the dismissal among a document.cookie string's other cookies", () => {
    expect(
      parseCoachmarkDismissed(
        `jigswap-intl=nl; ${COACHMARK_COOKIE_NAME}=1; sidebar_state=true`,
      ),
    ).toBe(true);
    expect(parseCoachmarkDismissed(`${COACHMARK_COOKIE_NAME}=1`)).toBe(true);
  });

  it("reads anything else as not dismissed", () => {
    expect(parseCoachmarkDismissed("")).toBe(false);
    expect(parseCoachmarkDismissed("jigswap-intl=nl")).toBe(false);
    expect(parseCoachmarkDismissed(`${COACHMARK_COOKIE_NAME}=0`)).toBe(false);
    expect(parseCoachmarkDismissed(`x${COACHMARK_COOKIE_NAME}=1`)).toBe(false);
  });
});

describe("readCoachmarkDismissed on the server", () => {
  it("reads the request's cookie", () => {
    request.getCookie = (name) =>
      name === COACHMARK_COOKIE_NAME ? "1" : undefined;
    expect(readCoachmarkDismissed()).toBe(true);
    request.getCookie = () => undefined;
    expect(readCoachmarkDismissed()).toBe(false);
  });

  it("leaves the hint to the browser when there is no request to read", () => {
    request.getCookie = () => {
      throw new Error("No StartEvent found in AsyncLocalStorage.");
    };
    expect(readCoachmarkDismissed()).toBe(true);
  });
});

describe("writeCoachmarkDismissed", () => {
  beforeEach(() => {
    vi.stubGlobal("document", { cookie: "" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("remembers the dismissal for a year on My Puzzles only", () => {
    writeCoachmarkDismissed();
    expect(document.cookie).toBe(
      `${COACHMARK_COOKIE_NAME}=1; path=/my-puzzles; max-age=31536000; samesite=lax`,
    );
  });
});
