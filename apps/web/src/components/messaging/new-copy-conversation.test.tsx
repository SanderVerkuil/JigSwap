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
import nl from "../../../locales/nl.json";
import { NewCopyConversation } from "./new-copy-conversation";

const mocks = vi.hoisted(() => ({
  view: undefined as unknown,
  navigate: vi.fn(),
  start: vi.fn(),
}));

// The pane's data comes from getCopyConversation; the test feeds the view directly.
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.view, isError: false }),
  useMutation: () => ({ mutateAsync: mocks.start, isPending: false }),
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: () => ({}),
  useConvexMutation: () => vi.fn(),
}));
vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "me" } }),
}));
// Router-free links: the test asserts the rendered DOM, not routing.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const renderPane = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <NewCopyConversation copyId="copy1" />
    </IntlProvider>,
  );

afterEach(() => {
  cleanup();
  mocks.view = undefined;
  mocks.navigate.mockClear();
});

describe("NewCopyConversation — ownerHidden", () => {
  it("explains the owner is private and offers no composer", () => {
    mocks.view = { status: "ownerHidden" };
    renderPane();

    expect(
      screen.getByText(
        "This owner keeps their profile private, so you can't message them from here.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Back to the puzzle" })
        .getAttribute("href"),
    ).toBe("/copies/copy1");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("explains it in Dutch", () => {
    mocks.view = { status: "ownerHidden" };
    renderPane("nl");

    expect(
      screen.getByText(
        "Deze eigenaar heeft een privéprofiel, dus vanaf hier kun je geen bericht sturen.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("NewCopyConversation — unavailable", () => {
  it("says so and offers the next steps instead of a dead end", () => {
    mocks.view = { status: "unavailable" };
    renderPane();

    expect(screen.getByText(en.copyConversation.unavailable)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: en.copyConversation.findACopy })
        .getAttribute("href"),
    ).toBe("/browse");
    // Below the split view the header's back chevron goes the same way.
    const back = screen.getAllByRole("link", {
      name: en.messages.backToInbox,
    });
    expect(back.map((link) => link.getAttribute("href"))).toEqual([
      "/messages",
      "/messages",
    ]);
  });

  it("keeps the self state's single way back", () => {
    mocks.view = { status: "self" };
    renderPane();
    expect(
      screen.queryByRole("link", { name: en.copyConversation.findACopy }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: en.copyConversation.backToPuzzle }),
    ).toBeTruthy();
  });
});

const NEW_VIEW = {
  status: "new",
  canMessage: true,
  owner: {
    anonymous: false,
    member: {
      _id: "u_mara",
      _creationTime: 0,
      name: "Mara",
      isActive: true,
      createdAt: 0,
      updatedAt: 0,
    },
  },
  copy: {
    copyId: "copy1",
    title: "Harbour Lights",
    brand: "Ravensburger",
    pieceCount: 1000,
    coverUrl: null,
  },
};

describe("NewCopyConversation — existing conversation", () => {
  it("opens the DM with the puzzle to attach, replacing this history entry", async () => {
    mocks.view = {
      status: "existing",
      threadId: "thread_1",
      copy: NEW_VIEW.copy,
    };
    renderPane();

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/messages/$threadId",
        params: { threadId: "thread_1" },
        search: { attach: "copy1" },
        replace: true,
      }),
    );
  });
});

describe("NewCopyConversation — composer", () => {
  it("wraps the selection on Ctrl+B and Enter still sends", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    mocks.start.mockResolvedValue("thread_1");
    mocks.view = NEW_VIEW;
    renderPane();
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(input.getAttribute("aria-keyshortcuts")).toContain("Control+B");
    fireEvent.change(input, { target: { value: "is it free" } });
    input.setSelectionRange(6, 10);
    fireEvent.keyDown(input, { key: "b", ctrlKey: true });
    expect(input.value).toBe("is it **free**");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mocks.start).toHaveBeenCalledWith({
        copyId: "copy1",
        body: "is it **free**",
      }),
    );
    vi.restoreAllMocks();
  });
});

describe("NewCopyConversation — Enter on a touch screen", () => {
  it("inserts a line break instead of sending; Ctrl+Enter still sends", async () => {
    const native = window.matchMedia.bind(window);
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
      const list = native(query);
      if (query === "(pointer: coarse)") {
        Object.defineProperty(list, "matches", { value: true });
      }
      return list;
    });
    mocks.start.mockResolvedValue("thread_1");
    mocks.view = NEW_VIEW;
    renderPane();
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(input.getAttribute("enterkeyhint")).toBe("enter");
    fireEvent.change(input, { target: { value: "is it free" } });

    // Not prevented: the browser inserts the line break.
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true);
    expect(mocks.start).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(mocks.start).toHaveBeenCalledWith({
        copyId: "copy1",
        body: "is it free",
      }),
    );
    vi.restoreAllMocks();
  });
});
