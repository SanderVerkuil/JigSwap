import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../../locales/en.json";
import { PuzzlePlank3D } from "./index";

const boxes = [{ title: "Sunset", width: 116, height: 144 }];

const ssr = (interactive: boolean, fitHeightBelowMd = false) =>
  renderToStaticMarkup(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <PuzzlePlank3D
        boxes={boxes}
        interactive={interactive}
        fitHeightBelowMd={fitHeightBelowMd}
      />
    </IntlProvider>,
  );

describe("PuzzlePlank3D", () => {
  it("server-renders only the CSS plank without probing window/WebGL", () => {
    // Node test env: no window/document, so a client-snapshot read would throw.
    const html = ssr(false);
    expect(html).not.toContain("<canvas");
    expect(html).toContain('aria-hidden="true"');
  });

  it("only follows the plank's height below md when asked to", () => {
    expect(ssr(false)).not.toContain("max-md:h-");
    expect(ssr(false, true)).toContain(
      "max-md:h-[var(--plank-fit-height,7rem)]",
    );
  });

  it("server-renders the interactive shelf without any 3D control", () => {
    const html = ssr(true);
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("<button");
  });
});
