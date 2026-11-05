// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { NotificationPreferencesPanel } from "./notification-preferences-panel";

// A category header checkbox flips up to 8 settings in one tap, so the panel offers an Undo that
// puts back exactly the settings the tap changed (UX-70).

type Update = { type: string; channel: string; enabled: boolean };

const state = vi.hoisted(() => ({
  preferences: {} as Record<string, Record<string, boolean>>,
  calls: [] as Array<{ name: string; args: { updates?: Update[] } }>,
  failNext: false,
}));

vi.mock("@/compat/clerk", () => ({ useUser: () => ({ user: { id: "u1" } }) }));

vi.mock("@/gateway", () => ({
  gateway: {
    notifications: {
      preferences: "preferences",
      updatePreference: "updatePreference",
      setPreferences: "setPreferences",
    },
    identity: { isAdmin: "isAdmin" },
  },
}));

vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (fn: string) => ({ fn }),
  useConvexMutation:
    (name: string) =>
    async (args: { updates?: Update[] }): Promise<void> => {
      if (state.failNext) {
        state.failNext = false;
        throw new Error("offline");
      }
      state.calls.push({ name, args });
    },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ fn }: { fn: string }) => ({
    data: fn === "preferences" ? state.preferences : false,
  }),
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (args: unknown) => Promise<unknown>;
  }) => ({ mutateAsync: mutationFn, isPending: false }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Push needs a service worker; it is not what these tests are about.
vi.mock("./push-device-section", () => ({ PushDeviceSection: () => null }));
vi.mock("./message-preview-settings", () => ({
  MessagePreviewSettings: () => null,
}));

const TRADE_EMAIL_TYPES = [
  "trade_request",
  "trade_accepted",
  "trade_declined",
  "trade_completed",
  "trade_cancelled",
  "trade_cancelled_member_deleted",
];

const renderPanel = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <NotificationPreferencesPanel />
    </IntlProvider>,
  );

const settle = () => vi.waitFor(() => {});

const lastSuccess = () => {
  const call = vi.mocked(toast.success).mock.calls.at(-1);
  if (!call) throw new Error("no success toast");
  const [message, options] = call;
  return {
    message,
    undo: (options as { action: { label: string; onClick: () => void } })
      .action,
  };
};

beforeEach(() => {
  state.calls = [];
  state.failNext = false;
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  // Only "Trade request" email is on in the Trades category.
  state.preferences = Object.fromEntries(
    TRADE_EMAIL_TYPES.map((type) => [
      type,
      { inApp: true, email: type === "trade_request", push: false },
    ]),
  );
});

afterEach(cleanup);

describe("NotificationPreferencesPanel bulk category toggle", () => {
  it("offers an Undo that restores only the settings the tap changed", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: "Trades — Email" }));
    await settle();

    // The tap turns every email-eligible Trades type on…
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].name).toBe("setPreferences");
    expect(state.calls[0].args.updates).toEqual(
      TRADE_EMAIL_TYPES.map((type) => ({
        type,
        channel: "email",
        enabled: true,
      })),
    );

    // …and says what changed: five were off, one was already on.
    const { message, undo } = lastSuccess();
    expect(message).toBe("Email turned on for 5 notifications");
    expect(undo.label).toBe("Undo");

    undo.onClick();
    await settle();
    expect(state.calls).toHaveLength(2);
    expect(state.calls[1].name).toBe("setPreferences");
    expect(state.calls[1].args.updates).toEqual(
      TRADE_EMAIL_TYPES.filter((type) => type !== "trade_request").map(
        (type) => ({ type, channel: "email", enabled: false }),
      ),
    );
  });

  it("restores a category that was all on after turning it off", async () => {
    for (const type of TRADE_EMAIL_TYPES) {
      state.preferences[type].email = true;
    }
    renderPanel("nl");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Uitwisselingen — E-mail" }),
    );
    await settle();

    const { message, undo } = lastSuccess();
    expect(message).toBe("E-mail uitgezet voor 6 meldingen");
    expect(undo.label).toBe("Ongedaan maken");
    undo.onClick();
    await settle();
    expect(state.calls[1].args.updates).toEqual(
      TRADE_EMAIL_TYPES.map((type) => ({
        type,
        channel: "email",
        enabled: true,
      })),
    );
  });

  it("offers no Undo when the bulk change fails", async () => {
    state.failNext = true;
    renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: "Trades — Email" }));
    await settle();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Could not update the preference. Please try again.",
    );
  });

  it("reports a failed Undo", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: "Trades — Email" }));
    await settle();
    state.failNext = true;
    lastSuccess().undo.onClick();
    await settle();
    expect(toast.error).toHaveBeenCalledWith(
      "Could not update the preference. Please try again.",
    );
  });
});
