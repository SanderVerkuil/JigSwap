// @vitest-environment happy-dom
// UX-158: like the app's search pill, the docs search pill names the shortcut of the platform it
// runs on (only after mount: the server cannot know it), announces both shortcuts to assistive tech
// and drops the key hint on touch screens. The route's key handler accepts Cmd+K and Ctrl+K.
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { DocsSearchPill } from "./docs-search-pill";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function searchPill() {
  return (
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <DocsSearchPill onOpenSearch={() => {}} />
    </IntlProvider>
  );
}

function stubPlatform(platform: string) {
  vi.stubGlobal("navigator", {
    ...navigator,
    platform,
    userAgentData: undefined,
  });
}

const pill = () =>
  screen.getByRole("button", { name: /^Search docs/ }) as HTMLElement;

describe("DocsSearchPill", () => {
  it.each([
    ["MacIntel", "⌘K"],
    ["Linux x86_64", "Ctrl K"],
    ["Win32", "Ctrl K"],
  ])("shows the %s shortcut as %s", (platform, hint) => {
    stubPlatform(platform);
    render(searchPill());
    expect(pill().querySelector("kbd")?.textContent).toBe(hint);
  });

  it("renders no hint on the server, where the platform is unknown", () => {
    expect(renderToString(searchPill())).not.toContain("<kbd");
  });

  it("announces both shortcuts and hides the hint on touch screens", () => {
    stubPlatform("Win32");
    render(searchPill());
    expect(pill().getAttribute("aria-keyshortcuts")).toBe("Meta+K Control+K");
    expect(pill().querySelector("kbd")?.className).toContain(
      "pointer-coarse:hidden",
    );
  });

  // 3.58:1 with the muted text colour on the muted chip.
  it("draws the hint in the body text colour, which meets 4.5:1", () => {
    stubPlatform("Win32");
    render(searchPill());
    expect(pill().querySelector("kbd")?.className).toContain(
      "text-mk-text-body",
    );
  });

  it("keeps the label on one line beside the wider hint", () => {
    stubPlatform("Win32");
    render(searchPill());
    const label = screen.getByText(en.marketing.docs.searchTrigger);
    expect(label.className).toContain("truncate");
  });
});
