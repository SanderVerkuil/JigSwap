// The "-" prefix keeps the TanStack route generator from treating this file as a route.
//
// A route file may export only `Route`. The route tree (part of the entry chunk) imports every
// route file, and the router plugin can only move a route's component into a lazy chunk when
// nothing else is exported from it. Any other export (a shared screen, a helper) is pulled into
// the entry together with everything it imports, which once put the image cropper and cmdk into
// every page's first load. Put shared code under src/components or src/lib instead.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routesDir = __dirname;

function routeFiles(): string[] {
  return readdirSync(routesDir, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !/\.(test|spec)\.tsx?$/.test(file))
    .filter(
      (file) => !file.split(path.sep).some((part) => part.startsWith("-")),
    )
    .sort();
}

function exportsOtherThanRoute(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => /^export\b/.test(line))
    .filter((line) => !/^export const Route\b/.test(line));
}

describe("route files", () => {
  it("finds the route files", () => {
    expect(routeFiles()).toContain(
      path.join("_dashboard", "copies", "$id.tsx"),
    );
  });

  it.each(routeFiles())("%s exports only Route", (file) => {
    const source = readFileSync(path.join(routesDir, file), "utf8");
    expect(exportsOtherThanRoute(source)).toEqual([]);
  });

  it("flags every other kind of export", () => {
    expect(
      exportsOtherThanRoute(
        [
          "export const Route = createFileRoute('/x')({});",
          "export function Screen() {}",
          "export { helper };",
          "export default Screen;",
          "export const RouteHelper = 1;",
          "export type Props = {};",
          "  export const nested = 1;",
        ].join("\n"),
      ),
    ).toEqual([
      "export function Screen() {}",
      "export { helper };",
      "export default Screen;",
      "export const RouteHelper = 1;",
      "export type Props = {};",
    ]);
  });
});
