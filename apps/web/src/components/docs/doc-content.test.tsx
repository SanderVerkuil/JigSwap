// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocContent } from "./doc-content";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ navigate }),
}));

const HTML = [
  '<p><a href="/docs/staying-informed/messages#photo-checks">Photo <strong>checks</strong></a></p>',
  '<p><a href="/docs">Docs home</a></p>',
  '<p><a href="/privacy">Privacy</a></p>',
  '<p><a href="#in-page">In page</a></p>',
  '<p><a href="/docs/getting-started" target="_blank" rel="noopener noreferrer">New tab</a></p>',
  '<p><a href="/docsearch">Not the docs</a></p>',
].join("");

// Whether the browser would still follow the last click itself. The listener runs after React's
// and then stops happy-dom from following it, which would navigate the test window.
let browserFollows = false;
const holdBrowser = (e: Event) => {
  browserFollows = !e.defaultPrevented;
  e.preventDefault();
};
beforeEach(() => window.addEventListener("click", holdBrowser));

afterEach(() => {
  window.removeEventListener("click", holdBrowser);
  cleanup();
  navigate.mockClear();
});

const click = (target: Element, init?: MouseEventInit) => {
  fireEvent.click(target, init);
  return browserFollows;
};
const link = (name: string) => screen.getByRole("link", { name });

// The 38 English cross-links between articles each did a full page reload, which also reset the
// sidebar's scroll.
describe("DocContent links", () => {
  it("sends a plain click on a docs link through the router, hash included", () => {
    render(<DocContent html={HTML} />);

    // A click on the bold text inside the link counts too.
    expect(click(screen.getByText("checks"))).toBe(false);
    expect(navigate).toHaveBeenCalledWith({
      href: "/docs/staying-informed/messages#photo-checks",
    });
  });

  it("routes the docs landing too", () => {
    render(<DocContent html={HTML} />);
    expect(click(link("Docs home"))).toBe(false);
    expect(navigate).toHaveBeenCalledWith({ href: "/docs" });
  });

  it.each([
    ["a ctrl-click", { ctrlKey: true }],
    ["a cmd-click", { metaKey: true }],
    ["a shift-click", { shiftKey: true }],
    ["a middle click", { button: 1 }],
  ])("leaves %s to the browser", (_, init) => {
    render(<DocContent html={HTML} />);
    expect(click(link("Photo checks"), init)).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(["Privacy", "In page", "New tab", "Not the docs"])(
    "leaves the %s link to the browser",
    (name) => {
      render(<DocContent html={HTML} />);
      expect(click(link(name))).toBe(true);
      expect(navigate).not.toHaveBeenCalled();
    },
  );
});
