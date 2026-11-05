// Per-route bundle budget for the production build (P-41 guardrail).
//
//   pnpm --filter @jigswap/web bundle:check            after `vite build`
//   pnpm --filter @jigswap/web bundle:check --update   accept the current weights
//
// For every route in bundle-budget.json it sums the gzip size of the JS and CSS
// the route needs on first load (its manifest chain plus the root stylesheet)
// and fails when either is more than `tolerance` over budget. It also fails when
// any route preloads a chunk containing a `forbiddenInInitial` marker (three.js,
// the physics engine, the image cropper), which must only load on idle or on
// request, and when a prerendered document carries an inline script above
// `documents.maxInlineScriptKB` (the dehydrated router state; the message
// catalog must stay out of it). It refuses a build without VITE_CONVEX_URL,
// whose weights are not what ships. It reports the message catalogs' gzip size,
// fetched on every first visit. Raising a budget is a reviewed edit to
// bundle-budget.json, normally via --update.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";
import {
  compareToBudget,
  findForbiddenInitial,
  measureRoutes,
  nextBudget,
  oversizedDocuments,
  UNCONFIGURED_BUILD_MARKER,
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

// Such a build succeeds, but router.tsx throws and the minifier drops the router and the Convex
// client behind the throw, so every route would weigh about 34 KB too little. Stop before --update
// can accept those weights.
const unconfigured = findForbiddenInitial(routes, {
  markers: { "the missing-URL throw": UNCONFIGURED_BUILD_MARKER },
  contentOf: (url) => read(url).toString("utf8"),
});
if (unconfigured.length) {
  fail(
    "this build has no VITE_CONVEX_URL, so its weights are not what ships; build with VITE_CONVEX_URL and VITE_CLERK_PUBLISHABLE_KEY set (placeholders do, see ci.yml)",
  );
}

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

// Prerendered documents (the docs): their inline scripts are the dehydrated
// router state that every SSR page carries too.
let documentProblems = 0;
if (budget.documents) {
  const { maxInlineScriptKB } = budget.documents;
  const htmlFiles = fs
    .readdirSync(publicDir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".html"));
  const documents = htmlFiles.map((file) => ({
    file,
    html: fs.readFileSync(path.join(publicDir, file), "utf8"),
  }));
  const oversized = oversizedDocuments(documents, maxInlineScriptKB);
  const [largest] = oversizedDocuments(documents, 0);
  console.log(
    `Prerendered documents: ${htmlFiles.length}, none may inline a script above ${maxInlineScriptKB} KB` +
      (largest ? ` (largest: ${largest.inlineKB} KB, ${largest.file}).` : "."),
  );
  // Nothing is prerendered until the docs get locale URLs (vite.config.ts), so there is nothing to
  // measure yet. Say so instead of failing: the route budgets above still ran.
  if (htmlFiles.length === 0) {
    console.log(
      "  SKIP no prerendered .html in .output/public; the inline-script guard did not run",
    );
  }
  for (const doc of oversized) {
    documentProblems++;
    console.error(
      `  OVER ${doc.file} inlines a ${doc.inlineKB} KB script; keep messages and other bulk out of the dehydrated state`,
    );
  }
}

// Fetched (and then cached) on every first visit, so worth watching.
const catalogs = fs
  .readdirSync(path.join(publicDir, "assets"))
  .filter((file) => /^(en|nl)-[\w-]+\.json$/.test(file))
  .map(
    (file) =>
      `${file} ${Math.round((gzipSize(`/assets/${file}`) / 1024) * 10) / 10} KB gz`,
  );
console.log(`Message catalogs: ${catalogs.join(", ") || "none found"}`);

if (update) {
  const next = nextBudget(budget, measured);
  fs.writeFileSync(budgetFile, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Wrote ${path.relative(appDir, budgetFile)}.`);
  if (built.length < Object.keys(budget.routes).length) {
    fail("a budgeted route is missing from the build; rename or remove it");
  }
  if (forbidden.length) fail("a route preloads a forbidden chunk");
  if (documentProblems)
    fail("a prerendered document is over its inline-script cap");
} else {
  const over = rows.filter((row) => row.over);
  if (over.length || forbidden.length || documentProblems) {
    fail(
      `${over.length} budget(s) exceeded, ${forbidden.length} forbidden chunk(s) preloaded, ` +
        `${documentProblems} document problem(s). ` +
        "Shrink the route or document, or accept a new route weight with `pnpm --filter @jigswap/web bundle:check --update` in a reviewed commit (the inline-script cap is a hand edit).",
    );
  }
}
