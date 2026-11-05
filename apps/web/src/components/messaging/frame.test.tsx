// @vitest-environment happy-dom
// UX-02: whether the inbox list sits beside the thread is decided by the
// messages frame's own width (a `/messages` container query), never by the
// viewport. With viewport `md:` variants an expanded sidebar left an 820px
// tablet a ~34px composer. The layout itself is checked in a browser; these
// pin the class contract that layout depends on.
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import {
  INBOX_LIST_PANE_CLASS,
  LIST_PANE_CLASS,
  MESSAGES_FRAME_CLASS,
  NO_SPLIT_ONLY_CLASS,
  SPLIT_ONLY_CLASS,
} from "./frame";
import { BackToInboxLink } from "./thread-view";

vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const SPLIT = "@min-[48rem]/messages:";
const DISPLAY = new Set(["flex", "hidden", "block", "grid", "contents"]);
const tokens = (classes: string) => classes.split(/\s+/).filter(Boolean);
// The utility after the last variant: "flex" for "@min-[48rem]/messages:flex".
const utility = (token: string) => token.slice(token.lastIndexOf(":") + 1);

describe("messages frame split", () => {
  it("makes the frame the `messages` container from md", () => {
    expect(tokens(MESSAGES_FRAME_CLASS)).toContain("md:@container/messages");
  });

  it.each([
    ["SPLIT_ONLY_CLASS", SPLIT_ONLY_CLASS],
    ["NO_SPLIT_ONLY_CLASS", NO_SPLIT_ONLY_CLASS],
    ["LIST_PANE_CLASS", LIST_PANE_CLASS],
    ["INBOX_LIST_PANE_CLASS", INBOX_LIST_PANE_CLASS],
  ])("%s shows or hides only on the frame's width", (_name, classes) => {
    const display = tokens(classes).filter((token) =>
      DISPLAY.has(utility(token)),
    );
    expect(display.length).toBeGreaterThan(0);
    for (const token of display) {
      // Unprefixed (the no-split default) or the split's container variant.
      expect(token === utility(token) || token.startsWith(SPLIT)).toBe(true);
    }
  });

  it("swaps the list and the back link at the same width", () => {
    expect(tokens(SPLIT_ONLY_CLASS)).toEqual(["hidden", `${SPLIT}flex`]);
    expect(tokens(NO_SPLIT_ONLY_CLASS)).toEqual([`${SPLIT}hidden`]);
    expect(tokens(LIST_PANE_CLASS)).toEqual(
      expect.arrayContaining(["hidden", `${SPLIT}flex`]),
    );
  });

  it("shows the back link to the inbox only without a split", () => {
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <BackToInboxLink />
      </IntlProvider>,
    );
    const link = screen.getByRole("link", { name: "Back to messages" });
    expect(link.getAttribute("href")).toBe("/messages");
    expect(tokens(link.className)).toEqual(
      expect.arrayContaining(tokens(NO_SPLIT_ONLY_CLASS)),
    );
  });
});
