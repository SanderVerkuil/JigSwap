// @vitest-environment happy-dom
import type { Id } from "@/gateway";
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { MessageButton } from "./message-button";

vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "member_me" } }),
}));
// canMessage answers yes; nothing is clicked, so the mutation never runs.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: true }),
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

afterEach(cleanup);

describe("MessageButton labelled icon spacing", () => {
  // The Button already spaces its icon (gap-2); a margin on top doubled it and, beside the
  // Following menu, pushed the 390px profile hero's overflow menu onto its own row.
  it("adds no margin of its own to its icon", () => {
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <MessageButton memberId={"member_mara" as Id<"users">} />
      </IntlProvider>,
    );
    const icons = [
      ...screen
        .getByRole("button", { name: "Message" })
        .querySelectorAll("svg"),
    ];
    expect(icons).toHaveLength(1);
    expect(
      [...icons[0]!.classList].filter((c) => /^-?m[lrxse]-/.test(c)),
    ).toEqual([]);
  });
});
