// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActiveHeading, useRailFollowsActive } from "./use-active-heading";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

// Where each section's top sits in the window; happy-dom has no layout of its own.
let tops: Record<string, number> = {};
const frames: FrameRequestCallback[] = [];

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const top = tops[this.id] ?? 0;
      return { top, bottom: top + 30, y: top } as DOMRect;
    },
  );
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) =>
    frames.push(cb),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  frames.length = 0;
});

function Contents() {
  const [active, pick] = useActiveHeading(items);
  return (
    <>
      {items.map(({ id }) => (
        <section key={id} id={id} />
      ))}
      <output>{active}</output>
      <button type="button" onClick={() => pick("b")}>
        b
      </button>
    </>
  );
}

const scrollTo = (next: Record<string, number>) => {
  tops = next;
  act(() => {
    fireEvent.scroll(window);
    for (const frame of frames.splice(0)) frame(0);
  });
};
const current = () => screen.getByRole("status").textContent;

describe("useActiveHeading", () => {
  it("marks the last section whose top has reached the top of the window", () => {
    tops = { a: -500, b: 90, c: 400 };
    render(<Contents />);
    expect(current()).toBe("b");

    scrollTo({ a: -900, b: -300, c: 120 });
    expect(current()).toBe("c");

    scrollTo({ a: 200, b: 600, c: 900 });
    expect(current()).toBe("a");
  });

  // F18: a jump parks the heading at the top, where a short section leaves the next heading close
  // below it; that next one used to light up instead of the link that was clicked.
  it("keeps a picked section current while it is on screen, then follows the scroll again", () => {
    tops = { a: -500, b: 300, c: 500 };
    render(<Contents />);
    expect(current()).toBe("a");

    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(current()).toBe("b");
    scrollTo({ a: -700, b: 96, c: 132 });
    expect(current()).toBe("b");

    scrollTo({ a: -900, b: -110, c: -70 });
    expect(current()).toBe("c");
  });

  // Holding the pick until it left the bottom of the window kept it lit for up to a screenful while
  // the reader scrolled back up through the sections above it.
  it("lets go of a picked section as soon as the reader scrolls back up", () => {
    tops = { a: -500, b: 300, c: 500 };
    render(<Contents />);

    fireEvent.click(screen.getByRole("button", { name: "b" }));
    scrollTo({ a: -100, b: 96, c: 132 });
    expect(current()).toBe("b");

    scrollTo({ a: 104, b: 300, c: 336 });
    expect(current()).toBe("a");
  });

  it("keeps a picked section current while the reader reads on down from it", () => {
    tops = { a: -500, b: 300, c: 500 };
    render(<Contents />);

    fireEvent.click(screen.getByRole("button", { name: "b" }));
    scrollTo({ a: -700, b: 96, c: 132 });
    scrollTo({ a: -720, b: 76, c: 112 });
    expect(current()).toBe("b");
    // A pixel of rounding is not a scroll back up.
    scrollTo({ a: -719, b: 77, c: 113 });
    expect(current()).toBe("b");
  });
});

// F14: a long article's rail scrolls on its own, and its current entry used to slip out of view.
describe("useRailFollowsActive", () => {
  // A 300px rail at y=100 with 30px entries at 40, 400 and 800px down its list.
  const offsets: Record<string, number> = { a: 40, b: 400, c: 800 };
  let railHeight = 300;

  function Rail({ active }: { active: string }) {
    const ref = React.useRef<HTMLElement>(null);
    useRailFollowsActive(ref, active);
    return (
      <nav ref={ref} id="rail">
        {Object.keys(offsets).map((id) => (
          <a
            key={id}
            id={`entry-${id}`}
            aria-current={active === id ? "true" : undefined}
          >
            {id}
          </a>
        ))}
      </nav>
    );
  }

  beforeEach(() => {
    railHeight = 300;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.id === "rail") {
          return {
            top: 100,
            bottom: 100 + railHeight,
            height: railHeight,
          } as DOMRect;
        }
        const scrolled = document.getElementById("rail")?.scrollTop ?? 0;
        const top = 100 + offsets[this.id.replace("entry-", "")] - scrolled;
        return { top, bottom: top + 30, height: 30 } as DOMRect;
      },
    );
  });

  const rail = () => document.getElementById("rail") as HTMLElement;

  it("scrolls the rail just far enough to show the current entry 24px from its edge", () => {
    const { rerender } = render(<Rail active="a" />);
    expect(rail().scrollTop).toBe(0);

    // c's bottom sits at 930, 554px past the rail's bottom less its margin (376).
    rerender(<Rail active="c" />);
    expect(rail().scrollTop).toBe(554);

    // Back up: b's top (500 - 554 = -54) comes down to 124.
    rerender(<Rail active="b" />);
    expect(rail().scrollTop).toBe(376);
  });

  // The rail's title sits above its first entry, in the same scroll box. Coming back up, the rail
  // stopped 24px above that entry and left the title cut in half.
  it("takes the rail back to its top for the first entry, title and all", () => {
    const { rerender } = render(<Rail active="c" />);
    expect(rail().scrollTop).toBe(554);
    rerender(<Rail active="a" />);
    expect(rail().scrollTop).toBe(0);
  });

  it("leaves the rail alone while the current entry is in view", () => {
    const { rerender } = render(<Rail active="a" />);
    rail().scrollTop = 300;
    rerender(<Rail active="b" />);
    expect(rail().scrollTop).toBe(300);
  });

  it("leaves a hidden rail alone", () => {
    railHeight = 0;
    render(<Rail active="c" />);
    expect(rail().scrollTop).toBe(0);
  });
});
