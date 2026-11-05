// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "./i18n";

// `imports` counts loads of the corrected Dutch resource (each load reads the export once).
const mocks = vi.hoisted(() => ({
  imports: 0,
  nlNLLocalization: { locale: "nl-NL" },
}));

vi.mock("./clerk-localization-nl", () => ({
  get nlNLLocalization() {
    mocks.imports++;
    return mocks.nlNLLocalization;
  },
}));

// Fresh module state (cache + listeners) per test.
async function loadModule() {
  vi.resetModules();
  return import("./clerk-localization");
}

beforeEach(() => {
  mocks.imports = 0;
});
afterEach(cleanup);

describe("loadClerkLocalization", () => {
  it("needs nothing for English: Clerk's built-in strings are English", async () => {
    const { loadClerkLocalization } = await loadModule();
    await expect(loadClerkLocalization("en")).resolves.toBeUndefined();
    expect(mocks.imports).toBe(0);
  });

  it("imports the Dutch resource once and reuses it", async () => {
    const { loadClerkLocalization } = await loadModule();
    const [first, second] = await Promise.all([
      loadClerkLocalization("nl"),
      loadClerkLocalization("nl"),
    ]);
    expect(first).toEqual({ locale: "nl-NL" });
    expect(second).toBe(first);
    expect(await loadClerkLocalization("nl")).toBe(first);
    expect(mocks.imports).toBe(1);
  });
});

describe("useClerkLocalization", () => {
  async function renderProbe(locale: Locale) {
    const { useClerkLocalization } = await loadModule();
    const seen: unknown[] = [];
    function Probe({ locale }: { locale: Locale }) {
      seen.push(useClerkLocalization(locale));
      return null;
    }
    const view = render(<Probe locale={locale} />);
    return {
      seen,
      rerender: (next: Locale) => view.rerender(<Probe locale={next} />),
      Probe,
    };
  }

  it("is undefined for English and never loads a resource", async () => {
    const { seen } = await renderProbe("en");
    await act(async () => {});
    expect(seen.every((value) => value === undefined)).toBe(true);
    expect(mocks.imports).toBe(0);
  });

  it("re-renders with the Dutch resource once it has loaded", async () => {
    const { seen } = await renderProbe("nl");
    expect(seen[0]).toBeUndefined();
    await act(async () => {});
    expect(seen.at(-1)).toEqual({ locale: "nl-NL" });
  });

  it("follows a language switch both ways without reloading", async () => {
    const { seen, rerender } = await renderProbe("nl");
    await act(async () => {});
    expect(seen.at(-1)).toEqual({ locale: "nl-NL" });
    rerender("en");
    expect(seen.at(-1)).toBeUndefined();
    rerender("nl");
    expect(seen.at(-1)).toEqual({ locale: "nl-NL" });
    expect(mocks.imports).toBe(1);
  });

  it("renders undefined on the server", async () => {
    const { useClerkLocalization, loadClerkLocalization } = await loadModule();
    await loadClerkLocalization("nl");
    let value: unknown = "unset";
    function Probe() {
      value = useClerkLocalization("nl");
      return null;
    }
    renderToString(<Probe />);
    expect(value).toBeUndefined();
  });
});
