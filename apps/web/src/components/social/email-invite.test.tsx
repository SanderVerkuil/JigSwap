// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import type { EmailInviteView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { EmailInvite } from "./email-invite";

const AVAILABILITY = getFunctionName(gateway.invitations.availability);
const LIST = getFunctionName(gateway.invitations.listMine);
const SEND = getFunctionName(gateway.invitations.send);
const REVOKE = getFunctionName(gateway.invitations.revoke);

const mocks = vi.hoisted(() => ({
  action: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  queries: {} as Record<string, unknown>,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexAction:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.action(getFunctionName(ref), args),
}));
// Queries resolve from `mocks.queries` by function name; anything else stays unresolved.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: unknown[] }) => ({
    data: mocks.queries[options.queryKey[1] as string],
  }),
}));

const NOW = new Date("2026-10-18T12:00:00Z");
const DAY = 86_400_000;

const invite = (inviteRef: string, ageMs: number): EmailInviteView => ({
  inviteRef,
  kind: "follow",
  createdAt: NOW.getTime() - ageMs,
  expiresAt: NOW.getTime() - ageMs + 14 * DAY,
});

const renderInvite = (locale: "en" | "nl" = "en") =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
        now={NOW}
      >
        <EmailInvite kind="follow" />
      </IntlProvider>
    </QueryClientProvider>,
  );

const emailInput = () =>
  screen.getByLabelText<HTMLInputElement>("Email address");
const submit = () => screen.getByRole("button", { name: "Invite by email" });
const status = () => screen.getByRole("status");

const sendTo = (address: string) => {
  fireEvent.change(emailInput(), { target: { value: address } });
  fireEvent.click(submit());
};

beforeEach(() => {
  mocks.action.mockReset().mockResolvedValue({ status: "sent" });
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.queries = { [AVAILABILITY]: true, [LIST]: [] };
});
afterEach(cleanup);

describe("EmailInvite", () => {
  it("renders nothing when email invites are unavailable", () => {
    mocks.queries = { [AVAILABILITY]: false, [LIST]: [invite("r1", 0)] };
    const { container } = renderInvite();
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing while availability is still loading", () => {
    mocks.queries = {};
    const { container } = renderInvite();
    expect(container.innerHTML).toBe("");
  });

  it("offers an email field without autocomplete and the invite button", () => {
    renderInvite();
    expect(emailInput().type).toBe("email");
    expect(emailInput().getAttribute("autocomplete")).toBe("off");
    expect(submit().hasAttribute("disabled")).toBe(true);
  });

  it("sends, shows the same confirmation and clears the field without echoing the address", async () => {
    renderInvite();
    sendTo("friend@example.com");

    await waitFor(() => expect(status().textContent).toBe("Invitation sent"));
    expect(mocks.action.mock.calls).toEqual([
      [SEND, { kind: "follow", email: "friend@example.com" }],
    ]);
    expect(emailInput().value).toBe("");
    expect(document.body.textContent).not.toContain("friend@example.com");

    // A second address gets exactly the same answer.
    sendTo("someone-else@example.com");
    await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(status().textContent).toBe("Invitation sent"));
    expect(document.body.textContent).not.toContain("someone-else");
  });

  it("explains an invalid address", async () => {
    mocks.action.mockRejectedValue(new ConvexError({ code: "InvalidEmail" }));
    renderInvite();
    sendTo("not-an-address");
    await waitFor(() =>
      expect(status().textContent).toBe("Enter a valid email address."),
    );
    // The field keeps what was typed so it can be corrected.
    expect(emailInput().value).toBe("not-an-address");
  });

  it("says when to try again after the rate limit", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      mocks.action.mockRejectedValue(
        new ConvexError({ code: "RateLimited", retryAfterMs: 5 * 3_600_000 }),
      );
      renderInvite();
      sendTo("friend@example.com");
      await waitFor(() =>
        expect(status().textContent).toBe(
          "You've sent a lot of invitations today. Try again in 5 hours.",
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives any other refusal the generic message", async () => {
    mocks.action.mockRejectedValue(
      new ConvexError({ code: "EmailInvitesUnavailable" }),
    );
    renderInvite();
    sendTo("friend@example.com");
    await waitFor(() =>
      expect(status().textContent).toBe(
        "Couldn't send the invitation. Try again.",
      ),
    );
  });

  it("lists sent invitations with when they were sent and expire, and nothing about the address", () => {
    mocks.queries[LIST] = [invite("r1", 2 * DAY)];
    renderInvite();
    const list = screen.getByRole("list");
    expect(within(list).getByText("Invitation sent 2 days ago")).toBeTruthy();
    expect(within(list).getByText("expires Oct 30, 2026")).toBeTruthy();
    expect(list.textContent).not.toContain("@");
  });

  it("revokes an invitation after confirming", async () => {
    mocks.queries[LIST] = [invite("r1", DAY)];
    mocks.action.mockResolvedValue(null);
    renderInvite();

    fireEvent.click(within(screen.getByRole("list")).getByRole("button"));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Revoke this invitation?",
    });
    expect(mocks.action).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() =>
      expect(mocks.action.mock.calls).toEqual([[REVOKE, { inviteRef: "r1" }]]),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Invitation revoked"),
    );
  });

  it("renders in Dutch", () => {
    mocks.queries[LIST] = [invite("r1", DAY)];
    renderInvite("nl");
    expect(screen.getByLabelText("E-mailadres")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Uitnodigen per e-mail" }),
    ).toBeTruthy();
    expect(screen.getByText("Verstuurde uitnodigingen")).toBeTruthy();
    expect(
      screen.getByText("Uitnodiging verstuurd 1 dag geleden"),
    ).toBeTruthy();
  });
});
