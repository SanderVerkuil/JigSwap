// @vitest-environment happy-dom
import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { TwoLevelReviewFields } from "./two-level-review-fields";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof TwoLevelReviewFields>;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (props: Partial<Props> = {}, locale: "en" | "nl" = "en") =>
  act(() =>
    root.render(
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <TwoLevelReviewFields
          puzzleRating={0}
          onPuzzleRatingChange={() => {}}
          puzzleText=""
          onPuzzleTextChange={() => {}}
          copyRating={0}
          onCopyRatingChange={() => {}}
          showPuzzleSection
          showCopySection={false}
          showUpdatesExisting={false}
          {...props}
        />
      </IntlProvider>,
    ),
  );

describe("TwoLevelReviewFields", () => {
  it("limits the puzzle review text to the server's 2000 characters", () => {
    render();
    expect(container.querySelector("textarea")!.maxLength).toBe(2000);
  });

  it("replaces the puzzle question with a note when the puzzle can't be reviewed", () => {
    render({ showPuzzleSection: false, showCopySection: true });
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain(
      "Only approved puzzles can be reviewed.",
    );
    // The copy question stays.
    expect(container.textContent).toContain("What did you think of this copy?");
  });

  it("says so in Dutch too", () => {
    render({ showPuzzleSection: false }, "nl");
    expect(container.textContent).toContain(
      "Je kunt alleen goedgekeurde puzzels beoordelen.",
    );
  });
});
