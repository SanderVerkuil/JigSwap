// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { PinnedDetail } from "./pinned-detail";

afterEach(cleanup);

const renderIn = (locale: "en" | "nl", ui: ReactNode) =>
  render(
    <IntlProvider locale={locale} messages={locale === "en" ? en : nl}>
      {ui}
    </IntlProvider>,
  );

describe("PinnedDetail", () => {
  it("renders just the detail while the row is still in the queue", () => {
    renderIn(
      "en",
      <PinnedDetail gone={false} onNext={vi.fn()}>
        <p>Detail</p>
      </PinnedDetail>,
    );
    expect(screen.getByText("Detail")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says the row was handled elsewhere above the snapshot and moves on with Next", () => {
    const onNext = vi.fn();
    renderIn(
      "en",
      <PinnedDetail gone onNext={onNext}>
        <p>Snapshot</p>
      </PinnedDetail>,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Already handled elsewhere",
    );
    expect(screen.getByText("Snapshot")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next item" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("offers no Next when the queue has nothing else, and speaks Dutch", () => {
    renderIn("nl", <PinnedDetail gone />);
    expect(screen.getByRole("status").textContent).toContain(
      "Al elders afgehandeld",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
