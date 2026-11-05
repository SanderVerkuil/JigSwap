import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compareToBudget,
  findForbiddenInitial,
  initialAssets,
  largestInlineScriptBytes,
  measureRoutes,
  nextBudget,
  oversizedDocuments,
  UNCONFIGURED_BUILD_MARKER,
} from "./bundle-budget-core.mjs";

// The shape of TanStack Start's build manifest: each route lists the JS it
// preloads and the CSS it links; a route's first load is its whole chain from
// __root__ down.
const routes = {
  __root__: {
    children: ["/", "/_dashboard"],
    preloads: ["/assets/index.js", "/assets/react.js"],
  },
  "/": { preloads: ["/assets/home.js", "/assets/react.js"] },
  "/_dashboard": {
    children: ["/_dashboard/profile"],
    preloads: ["/assets/shell.js"],
    css: ["/assets/shell.css"],
  },
  "/_dashboard/profile": {
    preloads: ["/assets/profile.js", "/assets/plank.js"],
  },
};

const KB = 1024;
const sizes: Record<string, number> = {
  "/assets/index.js": 100 * KB,
  "/assets/react.js": 50 * KB,
  "/assets/home.js": 10 * KB,
  "/assets/shell.js": 40 * KB,
  "/assets/shell.css": 2 * KB,
  "/assets/profile.js": 8 * KB,
  "/assets/plank.js": 2 * KB,
  "/assets/globals.css": 30 * KB,
};
const gzipSize = (url: string) => {
  const size = sizes[url];
  if (size === undefined) throw new Error(`unexpected asset ${url}`);
  return size;
};

describe("initialAssets", () => {
  it("unions the preloads and CSS of the route's whole chain, once each", () => {
    expect(initialAssets(routes, "/_dashboard/profile")).toEqual({
      js: [
        "/assets/index.js",
        "/assets/react.js",
        "/assets/shell.js",
        "/assets/profile.js",
        "/assets/plank.js",
      ],
      css: ["/assets/shell.css"],
    });
    expect(initialAssets(routes, "/").js).toEqual([
      "/assets/index.js",
      "/assets/react.js",
      "/assets/home.js",
    ]);
  });

  it("refuses a route the build does not have", () => {
    expect(() => initialAssets(routes, "/gone")).toThrow(/\/gone/);
  });
});

describe("measureRoutes", () => {
  it("sums gzip KB per route, counting the root stylesheet on every route", () => {
    expect(
      measureRoutes(routes, ["__root__", "/_dashboard/profile"], {
        gzipSize,
        globalCss: ["/assets/globals.css"],
      }),
    ).toEqual({
      __root__: { files: 3, jsGzKB: 150, cssGzKB: 30 },
      "/_dashboard/profile": { files: 7, jsGzKB: 200, cssGzKB: 32 },
    });
  });
});

describe("compareToBudget", () => {
  const measured = {
    __root__: { files: 3, jsGzKB: 105, cssGzKB: 30 },
    "/": { files: 4, jsGzKB: 105.1, cssGzKB: 30 },
  };

  it("passes up to the tolerance and fails above it", () => {
    const rows = compareToBudget(measured, {
      tolerance: 0.05,
      routes: {
        __root__: { jsGzKB: 100, cssGzKB: 30 },
        "/": { jsGzKB: 100, cssGzKB: 30 },
      },
    });
    expect(rows.filter((row) => row.over)).toEqual([
      {
        route: "/",
        metric: "jsGzKB",
        budgetKB: 100,
        actualKB: 105.1,
        limitKB: 105,
        over: true,
      },
    ]);
    expect(rows).toHaveLength(4);
  });

  it("fails a budgeted route that is missing from the measurement", () => {
    const rows = compareToBudget(measured, {
      tolerance: 0.05,
      routes: { "/renamed": { jsGzKB: 100, cssGzKB: 30 } },
    });
    expect(rows).toEqual([
      expect.objectContaining({ route: "/renamed", over: true }),
    ]);
  });
});

describe("findForbiddenInitial", () => {
  const contents: Record<string, string> = {
    "/assets/index.js": "app",
    "/assets/react.js": "react",
    "/assets/home.js": "home",
    "/assets/shell.js": "shell",
    "/assets/profile.js": "profile; import('./physics.js')",
    "/assets/plank.js": "renderer.isWebGLRenderer",
    "/assets/physics.js": "RigidBodyDesc",
  };

  it("flags a heavy chunk that a route preloads, and only that route", () => {
    expect(
      findForbiddenInitial(routes, {
        markers: {
          "three.js": "isWebGLRenderer",
          "rapier physics": "RigidBodyDesc",
        },
        contentOf: (url: string) => contents[url] ?? "",
      }),
    ).toEqual([
      {
        route: "/_dashboard/profile",
        file: "/assets/plank.js",
        label: "three.js",
      },
    ]);
  });
});

describe("UNCONFIGURED_BUILD_MARKER", () => {
  // Rewording that throw must not quietly turn the check off.
  it("is the message router.tsx throws on a missing Convex URL", () => {
    const router = readFileSync(`${__dirname}/../src/router.tsx`, "utf8");
    expect(router).toContain(`throw new Error("${UNCONFIGURED_BUILD_MARKER}")`);
  });
});

describe("nextBudget", () => {
  it("rounds each measurement up to a whole KB and keeps the settings", () => {
    const budget = {
      tolerance: 0.05,
      forbiddenInInitial: { "three.js": "isWebGLRenderer" },
      routes: {
        "/": { jsGzKB: 1, cssGzKB: 1 },
        __root__: { jsGzKB: 1, cssGzKB: 1 },
      },
    };
    expect(
      nextBudget(budget, {
        __root__: { files: 3, jsGzKB: 150.2, cssGzKB: 30 },
        "/": { files: 4, jsGzKB: 160.9, cssGzKB: 30.01 },
      }),
    ).toEqual({
      tolerance: 0.05,
      forbiddenInInitial: { "three.js": "isWebGLRenderer" },
      routes: {
        "/": { jsGzKB: 161, cssGzKB: 31 },
        __root__: { jsGzKB: 151, cssGzKB: 30 },
      },
    });
  });
});

describe("largestInlineScriptBytes", () => {
  it("measures the biggest inline script in bytes, ignoring scripts with a src", () => {
    const html = [
      "<html><head>",
      '<script type="module" src="/assets/index.js"></script>',
      '<script src="/assets/big.js">ignored body</script>',
      "<script>self.$R=[]</script>",
      '<SCRIPT class="$tsr">$_TSR.router={"locale":"nl","x":"é"}</SCRIPT>',
      "</head><body></body></html>",
    ].join("");
    expect(largestInlineScriptBytes(html)).toBe(
      new TextEncoder().encode('$_TSR.router={"locale":"nl","x":"é"}').length,
    );
  });

  it("is zero for a document without inline scripts", () => {
    expect(largestInlineScriptBytes('<script src="/a.js"></script>')).toBe(0);
  });

  it("recognises an end tag with whitespace or attributes", () => {
    expect(largestInlineScriptBytes("<script>abc</script >")).toBe(3);
    expect(largestInlineScriptBytes("<script>abcd</script foo>")).toBe(4);
  });
});

describe("oversizedDocuments", () => {
  const doc = (file: string, bytes: number) => ({
    file,
    html: `<script>${"x".repeat(bytes)}</script>`,
  });

  it("flags the documents whose largest inline script is above the cap, largest first", () => {
    expect(
      oversizedDocuments(
        [
          doc("docs/index.html", 4 * KB),
          doc("docs/a/index.html", 64 * KB),
          doc("docs/b/index.html", 200 * KB),
          doc("docs/c/index.html", 64 * KB + 103),
        ],
        64,
      ),
    ).toEqual([
      { file: "docs/b/index.html", inlineKB: 200 },
      { file: "docs/c/index.html", inlineKB: 64.1 },
    ]);
  });
});
