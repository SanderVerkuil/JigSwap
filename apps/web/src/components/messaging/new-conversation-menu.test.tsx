// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { NewConversationMenu } from "./new-conversation-menu";

const mocks = vi.hoisted(() => ({
  isMobile: false,
  navigate: vi.fn(),
  openCircleThread: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mocks.isMobile }));
// The picker lists myCircles; picking one runs openCircleThread then navigates.
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [
      {
        _id: "c1",
        aggregateId: "circle1",
        name: "Puzzle pals",
        memberCount: 3,
        iconUrl: null,
      },
    ],
  }),
  useMutation: () => ({
    mutateAsync: mocks.openCircleThread,
    isPending: false,
  }),
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: () => ({}),
  useConvexMutation: () => vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const renderMenu = () =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <NewConversationMenu />
    </IntlProvider>,
  );

const pickCircle = () =>
  fireEvent.click(screen.getByRole("button", { name: /Puzzle pals/ }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.isMobile = false;
});

describe("NewConversationMenu — circle picker", () => {
  it("closes the desktop dialog once the circle chat opens", async () => {
    mocks.openCircleThread.mockResolvedValue("thread1");
    renderMenu();

    const trigger = screen.getByRole("button", { name: "New conversation" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Circle chat" }),
    );
    expect(await screen.findByRole("dialog")).toBeTruthy();

    pickCircle();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/messages/$threadId",
      params: { threadId: "thread1" },
    });
  });

  it("closes the phone sheet once the circle chat opens", async () => {
    mocks.isMobile = true;
    mocks.openCircleThread.mockResolvedValue("thread1");
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    fireEvent.click(await screen.findByRole("button", { name: "Circle chat" }));

    pickCircle();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.navigate).toHaveBeenCalled();
  });

  it("keeps the picker open when opening fails", async () => {
    mocks.openCircleThread.mockRejectedValue(new Error("nope"));
    renderMenu();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "New conversation" }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Circle chat" }),
    );
    pickCircle();

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
