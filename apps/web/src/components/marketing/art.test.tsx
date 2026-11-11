import { Art } from "@/components/marketing/art";
import {
  bridgeSrcSet,
  coverSrcSet,
  houseCutMask,
  houseCutSrcSet,
  kitchenTableSrcSet,
} from "@/components/marketing/assets/art/renditions";
import { Hero } from "@/components/marketing/home/hero";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";

vi.mock("@/components/marketing/use-start-link", () => ({
  useStartLink: () => ({ href: "/sign-up", label: "Start your shelf" }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/marketing-queries", () => ({
  globalStatsQuery: {},
  hasSocialProof: () => false,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
}));

const COVERS = import.meta.glob<string>("./assets/art/covers/*.webp", {
  import: "default",
  eager: true,
});

function art(props: Partial<React.ComponentProps<typeof Art>> = {}) {
  return renderToStaticMarkup(
    <Art
      src="/street.webp"
      width={640}
      height={480}
      alt="A street"
      {...props}
    />,
  );
}

describe("Art", () => {
  it("loads lazily by default", () => {
    const html = art();
    expect(html).toContain('loading="lazy"');
    expect(html).not.toMatch(/fetchpriority/i);
  });

  it("loads first-screen art at once and ahead of the rest", () => {
    const html = art({ priority: true });
    expect(html).toContain('loading="eager"');
    expect(html).toMatch(/fetchpriority="high"/i);
  });

  it("offers its renditions to the browser", () => {
    const html = art({
      srcSet: "/street-320.webp 320w, /street.webp 640w",
      sizes: "50vw",
    });
    expect(html).toMatch(
      /srcset="\/street-320\.webp 320w, \/street\.webp 640w"/i,
    );
    expect(html).toContain('sizes="50vw"');
  });
});

describe("art renditions", () => {
  it("lists each picture's resized files by width, up to the original", () => {
    expect(houseCutSrcSet).toMatch(
      /house-cut-1200\.webp 1200w, \S+house-cut-1600\.webp 1600w, \S+house-cut\.webp 2400w$/,
    );
    expect(kitchenTableSrcSet).toMatch(
      /kitchen-table-800\.webp 800w, \S+kitchen-table-1600\.webp 1600w, \S+kitchen-table\.webp 2400w$/,
    );
    expect(bridgeSrcSet).toMatch(
      /bridge-800\.webp 800w, \S+bridge\.webp 1536w$/,
    );
    expect(houseCutMask).toMatch(/house-cut-mask\.webp$/);
  });

  it("gives every box lid its 320w rendition", () => {
    const lids = Object.entries(COVERS).filter(
      ([path]) => !path.endsWith("-320.webp"),
    );
    expect(lids).toHaveLength(14);
    for (const [path, url] of lids) {
      const name = path.slice(path.lastIndexOf("/") + 1, -".webp".length);
      expect(coverSrcSet(url)).toBe(
        `${COVERS[`./assets/art/covers/${name}-320.webp`]} 320w, ${url} 640w`,
      );
    }
    expect(coverSrcSet("/elsewhere.webp")).toBeUndefined();
  });

  it("serves the hero's house and shelf at the width their slots need", () => {
    const html = renderToStaticMarkup(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Hero />
      </IntlProvider>,
    );
    const images = html.match(/<img[^>]*>/g) ?? [];
    const house = images.find((img) => /fetchpriority/i.test(img));
    expect(house).toContain(`srcSet="${houseCutSrcSet}"`);
    expect(house).toContain('sizes="(max-width: 759px) 200vw, 100vw"');
    const shelf = images.filter((img) => img !== house);
    expect(shelf).not.toHaveLength(0);
    for (const img of shelf) {
      expect(img).toMatch(/srcSet="\S+-320\.webp 320w, \S+\.webp 640w"/);
      expect(img).toContain('sizes="136px"');
    }
  });

  it("masks the hero's dim with the house's alpha alone, not the picture again", () => {
    const html = renderToStaticMarkup(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Hero />
      </IntlProvider>,
    );
    const mask = html.match(/style="[^"]*mask-image[^"]*"/)?.[0];
    expect(mask).toContain(houseCutMask);
    expect(mask).not.toMatch(/house-cut\.webp/);
  });
});
