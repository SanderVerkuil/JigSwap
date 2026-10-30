// @vitest-environment happy-dom
import { gateway } from "@/gateway";
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
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { NewConversationMenu } from "./new-conversation-menu";

const mocks = vi.hoisted(() => ({
  isMobile: false,
  navigate: vi.fn(),
  // Every Convex mutation, by function name.
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastError: vi.fn(),
  // Query results by function name; absent = still loading.
  queries: {} as Record<string, unknown>,
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mocks.isMobile }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ name }: { name: string }) => ({
    data: mocks.queries[name],
    isError: false,
  }),
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (args: unknown) => Promise<unknown>;
  }) => ({ mutateAsync: mutationFn, isPending: false }),
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (ref: Parameters<typeof getFunctionName>[0]) => ({
    name: getFunctionName(ref),
  }),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string;
    search?: Record<string, string>;
    children?: ReactNode;
  }) => (
    <a
      href={search ? `${to}?${new URLSearchParams(search).toString()}` : to}
      {...rest}
    >
      {children}
    </a>
  ),
}));

const OPEN_CIRCLE = getFunctionName(gateway.conversation.openCircleThread);
const OPEN_DM = getFunctionName(gateway.conversation.openDmThread);

const person = (id: string, name: string) => ({
  anonymous: false as const,
  member: {
    _id: id,
    _creationTime: 0,
    name,
    isActive: true,
    createdAt: 0,
    updatedAt: 0,
  },
});

const thread = (threadId: string) => ({
  threadId,
  lastMessage: null,
  unreadCount: 0,
  contextCopies: [],
  updatedAt: 1,
});

const edge = (memberId: string, displayName: string) => ({
  followId: `f_${memberId}`,
  memberId,
  displayName,
  createdAt: 0,
});

// Recent: Mara (DM) and Dirk (exchange); Bas is blocked. Mutual: Eva and Mara
// follow back (Mara is already Recent); Femke doesn't.
const seed = () => {
  mocks.queries = {
    [getFunctionName(gateway.sharing.myCircles)]: [
      {
        _id: "c1",
        aggregateId: "circle1",
        name: "Puzzle pals",
        memberCount: 3,
        iconUrl: null,
      },
    ],
    [getFunctionName(gateway.conversation.getMyInbox)]: [
      {
        ...thread("t_mara"),
        subject: {
          kind: "dm",
          otherMember: person("u_mara", "Mara"),
          profileHandle: "mara",
        },
      },
      {
        ...thread("t_dirk"),
        subject: {
          kind: "exchange",
          exchangeId: "ex1",
          exchangeType: "trade",
          puzzleTitle: "Night Harbour",
          otherMember: person("u_dirk", "Dirk"),
          profileHandle: null,
        },
      },
      {
        ...thread("t_bas"),
        blocked: "byMe",
        subject: {
          kind: "dm",
          otherMember: person("u_bas", "Bas"),
          profileHandle: "bas",
        },
      },
    ],
    [getFunctionName(gateway.social.following)]: [
      edge("u_mara", "Mara"),
      edge("u_eva", "Eva"),
      edge("u_femke", "Femke"),
    ],
    [getFunctionName(gateway.social.followers)]: [
      edge("u_mara", "Mara"),
      edge("u_eva", "Eva"),
    ],
  };
};

const renderMenu = () =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <NewConversationMenu />
    </IntlProvider>,
  );

// Opens a picker from the New menu: the dropdown on desktop, the sheet on phones.
const openPicker = async (option: "Circle chat" | "Message a member") => {
  const trigger = screen.getByRole("button", { name: "New conversation" });
  if (mocks.isMobile) {
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: option }));
  } else {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: option }));
  }
  return screen.findByRole("dialog");
};

const pickCircle = () =>
  fireEvent.click(screen.getByRole("button", { name: /Puzzle pals/ }));

// The names of the picker's rows in one labelled section (each row's last
// child; the avatar before it holds the initial).
const rowNames = (container: HTMLElement, section: string) =>
  within(within(container).getByRole("list", { name: section }))
    .getAllByRole("button")
    .map((button) => button.lastElementChild?.textContent);

beforeEach(() => {
  seed();
  mocks.mutation.mockImplementation(async (name) =>
    name === OPEN_DM ? "dm_thread" : "thread1",
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.isMobile = false;
});

describe("NewConversationMenu — circle picker", () => {
  it("closes the desktop dialog once the circle chat opens", async () => {
    renderMenu();
    await openPicker("Circle chat");

    pickCircle();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.mutation).toHaveBeenCalledWith(OPEN_CIRCLE, {
      circleId: "circle1",
    });
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/messages/$threadId",
      params: { threadId: "thread1" },
    });
  });

  it("closes the phone sheet once the circle chat opens", async () => {
    mocks.isMobile = true;
    renderMenu();
    await openPicker("Circle chat");

    pickCircle();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.navigate).toHaveBeenCalled();
  });

  it("keeps the picker open when opening fails", async () => {
    mocks.mutation.mockRejectedValue(new Error("nope"));
    renderMenu();
    await openPicker("Circle chat");

    pickCircle();

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});

// UX-114: "Message a member" picks someone in place instead of leaving for /people.
describe("NewConversationMenu — member picker", () => {
  it("lists recent partners and mutual followers on desktop, search focused", async () => {
    renderMenu();
    const dialog = await openPicker("Message a member");

    expect(
      within(dialog).getByRole("heading", { name: "Message a member" }),
    ).toBeTruthy();
    const search = within(dialog).getByRole("searchbox", {
      name: "Search members",
    });
    await waitFor(() => expect(document.activeElement).toBe(search));

    expect(rowNames(dialog, "Recent")).toEqual(["Mara", "Dirk"]);
    expect(rowNames(dialog, "You follow each other")).toEqual(["Eva"]);
    expect(within(dialog).queryByText("Bas")).toBeNull();
    expect(within(dialog).queryByText("Femke")).toBeNull();
    expect(
      within(dialog)
        .getByRole("link", { name: "Find someone else" })
        .getAttribute("href"),
    ).toBe("/people?tab=find");
  });

  it("filters by name, ignoring case and accents", async () => {
    renderMenu();
    const dialog = await openPicker("Message a member");
    const search = within(dialog).getByRole("searchbox", {
      name: "Search members",
    });

    fireEvent.change(search, { target: { value: "EV" } });
    expect(within(dialog).queryByRole("list", { name: "Recent" })).toBeNull();
    expect(rowNames(dialog, "You follow each other")).toEqual(["Eva"]);

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(within(dialog).getByText('No one matches "zzz"')).toBeTruthy();
    expect(
      within(dialog).getByRole("link", { name: "Find someone else" }),
    ).toBeTruthy();
  });

  it("opens the DM with the picked member, then closes", async () => {
    renderMenu();
    const dialog = await openPicker("Message a member");

    fireEvent.click(within(dialog).getByRole("button", { name: "Eva" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.mutation).toHaveBeenCalledWith(OPEN_DM, {
      recipientId: "u_eva",
    });
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/messages/$threadId",
      params: { threadId: "dm_thread" },
    });
  });

  it("steps to the picker in the phone sheet, without focusing the search", async () => {
    mocks.isMobile = true;
    renderMenu();
    const sheet = await openPicker("Message a member");

    const search = within(sheet).getByRole("searchbox", {
      name: "Search members",
    });
    expect(document.activeElement).not.toBe(search);
    expect(rowNames(sheet, "Recent")).toEqual(["Mara", "Dirk"]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Dirk" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.mutation).toHaveBeenCalledWith(OPEN_DM, {
      recipientId: "u_dirk",
    });
  });

  it("says why when the member can't be messaged, and stays open", async () => {
    mocks.mutation.mockRejectedValue(
      new ConvexError({ code: "NotConnected", message: "no" }),
    );
    renderMenu();
    const dialog = await openPicker("Message a member");

    fireEvent.click(within(dialog).getByRole("button", { name: "Eva" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(en.messages.notConnected),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("falls back to the generic error for any other refusal", async () => {
    mocks.mutation.mockRejectedValue(
      new ConvexError({ code: "SomethingNew", message: "no" }),
    );
    renderMenu();
    const dialog = await openPicker("Message a member");

    fireEvent.click(within(dialog).getByRole("button", { name: "Mara" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(en.messages.openError),
    );
  });

  it("points to People when there is no one to pick", async () => {
    mocks.queries[getFunctionName(gateway.conversation.getMyInbox)] = [];
    mocks.queries[getFunctionName(gateway.social.followers)] = [];
    renderMenu();
    const dialog = await openPicker("Message a member");

    expect(
      within(dialog).getByText(en.messages.memberPicker.empty),
    ).toBeTruthy();
    expect(within(dialog).queryByRole("searchbox")).toBeNull();
    expect(
      within(dialog)
        .getByRole("link", { name: "Find members" })
        .getAttribute("href"),
    ).toBe("/people?tab=find");
  });
});
