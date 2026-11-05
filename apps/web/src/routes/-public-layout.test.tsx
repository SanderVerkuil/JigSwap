// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import nl from "../../locales/nl.json";
import { Route } from "./_public";

// The route module only needs its options back.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ options }),
  Outlet: () => null,
}));

afterEach(cleanup);

describe("public layout pending state", () => {
  it("says it is loading in the visitor's language", () => {
    const Pending = (
      Route as unknown as { options: { pendingComponent: ComponentType } }
    ).options.pendingComponent;
    render(
      <IntlProvider locale="nl" messages={nl} timeZone="Europe/Amsterdam">
        <Pending />
      </IntlProvider>,
    );
    expect(screen.getByText(nl.common.loading)).toBeTruthy();
  });
});
