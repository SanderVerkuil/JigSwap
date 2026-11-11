// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  focusHashTarget,
  focusMainContent,
  MAIN_CONTENT_ID,
  SkipLink,
} from "./skip-link";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const mount = (html: string) => {
  document.body.insertAdjacentHTML("beforeend", html);
};

describe("focusMainContent", () => {
  it("focuses the shell's #main-content, even when another <main> comes first", () => {
    mount(
      `<main id="other">x</main><main id="${MAIN_CONTENT_ID}" tabindex="-1">y</main>`,
    );
    expect(focusMainContent()).toBe(true);
    expect(document.activeElement?.id).toBe(MAIN_CONTENT_ID);
  });

  it("falls back to the first <main> and makes it script-focusable", () => {
    mount(`<header><a href="/">Home</a></header><main id="page">x</main>`);
    expect(focusMainContent()).toBe(true);
    const main = document.getElementById("page");
    expect(document.activeElement).toBe(main);
    expect(main?.getAttribute("tabindex")).toBe("-1");
  });

  it("keeps an existing tabindex", () => {
    mount(`<main tabindex="0">x</main>`);
    focusMainContent();
    expect(document.querySelector("main")?.getAttribute("tabindex")).toBe("0");
  });

  it("does nothing when the page has no main landmark", () => {
    mount(`<div>no landmark</div>`);
    expect(focusMainContent()).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});

describe("focusHashTarget", () => {
  // A Dutch heading's id keeps its accents; the browser's location.hash has them percent-encoded.
  it("finds a section by a hash as the address bar encodes it", () => {
    mount(
      `<main id="${MAIN_CONTENT_ID}"><h2 id="een-exemplaar-privé-maken">Een exemplaar privé maken</h2></main>`,
    );
    expect(focusHashTarget("#een-exemplaar-priv%C3%A9-maken")).toBe(true);
    expect(document.activeElement?.id).toBe("een-exemplaar-privé-maken");
  });

  it("leaves alone a target outside the main content", () => {
    mount(
      `<nav><h2 id="menu">Menu</h2></nav><main id="${MAIN_CONTENT_ID}">x</main>`,
    );
    expect(focusHashTarget("menu")).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});

describe("SkipLink", () => {
  const renderLink = (locale: "en" | "nl") =>
    render(
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <SkipLink />
        <main id={MAIN_CONTENT_ID} tabIndex={-1}>
          <button type="button">First control</button>
        </main>
      </IntlProvider>,
    );

  it.each([
    ["en", "Skip to content"],
    ["nl", "Naar inhoud springen"],
  ] as const)("is a link to the main content (%s)", (locale, name) => {
    renderLink(locale);
    const link = screen.getByRole("link", { name });
    expect(link.getAttribute("href")).toBe(`#${MAIN_CONTENT_ID}`);
  });

  it("moves focus to the main content without a hash navigation", () => {
    renderLink("en");
    const link = screen.getByRole("link", { name: "Skip to content" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    fireEvent(link, click);
    expect(click.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe(MAIN_CONTENT_ID);
  });
});

// The link's href must resolve on its own: without JS (or before hydration) the browser follows it
// natively, and a <main> without this id leaves focus on the header (UX-08).
describe("every <main> is the skip link's target", () => {
  const src = join(import.meta.dirname, "../..");
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)
        ? [path]
        : [];
    });

  it("carries MAIN_CONTENT_ID", () => {
    const offenders = sources(src).flatMap((path) => {
      const file = relative(src, path);
      // The shell gives its SidebarInset, this primitive's <main>, the id.
      if (file === join("components", "ui", "sidebar.tsx")) return [];
      const code = readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
        .join("\n");
      return (code.match(/<main\b[^>]*>/g) ?? [])
        .filter((tag) => !tag.includes("id={MAIN_CONTENT_ID}"))
        .map((tag) => `${file}: ${tag}`);
    });
    expect(offenders).toEqual([]);
  });
});
