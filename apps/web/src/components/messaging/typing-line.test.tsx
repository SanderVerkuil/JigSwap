// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import type { ProjectedMember, TypingView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { TypingLine, TypingLineView } from "./typing-line";

const member = (name: string): ProjectedMember => ({
  anonymous: false,
  member: {
    _id: `member_${name}` as never,
    _creationTime: 0,
    name,
    isActive: true,
    createdAt: 0,
    updatedAt: 0,
  },
});

const typer = (name: string, ageMs = 0): TypingView => ({
  member: member(name),
  ageMs,
});

const renderLine = (typers: TypingView[], locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <TypingLineView typers={typers} />
    </IntlProvider>,
  );

const line = () => screen.getByTestId("typing-line");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TypingLineView", () => {
  it.each([
    [[typer("Anna")], "Anna is typing…"],
    [[typer("Anna"), typer("Bas")], "Anna and Bas are typing…"],
    [[typer("Anna"), typer("Bas"), typer("Cas")], "Several people are typing…"],
  ])("names the typers in English (%#)", (typers, text) => {
    renderLine(typers);
    expect(line().textContent).toBe(text);
  });

  it.each([
    [[typer("Anna")], "Anna typt…"],
    [[typer("Anna"), typer("Bas")], "Anna en Bas typen…"],
    [[typer("Anna"), typer("Bas"), typer("Cas")], "Meerdere mensen typen…"],
  ])("names the typers in Dutch (%#)", (typers, text) => {
    renderLine(typers, "nl");
    expect(line().textContent).toBe(text);
  });

  it("labels a hidden member without naming them", () => {
    renderLine([
      { member: { anonymous: true, anonRef: "ref_1" }, ageMs: 0 },
      {
        member: { anonymous: true, anonRef: "ref_2", departed: true },
        ageMs: 0,
      },
    ]);
    expect(line().textContent).toBe(
      `${en.messages.anonymous} and ${en.messages.deletedMember} are typing…`,
    );
  });

  it("is never announced, and keeps its slot while nobody types", () => {
    renderLine([]);
    expect(line().getAttribute("aria-hidden")).toBe("true");
    expect(line().textContent).toBe("");
    expect(line().className).toContain("h-6");
  });

  it("animates the dots only when motion is welcome", () => {
    renderLine([typer("Anna")]);
    const dots = line().querySelectorAll(".rounded-full");
    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      const animated = [...dot.classList].filter((c) => c.includes("animate"));
      expect(animated).toEqual(["motion-safe:animate-pulse"]);
    }
  });

  it("hides each entry once its age plus the elapsed time reaches 6 s", () => {
    renderLine([typer("Anna", 1_000), typer("Bas", 4_000)]);
    expect(line().textContent).toBe("Anna and Bas are typing…");

    act(() => {
      vi.advanceTimersByTime(1_999);
    });
    expect(line().textContent).toBe("Anna and Bas are typing…");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(line().textContent).toBe("Anna is typing…");

    act(() => {
      vi.advanceTimersByTime(2_999);
    });
    expect(line().textContent).toBe("Anna is typing…");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(line().textContent).toBe("");
  });

  it("restarts the clock when a fresh list arrives", () => {
    const view = renderLine([typer("Anna", 5_000)]);
    act(() => {
      vi.advanceTimersByTime(900);
    });
    view.rerender(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <TypingLineView typers={[typer("Anna", 0)]} />
      </IntlProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(5_999);
    });
    expect(line().textContent).toBe("Anna is typing…");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(line().textContent).toBe("");
  });
});

describe("TypingLine", () => {
  let visibility: DocumentVisibilityState = "visible";
  const setVisibility = (state: DocumentVisibilityState) => {
    visibility = state;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  };

  beforeEach(() => {
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  // A query client whose getTyping for thread_1 already holds Anna; any other
  // query never resolves.
  const renderWithData = () => {
    const convexQueryClient = new ConvexQueryClient(
      new ConvexReactClient("https://example.convex.cloud"),
    );
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          queryKeyHashFn: convexQueryClient.hashFn(),
          staleTime: Infinity,
          retry: false,
          queryFn: () => new Promise<never>(() => {}),
        },
      },
    });
    queryClient.setQueryData(
      convexQuery(gateway.conversation.getTyping, { threadId: "thread_1" })
        .queryKey,
      [typer("Anna")],
    );
    render(
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
          <TypingLine threadId="thread_1" />
        </IntlProvider>
      </QueryClientProvider>,
    );
    return { queryClient };
  };

  const observed = (queryClient: QueryClient) =>
    queryClient
      .getQueryCache()
      .find({
        queryKey: convexQuery(gateway.conversation.getTyping, {
          threadId: "thread_1",
        }).queryKey,
      })
      ?.getObserversCount() ?? 0;

  it("shows getTyping's typers while the tab is visible", () => {
    const { queryClient } = renderWithData();
    expect(line().textContent).toBe("Anna is typing…");
    expect(observed(queryClient)).toBe(1);
  });

  it("drops the subscription and shows nothing while the tab is hidden", () => {
    const { queryClient } = renderWithData();
    setVisibility("hidden");
    expect(line().textContent).toBe("");
    expect(observed(queryClient)).toBe(0);

    setVisibility("visible");
    expect(line().textContent).toBe("Anna is typing…");
    expect(observed(queryClient)).toBe(1);
  });

  it("never subscribes when it mounts in a hidden tab", () => {
    visibility = "hidden";
    const { queryClient } = renderWithData();
    expect(line().textContent).toBe("");
    expect(observed(queryClient)).toBe(0);
  });
});
