import type { CaptureResult } from "posthog-js";
import { describe, expect, it } from "vitest";
import { sanitizeAnalyticsEvent, stripUrlQuery } from "./analytics-privacy";

const TOKEN = "tok-SECRET-123";
const PAGE = `https://jigswap.site/members/mara?invite=${TOKEN}#join`;

const event = (
  name: string,
  properties: CaptureResult["properties"],
  extra: Partial<CaptureResult> = {},
): CaptureResult => ({ uuid: "u1", event: name, properties, ...extra });

describe("stripUrlQuery", () => {
  it("drops the query string and the fragment", () => {
    expect(stripUrlQuery(PAGE)).toBe("https://jigswap.site/members/mara");
    expect(stripUrlQuery("/circles?invite=abc")).toBe("/circles");
    expect(stripUrlQuery("https://jigswap.site/docs#faq")).toBe(
      "https://jigswap.site/docs",
    );
  });

  it("leaves values without a query alone", () => {
    expect(stripUrlQuery("https://jigswap.site/catalog")).toBe(
      "https://jigswap.site/catalog",
    );
    expect(stripUrlQuery("$direct")).toBe("$direct");
  });
});

describe("sanitizeAnalyticsEvent: URLs", () => {
  it("strips the query from every URL-bearing property, $set and $set_once", () => {
    const result = sanitizeAnalyticsEvent(
      event(
        "$pageview",
        {
          $current_url: PAGE,
          $pathname: "/members/mara",
          $referrer: `https://jigswap.site/circles?invite=${TOKEN}`,
          $session_entry_url: PAGE,
          $session_entry_referrer: PAGE,
          $set: { $current_url: PAGE },
          // Web vitals nest a copy of the page URL per metric.
          $web_vitals_LCP_event: { name: "LCP", value: 1, $current_url: PAGE },
        },
        {
          $set: { $current_url: PAGE },
          $set_once: {
            $initial_current_url: PAGE,
            $initial_referrer: PAGE,
          },
        },
      ),
    );

    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain("#join");
    expect(result?.properties.$current_url).toBe(
      "https://jigswap.site/members/mara",
    );
    expect(result?.properties.$pathname).toBe("/members/mara");
    expect(result?.properties.$web_vitals_LCP_event).toEqual({
      name: "LCP",
      value: 1,
      $current_url: "https://jigswap.site/members/mara",
    });
    expect(result?.$set_once?.$initial_current_url).toBe(
      "https://jigswap.site/members/mara",
    );
  });

  it("strips link targets from autocaptured elements", () => {
    const result = sanitizeAnalyticsEvent(
      event("$autocapture", {
        $pathname: "/household",
        $current_url: "https://jigswap.site/household",
        $external_click_url: `https://example.com/?ref=${TOKEN}`,
        $elements_chain: `a.link:attr__href="/members/mara?invite=${TOKEN}"href="/members/mara?invite=${TOKEN}"nth-child="1"text="Open \\"invite\\""`,
        $elements: [
          {
            tag_name: "a",
            attr__href: `/members/mara?invite=${TOKEN}`,
            $el_text: "Open invite",
          },
        ],
      }),
    );

    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(result?.properties.$external_click_url).toBe("https://example.com/");
    expect(result?.properties.$elements_chain).toBe(
      'a.link:attr__href="/members/mara"href="/members/mara"nth-child="1"text="Open \\"invite\\""',
    );
    expect(result?.properties.$elements).toEqual([
      { tag_name: "a", attr__href: "/members/mara", $el_text: "Open invite" },
    ]);
  });

  it("folds heatmap buckets keyed by a URL with a query into the bare URL", () => {
    const result = sanitizeAnalyticsEvent(
      event("$$heatmap", {
        $heatmap_data: {
          [PAGE]: [{ x: 1 }],
          "https://jigswap.site/members/mara": [{ x: 2 }],
        },
      }),
    );

    expect(result?.properties.$heatmap_data).toEqual({
      "https://jigswap.site/members/mara": [{ x: 1 }, { x: 2 }],
    });
  });

  it("strips page URLs from session-replay markers", () => {
    const fullSnapshot = { type: 2, data: "gzipped-dom" };
    const result = sanitizeAnalyticsEvent(
      event("$snapshot", {
        $snapshot_data: [
          { type: 4, data: { href: PAGE, width: 1, height: 1 } },
          fullSnapshot,
          { type: 5, data: { tag: "$url_changed", payload: { href: PAGE } } },
          {
            type: 6,
            data: {
              plugin: "rrweb/network@1",
              payload: { requests: [{ name: PAGE, duration: 3 }] },
            },
          },
        ],
      }),
    );

    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(result?.properties.$snapshot_data[1]).toBe(fullSnapshot);
  });

  it("leaves non-URL properties untouched, including ones with a '?'", () => {
    const properties = {
      $pathname: "/catalog",
      $el_text: "Swap this one?",
      $referring_domain: "$direct",
      count: 3,
    };
    expect(sanitizeAnalyticsEvent(event("clicked", properties))).toEqual(
      event("clicked", properties),
    );
  });

  it("does not mutate the event it was given", () => {
    const original = event("$pageview", { $current_url: PAGE });
    sanitizeAnalyticsEvent(original);
    expect(original.properties.$current_url).toBe(PAGE);
  });
});

describe("sanitizeAnalyticsEvent: page titles", () => {
  // PostHog copies document.title into every $pageview, and the tab carries the page's own name:
  // a circle, a household, a collection, or the member an admin is looking at.
  it("never lets the tab's title out, whichever event carries it", () => {
    for (const name of ["$pageview", "$pageleave", "$autocapture", "clicked"]) {
      const result = sanitizeAnalyticsEvent(
        event(name, {
          $pathname: "/circles/c1",
          title: "De familie Jansen — JigSwap",
        }),
      );
      expect(result?.properties).toEqual({ $pathname: "/circles/c1" });
    }
  });
});

describe("sanitizeAnalyticsEvent: messaging", () => {
  // A thread's tab title names the other member, and PostHog copies the title onto $pageview.
  it("drops the page title on the messaging screens", () => {
    const result = sanitizeAnalyticsEvent(
      event("$pageview", {
        $pathname: "/messages/thread_1",
        title: "Mara — Messages — JigSwap",
      }),
    );
    expect(result?.properties).toEqual({ $pathname: "/messages/thread_1" });
  });

  it.each(["$autocapture", "$rageclick", "$dead_click", "$copy_autocapture"])(
    "drops %s on the messaging screens",
    (name) => {
      for (const path of ["/messages", "/messages/", "/messages/thread_1"]) {
        expect(
          sanitizeAnalyticsEvent(event(name, { $pathname: path })),
        ).toBeNull();
      }
    },
  );

  it("keeps clicks elsewhere and pageviews on the messaging screens", () => {
    expect(
      sanitizeAnalyticsEvent(event("$autocapture", { $pathname: "/catalog" })),
    ).not.toBeNull();
    expect(
      sanitizeAnalyticsEvent(
        event("$autocapture", { $pathname: "/messages-archive" }),
      ),
    ).not.toBeNull();
    expect(
      sanitizeAnalyticsEvent(
        event("$pageview", { $pathname: "/messages/thread_1" }),
      ),
    ).not.toBeNull();
  });
});
