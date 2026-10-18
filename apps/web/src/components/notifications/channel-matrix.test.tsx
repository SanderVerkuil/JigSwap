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

// A switch is named by its row header + column header (aria-labelledby).
const switchFor = (type: string, channel: string) =>
  document
    .getElementById(`row-${type}`)!
    .closest('[role="row"]')!
    .querySelector<HTMLButtonElement>(
      `[role="switch"][aria-labelledby="row-${type} col-${channel}"]`,
    )!;

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
      expect(inApp.getAttribute("aria-describedby")).toBe(`mandatory-${type}`);
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
