// Per-route bundle budget for the production build (P-41 guardrail).
//
//   pnpm --filter @jigswap/web bundle:check            after `vite build`
//   pnpm --filter @jigswap/web bundle:check --update   accept the current weights
//
// For every route in bundle-budget.json it sums the gzip size of the JS and CSS
// the route needs on first load (its manifest chain plus the root stylesheet)
// and fails when either is more than `tolerance` over budget. It also fails when
// any route preloads a chunk containing a `forbiddenInInitial` marker (three.js,
// the physics engine), which must only load on idle or on request. Raising a
// budget is a reviewed edit to bundle-budget.json, normally via --update.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";
import {
  compareToBudget,
  findForbiddenInitial,
  measureRoutes,
  nextBudget,
} from "./bundle-budget-core.mjs";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const serverDir = path.join(appDir, ".output/server");
const publicDir = path.join(appDir, ".output/public");
const budgetFile = path.join(appDir, "bundle-budget.json");
const update = process.argv.includes("--update");

function fail(message) {
  console.error(`bundle:check: ${message}`);
  process.exit(1);
}

const manifestFile = fs.existsSync(serverDir)
  ? fs
      .readdirSync(serverDir)
      .find((file) => file.startsWith("_tanstack-start-manifest"))
  : undefined;
if (!manifestFile) {
  fail(
    "no .output/server/_tanstack-start-manifest_*.mjs; run vite build first",
  );
}
const manifestModule = await import(
  pathToFileURL(path.join(serverDir, manifestFile)).href
);
const routes = manifestModule.tsrStartManifest?.().routes;
if (!routes?.__root__) {
  fail(`${manifestFile} has no routes.__root__; the manifest format changed`);
}

// __root.tsx links styles/globals.css?url itself, so it is not in the manifest.
const globalCss = fs
  .readdirSync(path.join(publicDir, "assets"))
  .filter((file) => /^globals-.*\.css$/.test(file))
  .map((file) => `/assets/${file}`);
if (globalCss.length !== 1) {
  fail(`expected one assets/globals-*.css, found ${globalCss.length}`);
}

const assets = new Map();
const read = (url) => {
  if (!assets.has(url)) {
    assets.set(url, fs.readFileSync(path.join(publicDir, url)));
  }
  return assets.get(url);
};
const gzipSize = (url) => zlib.gzipSync(read(url), { level: 9 }).length;

const budget = JSON.parse(fs.readFileSync(budgetFile, "utf8"));
const built = Object.keys(budget.routes).filter((id) => routes[id]);
const measured = measureRoutes(routes, built, { gzipSize, globalCss });
const forbidden = findForbiddenInitial(routes, {
  markers: budget.forbiddenInInitial ?? {},
  contentOf: (url) => read(url).toString("utf8"),
});

const pct = `${Math.round(budget.tolerance * 100)}%`;
console.log(`First-load gzip KB per route (fails above budget +${pct}):`);
const rows = compareToBudget(measured, budget);
for (const row of rows) {
  const status = row.over ? "OVER" : "ok";
  const detail =
    row.actualKB === null
      ? "route missing from the build"
      : `${row.actualKB} / budget ${row.budgetKB} (limit ${row.limitKB})`;
  const files = measured[row.route]?.files ?? "-";
  console.log(
    `  ${status.padEnd(4)} ${row.route.padEnd(26)} ${row.metric.padEnd(7)} ${detail}  [${files} files]`,
  );
}
for (const hit of forbidden) {
  console.error(
    `  OVER ${hit.route} preloads ${hit.file}, which contains ${hit.label}; it must load lazily`,
  );
}

if (update) {
  const next = nextBudget(budget, measured);
  fs.writeFileSync(budgetFile, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Wrote ${path.relative(appDir, budgetFile)}.`);
  if (built.length < Object.keys(budget.routes).length) {
    fail("a budgeted route is missing from the build; rename or remove it");
  }
  if (forbidden.length) fail("a route preloads a forbidden chunk");
} else {
  const over = rows.filter((row) => row.over);
  if (over.length || forbidden.length) {
    fail(
      `${over.length} budget(s) exceeded, ${forbidden.length} forbidden chunk(s) preloaded. ` +
        "Shrink the route, or accept the new weight with `pnpm --filter @jigswap/web bundle:check --update` in a reviewed commit.",
    );
  }
}
