import { describe, expect, it } from "vitest";
import {
  parseSidebarCookie,
  parseSidebarCookies,
  resolveSidebarOpen,
  SIDEBAR_COOKIE_NAME,
  SIDEBAR_WIDE_COOKIE_NAME,
} from "./sidebar-state";

describe("parseSidebarCookie", () => {
  it("reads the two values the sidebar writes", () => {
    expect(parseSidebarCookie("true")).toBe(true);
    expect(parseSidebarCookie("false")).toBe(false);
  });

  it("treats a missing or unknown value as no choice", () => {
    expect(parseSidebarCookie(undefined)).toBeUndefined();
    expect(parseSidebarCookie(null)).toBeUndefined();
    expect(parseSidebarCookie("")).toBeUndefined();
    expect(parseSidebarCookie("TRUE")).toBeUndefined();
    expect(parseSidebarCookie("1")).toBeUndefined();
  });
});

describe("parseSidebarCookies", () => {
  it("picks the choice and the window hint out of a document.cookie string", () => {
    expect(
      parseSidebarCookies(
        `jigswap-intl=nl; ${SIDEBAR_COOKIE_NAME}=false; ${SIDEBAR_WIDE_COOKIE_NAME}=true; theme=dark`,
      ),
    ).toEqual({ open: false, wide: true });
  });

  it("leaves both undefined when neither cookie is set", () => {
    expect(parseSidebarCookies("jigswap-intl=nl")).toEqual({
      open: undefined,
      wide: undefined,
    });
    expect(parseSidebarCookies("")).toEqual({
      open: undefined,
      wide: undefined,
    });
  });

  it("does not confuse the window hint with the choice", () => {
    expect(parseSidebarCookies(`${SIDEBAR_WIDE_COOKIE_NAME}=false`)).toEqual({
      open: undefined,
      wide: false,
    });
  });
});

describe("resolveSidebarOpen", () => {
  it("honours a remembered choice on a wide window", () => {
    expect(resolveSidebarOpen(false, true)).toBe(false);
    expect(resolveSidebarOpen(true, true)).toBe(true);
  });

  it("without a choice, opens on a wide window", () => {
    expect(resolveSidebarOpen(undefined, true)).toBe(true);
  });

  it("rests as the icon rail below 1024px, whatever was remembered", () => {
    expect(resolveSidebarOpen(undefined, false)).toBe(false);
    expect(resolveSidebarOpen(false, false)).toBe(false);
    expect(resolveSidebarOpen(true, false)).toBe(false);
  });
});
