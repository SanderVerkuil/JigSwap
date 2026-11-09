// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActiveHeading } from "./use-active-heading";

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
