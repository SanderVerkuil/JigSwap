// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { RESCREEN_RUNBOOK_URL, ScreeningHealth } from "./screening-health";

const mocks = vi.hoisted(() => ({ health: vi.fn<() => unknown>() }));

vi.mock("@/gateway", () => ({ gateway: { admin: {} } }));
vi.mock("@convex-dev/react-query", () => ({ convexQuery: () => ({}) }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: mocks.health() }),
}));

afterEach(cleanup);

const health = (overrides: Record<string, unknown> = {}) => ({
  provider: "huggingface",
  status: "missing_token",
  missingVars: ["HF_TOKEN"],
  unscoredCopyPhotos: 2,
  unscoredCompletionPhotos: 1,
  countCap: 200,
  ...overrides,
});

const renderHealth = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider locale={locale} messages={locale === "en" ? en : nl}>
      <ScreeningHealth />
    </IntlProvider>,
  );

describe("ScreeningHealth", () => {
  it("links the re-screen runbook from the unscored-photos warning and keeps the env-var names (en/nl)", () => {
    mocks.health.mockReturnValue(health());
    renderHealth();
    const link = screen.getByRole("link", {
      name: "one-shot migrations runbook",
    });
    expect(link.getAttribute("href")).toBe(RESCREEN_RUNBOOK_URL);
    expect(RESCREEN_RUNBOOK_URL).toContain(
      "docs/deployment/one-shot-migrations.md#libraryrescreenphotos",
    );
    expect(screen.getByRole("status").textContent).toContain("HF_TOKEN");
    expect(screen.getByRole("status").textContent).toContain("3 photos");

    cleanup();
    renderHealth("nl");
    expect(
      screen
        .getByRole("link", { name: "runbook voor eenmalige migraties" })
        .getAttribute("href"),
    ).toBe(RESCREEN_RUNBOOK_URL);
  });

  it("renders nothing while screening works and every photo was checked", () => {
    mocks.health.mockReturnValue(
      health({
        status: "ok",
        missingVars: [],
        unscoredCopyPhotos: 0,
        unscoredCompletionPhotos: 0,
      }),
    );
    const { container } = renderHealth();
    expect(container.textContent).toBe("");
  });
});
