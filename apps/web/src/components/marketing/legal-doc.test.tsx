// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import { LegalDoc } from "./legal-doc";

afterEach(cleanup);

describe("LegalDoc", () => {
  it("renders a section's action inside that section, after its text", () => {
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <LegalDoc
          updated="Last updated: today"
          intro="Intro"
          sections={[
            {
              id: "p-cookies",
              heading: "Cookies",
              blocks: [{ type: "p", text: "How we use cookies." }],
              action: <button type="button">Change cookie settings</button>,
            },
            {
              id: "p-children",
              heading: "Children",
              blocks: [{ type: "p", text: "Not for children." }],
            },
          ]}
        />
      </IntlProvider>,
    );

    const cookies = document.getElementById("p-cookies");
    expect(cookies).toBeTruthy();
    const action = within(cookies as HTMLElement).getByRole("button", {
      name: "Change cookie settings",
    });
    const text = within(cookies as HTMLElement).getByText(
      "How we use cookies.",
    );
    expect(
      text.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Change cookie settings" }),
    ).toHaveLength(1);
  });
});
