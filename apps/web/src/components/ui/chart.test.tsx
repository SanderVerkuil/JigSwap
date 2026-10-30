import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChartContainer, ChartStyle, type ChartConfig } from "./chart";

// The chart colours are written into a <style> as raw text. On the server that
// text lands verbatim in the HTML, so anything that can close the element or
// the rule would inject markup or CSS into every viewer's page.
const BREAKOUT = "</style><script>alert(1)</script>";

function styleText(markup: string): string {
  const match = markup.match(/<style>([\s\S]*?)<\/style>/);
  return match?.[1] ?? "";
}

describe("ChartStyle", () => {
  it("writes a colour variable per valid entry, for both themes", () => {
    const markup = renderToStaticMarkup(
      <ChartStyle
        id="chart-a"
        config={{
          value: { label: "Count", color: "var(--chart-1)" },
          hard_2: { theme: { light: "#fff", dark: "hsl(0 0% 10% / 0.5)" } },
          plain: { label: "No colour" },
        }}
      />,
    );

    const css = styleText(markup);
    expect(css).toContain(" [data-chart=chart-a] {");
    expect(css).toContain(".dark [data-chart=chart-a] {");
    expect(css).toContain("--color-value: var(--chart-1);");
    expect(css).toContain("--color-hard_2: #fff;");
    expect(css).toContain("--color-hard_2: hsl(0 0% 10% / 0.5);");
    expect(css).not.toContain("--color-plain");
  });

  it("drops an entry whose key or colour could break out of the style element or rule", () => {
    const config: ChartConfig = {
      value: { color: "var(--chart-1)" },
      [`x${BREAKOUT}`]: { color: "red" },
      "a b": { color: "red" },
      evil: { color: `red;}${BREAKOUT}` },
      rule: { color: "red} body{display:none" },
      quoted: { theme: { light: "#fff", dark: 'url("x")' } },
    };

    const markup = renderToStaticMarkup(
      <ChartStyle id="chart-a" config={config} />,
    );

    expect(markup).not.toContain("<script");
    expect(markup.match(/<\/style>/g)).toHaveLength(1);
    const css = styleText(markup);
    expect(css).toContain("--color-value: var(--chart-1);");
    for (const dropped of ["--color-x", "--color-a", "evil", "rule", "body"]) {
      expect(css).not.toContain(dropped);
    }
    // A themed entry is dropped whole when either theme's colour is unsafe.
    expect(css).not.toContain("--color-quoted");
  });
});

describe("ChartContainer", () => {
  it("reduces the chart id to selector-safe characters and uses it on both ends", () => {
    const markup = renderToStaticMarkup(
      <ChartContainer
        id={`a]{}${BREAKOUT}`}
        config={{ value: { color: "var(--chart-1)" } }}
      >
        <svg />
      </ChartContainer>,
    );

    expect(markup).not.toContain("<script");
    const attr = markup.match(/data-chart="([^"]*)"/)?.[1];
    expect(attr).toMatch(/^chart-[a-z0-9_-]+$/i);
    expect(styleText(markup)).toContain(` [data-chart=${attr}] {`);
  });
});
