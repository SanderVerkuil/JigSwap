// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider, type IntlError } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RELATIVE_TIME_UPDATE_INTERVAL_MS,
  useRelativeTime,
} from "./use-relative-time";

const NOW = new Date("2026-01-01T12:00:00Z");

function Probe({ at }: { at: number }) {
  const relativeTime = useRelativeTime();
  return <span data-testid="when">{relativeTime(at)}</span>;
}

function withIntl(children: React.ReactNode, onError: (e: IntlError) => void) {
  return (
    <IntlProvider
      locale="en"
      messages={{}}
      timeZone="Europe/Amsterdam"
      now={NOW}
      onError={onError}
    >
      {children}
    </IntlProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useRelativeTime", () => {
  it("formats against the provider's now without an environment fallback", () => {
    const onError = vi.fn();
    const html = renderToStaticMarkup(
      withIntl(<Probe at={NOW.getTime() - 5 * 60_000} />, onError),
    );
    expect(html).toContain("5 minutes ago");
    expect(onError).not.toHaveBeenCalled();
  });

  it("ticks once a minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const onError = vi.fn();
    render(withIntl(<Probe at={NOW.getTime() - 60_000} />, onError));
    expect(screen.getByTestId("when").textContent).toBe("1 minute ago");

    // Fake timers advance the system clock along with the interval.
    act(() => {
      vi.advanceTimersByTime(RELATIVE_TIME_UPDATE_INTERVAL_MS);
    });
    expect(screen.getByTestId("when").textContent).toBe("2 minutes ago");
    expect(onError).not.toHaveBeenCalled();
  });
});
