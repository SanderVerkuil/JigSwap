// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import {
  CsamEscalationsPanel,
  MELDPUNT_OFFLIMITS_URL,
  type CsamEscalations,
} from "./csam-escalations";

vi.mock("@/gateway", () => ({ gateway: {} }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.UTC(2026, 9, 18, 12);

const escalation = (
  overrides: Partial<CsamEscalations["escalations"][number]> = {},
): CsamEscalations["escalations"][number] => ({
  id: "e1" as never,
  table: "ownedPuzzleImages",
  uploaderId: "u1" as never,
  uploaderLabel: "alice",
  md5: "d41d8cd98f00b204e9800998ecf8427e",
  sha1: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
  provider: "offlimits",
  matchedAt: NOW - 3_600_000,
  status: "open",
  reportedAt: null,
  note: null,
  ...overrides,
});

const data = (overrides: Partial<CsamEscalations> = {}): CsamEscalations => ({
  hashCheck: {
    provider: "offlimits",
    status: "ok",
    missingVars: [],
    waitingPhotos: 0,
    oldestWaitingSince: null,
    waitingCap: 200,
  },
  escalations: [escalation()],
  ...overrides,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (
  props: Partial<Parameters<typeof CsamEscalationsPanel>[0]> = {},
  locale: "en" | "nl" = "en",
) =>
  act(() =>
    root.render(
      <IntlProvider
        locale={locale}
        timeZone="UTC"
        now={new Date(NOW)}
        messages={locale === "en" ? en : nl}
      >
        <CsamEscalationsPanel
          data={data()}
          emptyTitle="All clear"
          busy={false}
          onMark={() => {}}
          {...props}
        />
      </IntlProvider>,
    ),
  );

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label),
  );

describe("CsamEscalationsPanel", () => {
  it("tells the operator to report to Meldpunt Offlimits and never shows an image (en/nl)", () => {
    render();
    const text = container.textContent ?? "";
    expect(text).toContain("Report each one to Meldpunt Offlimits");
    expect(text).toContain("Do not try to open, download or share");
    expect(
      container.querySelector(`a[href="${MELDPUNT_OFFLIMITS_URL}"]`),
    ).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(text).toContain("Copy photo");
    expect(text).toContain("alice");
    expect(text).toContain("d41d8cd98f00b204e9800998ecf8427e");

    render({}, "nl");
    expect(container.textContent).toContain("Meld elke match bij Meldpunt");
  });

  it("Mark reported sends the note", () => {
    const onMark = vi.fn();
    render({ onMark });
    const input = container.querySelector("input")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "ref 42");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("Mark reported")!.click());
    expect(onMark).toHaveBeenCalledWith("e1", "reported", "ref 42");
  });

  it("a reported escalation can be closed; a closed one has no actions", () => {
    const onMark = vi.fn();
    render({
      onMark,
      data: data({
        escalations: [
          escalation({ status: "reported", reportedAt: NOW, note: "ref 42" }),
        ],
      }),
    });
    expect(container.textContent).toContain("ref 42");
    expect(button("Mark reported")).toBeUndefined();
    act(() => button("Close")!.click());
    expect(onMark).toHaveBeenCalledWith("e1", "closed");

    render({
      data: data({ escalations: [escalation({ status: "closed" })] }),
    });
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("warns when hash matching is not running", () => {
    render({
      data: data({
        hashCheck: {
          provider: "offlimits",
          status: "missing_config",
          missingVars: ["OFFLIMITS_HCS_PASSWORD"],
          waitingPhotos: 0,
          oldestWaitingSince: null,
          waitingCap: 200,
        },
        escalations: [],
      }),
    });
    expect(container.textContent).toContain("OFFLIMITS_HCS_PASSWORD");
    expect(container.textContent).toContain("No hash matches.");
  });

  it("shows how many photos wait unpublished for an unreachable hash check", () => {
    render({
      data: data({
        hashCheck: {
          provider: "offlimits",
          status: "ok",
          missingVars: [],
          waitingPhotos: 3,
          oldestWaitingSince: NOW - 2 * 3_600_000,
          waitingCap: 200,
        },
      }),
    });
    expect(container.textContent).toContain(
      "Hash check unreachable: 3 photos waiting",
    );
    expect(container.textContent).toContain("2 hours ago");
  });
});
