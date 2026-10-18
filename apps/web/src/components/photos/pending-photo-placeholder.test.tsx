import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  blurhashToDataUrl,
  PendingPhotoPlaceholder,
} from "./pending-photo-placeholder";

const render = (
  locale: "en" | "nl",
  blurhash: string | null,
  compact = false,
) =>
  renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      timeZone="UTC"
      messages={locale === "en" ? en : nl}
    >
      <PendingPhotoPlaceholder blurhash={blurhash} compact={compact} />
    </IntlProvider>,
  );

describe("PendingPhotoPlaceholder", () => {
  it("labels the tile and shows the overlay chip (en/nl)", () => {
    const enHtml = render("en", null);
    expect(enHtml).toContain('role="img"');
    expect(enHtml).toContain('aria-label="Pending review"');
    expect(enHtml).toContain(">Pending review<");
    expect(render("nl", null)).toContain(">Wacht op controle<");
  });

  it("never renders a real photo: without a decodable hash there is no <img> at all", () => {
    expect(render("en", null)).not.toContain("<img");
    expect(render("en", "not-a-blurhash")).not.toContain("<img");
  });

  it("compact mode keeps only the icon", () => {
    expect(render("en", null, true)).not.toContain(">Pending review<");
  });

  it("blurhashToDataUrl rejects invalid input", () => {
    expect(blurhashToDataUrl(null)).toBeNull();
    expect(blurhashToDataUrl("nope")).toBeNull();
  });
});
