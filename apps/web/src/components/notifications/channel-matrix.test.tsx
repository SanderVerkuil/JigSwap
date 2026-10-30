// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { ChannelMatrix } from "./channel-matrix";

vi.mock("@/compat/clerk", () => ({ useUser: () => ({ user: { id: "u1" } }) }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: false }),
}));

const renderMatrix = () => {
  const onToggle = vi.fn();
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <ChannelMatrix
        // The member switched every safety notice off everywhere.
        preferences={{
          content_removed: { inApp: false, push: false },
          report_decided: { inApp: false, push: false },
        }}
        channelLabel={{ inApp: "In-app", email: "Email", push: "Push" }}
        onToggle={onToggle}
        onToggleCategory={vi.fn()}
      />
    </IntlProvider>,
  );
  return { onToggle };
};

// A switch is named by its row's title + its column header (aria-labelledby).
const switchFor = (type: string, channel: string) =>
  document
    .getElementById(`row-${type}-title`)!
    .closest('[role="row"]')!
    .querySelector<HTMLButtonElement>(
      `[role="switch"][aria-labelledby="row-${type}-title col-${channel}"]`,
    )!;

// The text an id-reference list points at, the way assistive tech joins it.
const textOf = (ids: string | null) =>
  (ids ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `<missing ${id}>`)
    .join(" ");

afterEach(cleanup);

describe("ChannelMatrix mandatory in-app notices", () => {
  it("shows the in-app switch of a legally required notice on and disabled", () => {
    renderMatrix();
    for (const type of [
      "content_removed",
      "member_warned",
      "message_image_rejected",
    ]) {
      const inApp = switchFor(type, "inApp");
      expect(inApp.getAttribute("aria-checked")).toBe("true");
      expect(inApp.disabled).toBe(true);
      expect(inApp.getAttribute("aria-describedby")).toBe(
        `row-${type}-desc mandatory-${type}`,
      );
      // Push stays the member's choice.
      expect(switchFor(type, "push").disabled).toBe(false);
    }
    expect(
      screen.getAllByText("Always on: legally required notices"),
    ).toHaveLength(3);
  });

  it("leaves other notices' in-app switch toggleable", () => {
    renderMatrix();
    const inApp = switchFor("report_decided", "inApp");
    expect(inApp.disabled).toBe(false);
    expect(inApp.getAttribute("aria-checked")).toBe("false");
  });
});

describe("ChannelMatrix structure and names (UX-34)", () => {
  it("is a plain table, not an interactive grid", () => {
    renderMatrix();
    const table = screen.getByRole("table", {
      name: "Notification channels by type",
    });
    expect(table.querySelector('[role="grid"], [role="gridcell"]')).toBeNull();
    expect(table.querySelectorAll('[role="cell"]').length).toBeGreaterThan(0);
  });

  it("names a switch by the type title and channel only; the description describes it", () => {
    renderMatrix();
    const push = switchFor("trade_request", "push");
    expect(textOf(push.getAttribute("aria-labelledby"))).toBe(
      `${en.notifications.types.trade_request} Push`,
    );
    expect(textOf(push.getAttribute("aria-describedby"))).toBe(
      en.notifications.typeDesc.trade_request,
    );
  });

  it("says visibly why email is off for a type that never emails, and ties it to the switch", () => {
    renderMatrix();
    const email = switchFor("exchange_proposed", "email");
    expect(email.disabled).toBe(true);
    const note = document.getElementById("email-na-exchange_proposed");
    expect(note?.textContent).toBe(en.notifications.emailUnavailableShort);
    expect(email.getAttribute("aria-describedby")).toBe(
      "row-exchange_proposed-desc email-na-exchange_proposed",
    );
    // The other channels of that row do not carry the email note.
    expect(
      switchFor("exchange_proposed", "push").getAttribute("aria-describedby"),
    ).toBe("row-exchange_proposed-desc");
  });

  it("shows no email note on a type that can be emailed", () => {
    renderMatrix();
    expect(document.getElementById("email-na-trade_request")).toBeNull();
    expect(switchFor("trade_request", "email").disabled).toBe(false);
  });
});
