// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { QrDialogAutoOpen } from "./qr-dialog";

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => async () => ({ token: "tok123" }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children?: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

const renderDialog = (handle: string | undefined) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en}>
        <QrDialogAutoOpen
          memberId="member1"
          displayName="Olivia"
          username="olivia"
          handle={handle}
          title="Your QR"
          body="Show it"
          onClose={() => {}}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );

afterEach(cleanup);

describe("QrDialog caption", () => {
  it("shows the server's canonical handle, not the username (SEC-07)", async () => {
    renderDialog("member1");
    await waitFor(() =>
      expect(screen.getByText(/\/members\/member1$/)).toBeTruthy(),
    );
    expect(screen.queryByText(/\/members\/olivia/)).toBeNull();
  });

  it("hides the caption when no handle is known", async () => {
    renderDialog(undefined);
    await waitFor(() =>
      expect(screen.getByText(en.invite.scanHint)).toBeTruthy(),
    );
    expect(screen.queryByText(/\/members\//)).toBeNull();
  });
});
