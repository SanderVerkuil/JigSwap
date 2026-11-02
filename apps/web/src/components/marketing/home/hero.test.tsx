// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { Hero, toPlankBox, useHourlySeed } from "./hero";

vi.mock("@/compat/link", () => ({
  Link: ({ href, ...rest }: ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest} />
  ),
}));
vi.mock("@/components/marketing/use-start-href", () => ({
  useStartHref: () => "/sign-up",
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

function Probe() {
  const seed = useHourlySeed();
  return <span>{seed === null ? "skip" : "seeded"}</span>;
}

// The seed a fresh mount (one page visit) gets at the given wall-clock time.
const seedAt = (iso: string) => {
  vi.setSystemTime(new Date(iso));
  const { result, unmount } = renderHook(() => useHourlySeed());
  const seed = result.current;
  unmount();
  return seed;
};

describe("useHourlySeed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("is null on the server so seeded queries stay skipped during SSR", () => {
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>skip</span>");
  });

  it("gives every visit in the same hour the same seed", () => {
    const early = seedAt("2026-10-30T10:00:00.000Z");
    const late = seedAt("2026-10-30T10:59:59.999Z");
    expect(early).not.toBeNull();
    expect(late).toBe(early);
  });

  it("moves to a new seed in the next hour", () => {
    const before = seedAt("2026-10-30T10:59:59.999Z");
    const after = seedAt("2026-10-30T11:00:00.000Z");
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it("keeps one seed for the whole mount, even across the hour boundary", () => {
    vi.setSystemTime(new Date("2026-10-30T10:59:59.000Z"));
    const { result, rerender } = renderHook(() => useHourlySeed());
    const first = result.current;
    vi.setSystemTime(new Date("2026-10-30T11:30:00.000Z"));
    rerender();
    expect(result.current).toBe(first);
  });
});

describe("toPlankBox", () => {
  const puzzle = { title: "Harbour", pieceCount: 1000, brand: "Ravensburger" };

  it("textures the box with the small rendition when there is one", () => {
    const box = toPlankBox(
      {
        ...puzzle,
        image: "https://cdn.test/original",
        thumbUrl: "https://cdn.test/480",
      },
      0,
    );
    expect(box.cover).toBe("https://cdn.test/480");
  });

  it("falls back to the original before renditions exist, and to no cover without box art", () => {
    expect(
      toPlankBox({ ...puzzle, image: "https://cdn.test/original" }, 0).cover,
    ).toBe("https://cdn.test/original");
    expect(toPlankBox({ ...puzzle, image: null }, 0).cover).toBeUndefined();
  });
});

describe("Hero", () => {
  afterEach(cleanup);

  // Answers the hero's Convex reads: the platform count and one member's avatar. The sample
  // plank's puzzles stay unloaded, as on a server render.
  const renderHero = (totalUsers = 0) =>
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: {
                queryFn: ({ queryKey }) => {
                  const fn = String(queryKey[1]);
                  if (fn.includes("getGlobalStats")) return { totalUsers };
                  if (fn.includes("getCommunityAvatars"))
                    return [{ initials: "SV", image: null }];
                  return [];
                },
              },
            },
          })
        }
      >
        <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
          <Hero />
        </IntlProvider>
      </QueryClientProvider>,
    );

  // The plank titles are on the sample boxes. A title can sit in the backdrop and in the phone's
  // plank at once, so these find the plank by how it is shown.
  const planksOf = (container: HTMLElement, selector: string) =>
    [...container.querySelectorAll<HTMLElement>(selector)].filter((el) =>
      el.textContent?.includes("Boslicht"),
    );

  it("puts the phone's plank in the page flow below the copy, not behind it", () => {
    const { container } = renderHero();
    const [plank] = planksOf(container, ".min-\\[768px\\]\\:hidden");
    expect(plank).toBeTruthy();
    const trustRowOrCtas = screen.getByRole("link", {
      name: "See the features",
    });
    expect(
      trustRowOrCtas.compareDocumentPosition(plank) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Sharp: outside the frosted panel, whose blur only applies from 768px up.
    expect(
      plank.closest(".min-\\[768px\\]\\:backdrop-blur-\\[9px\\]"),
    ).toBeNull();
  });

  // The panel ends at x=664 up to 1200px. Measured with a 15px scrollbar and the shelf's overhang
  // counted, a row of three boxes reaches 537 at 1040 and 631 at 1140, and clears the panel from
  // 1175. A catalogue with 9 puzzles clears it sooner, but the first paint and a full one don't.
  it("shows the backdrop's CSS planks only where they clear the copy's panel", () => {
    const { container } = renderHero();
    const stacks = planksOf(container, ".max-\\[1199px\\]\\:hidden");
    expect(stacks).toHaveLength(1);
    // An inline display would beat the class that hides it.
    expect(stacks[0].style.display).toBe("");
  });

  it("sets the lead in the body colour, which holds its contrast over the shelf art", () => {
    renderHero();
    const lead = screen.getByText(en.marketing.home.heroLead);
    expect(lead.className).toContain("text-mk-text-body");
    expect(lead.className).not.toContain("text-mk-text-muted");
  });

  it("shows no one's initials beside the invitation to be among the first", async () => {
    renderHero(1);
    await screen.findByText(en.marketing.home.trustRowEarly);
    // Long enough for the avatars' read to answer, were it asked.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.queryByText("SV")).toBeNull();
  });

  it("shows the members' initials once the count is shown as social proof", async () => {
    renderHero(5000);
    await screen.findByText("SV");
  });
});
