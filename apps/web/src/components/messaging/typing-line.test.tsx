// @vitest-environment happy-dom
import type { ProjectedMember, TypingView } from "@jigswap/contracts";
import { act, cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { TypingLineView } from "./typing-line";

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
