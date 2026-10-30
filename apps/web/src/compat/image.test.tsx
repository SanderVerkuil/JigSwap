import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Image } from "./image";

describe("Image", () => {
  it("lazy-loads by default", () => {
    const html = renderToStaticMarkup(<Image src="/a.png" alt="" />);
    expect(html).toContain('loading="lazy"');
    expect(html).not.toMatch(/fetchpriority/i);
  });

  it("loads a priority (above the fold) image eagerly and first", () => {
    const html = renderToStaticMarkup(
      <Image src="/a.png" alt="" width={28} height={28} priority />,
    );
    expect(html).toContain('loading="eager"');
    // HTML attribute names are case-insensitive; React writes fetchPriority.
    expect(html).toMatch(/<img[^>]* fetchpriority="high"/i);
    expect(html).toContain('width="28"');
    expect(html).toContain('height="28"');
  });
});
