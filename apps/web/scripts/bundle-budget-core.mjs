// Pure core of the per-route bundle budget (scripts/bundle-budget.mjs does the I/O).
// A route's first load is the JS its whole chain preloads plus the CSS it links,
// read from TanStack Start's build manifest; sizes are gzip KB.

/**
 * @typedef {{ children?: string[]; preloads?: string[]; css?: string[] }} ManifestRoute
 * @typedef {Record<string, ManifestRoute>} ManifestRoutes
 * @typedef {{ files: number; jsGzKB: number; cssGzKB: number }} RouteWeight
 * @typedef {{ jsGzKB: number; cssGzKB: number }} RouteBudget
 * @typedef {{ maxInlineScriptKB: number }} DocumentBudget
 * @typedef {{ tolerance: number; forbiddenInInitial?: Record<string, string>; documents?: DocumentBudget; routes: Record<string, RouteBudget> }} Budget
 * @typedef {{ route: string; metric: string; budgetKB: number | null; actualKB: number | null; limitKB: number | null; over: boolean }} BudgetRow
 */

/**
 * The message of router.tsx's throw for a missing Convex URL. With a URL set the
 * minifier removes the throw, so only a build without one has this in its bundle.
 */
export const UNCONFIGURED_BUILD_MARKER = "missing VITE_CONVEX_URL envar";

/** @param {number} bytes */
const toKB = (bytes) => Math.round((bytes / 1024) * 10) / 10;

/**
 * JS and CSS a route needs on first load: everything its chain, from
 * __root__ down to the route, preloads or links. Each file once, root first.
 * @param {ManifestRoutes} routes
 * @param {string} routeId
 * @returns {{ js: string[]; css: string[] }}
 */
export function initialAssets(routes, routeId) {
  if (!routes[routeId]) {
    throw new Error(`Route ${routeId} is not in the build manifest`);
  }
  /** @type {Map<string, string>} */
  const parent = new Map();
  for (const [id, route] of Object.entries(routes)) {
    for (const child of route.children ?? []) parent.set(child, id);
  }
  const chain = [];
  for (let id = routeId; id; id = parent.get(id) ?? "") chain.unshift(id);
  const js = new Set();
  const css = new Set();
  for (const id of chain) {
    for (const url of routes[id]?.preloads ?? []) js.add(url);
    for (const url of routes[id]?.css ?? []) css.add(url);
  }
  return { js: [...js], css: [...css] };
}

/**
 * Gzip weight of each route's first load. `globalCss` is the stylesheet the
 * root document links outside the manifest (styles/globals.css?url).
 * @param {ManifestRoutes} routes
 * @param {string[]} routeIds
 * @param {{ gzipSize: (url: string) => number; globalCss: string[] }} io
 * @returns {Record<string, RouteWeight>}
 */
export function measureRoutes(routes, routeIds, { gzipSize, globalCss }) {
  /** @param {string[]} urls */
  const sum = (urls) => urls.reduce((total, url) => total + gzipSize(url), 0);
  /** @type {Record<string, RouteWeight>} */
  const weights = {};
  for (const id of routeIds) {
    const { js, css } = initialAssets(routes, id);
    const allCss = [...new Set([...globalCss, ...css])];
    weights[id] = {
      files: js.length + allCss.length,
      jsGzKB: toKB(sum(js)),
      cssGzKB: toKB(sum(allCss)),
    };
  }
  return weights;
}

/**
 * One row per budgeted route and metric; `over` when the measurement exceeds
 * the budget by more than the tolerance, or the route is no longer built.
 * @param {Record<string, RouteWeight>} measured
 * @param {Budget} budget
 * @returns {BudgetRow[]}
 */
export function compareToBudget(measured, budget) {
  /** @type {BudgetRow[]} */
  const rows = [];
  for (const [route, limits] of Object.entries(budget.routes)) {
    const actual = measured[route];
    if (!actual) {
      rows.push({
        route,
        metric: "route",
        budgetKB: null,
        actualKB: null,
        limitKB: null,
        over: true,
      });
      continue;
    }
    for (const metric of /** @type {const} */ (["jsGzKB", "cssGzKB"])) {
      const budgetKB = limits[metric];
      const limitKB = Math.round(budgetKB * (1 + budget.tolerance) * 10) / 10;
      const actualKB = actual[metric];
      rows.push({
        route,
        metric,
        budgetKB,
        actualKB,
        limitKB,
        over: actualKB > limitKB,
      });
    }
  }
  return rows;
}

/**
 * Chunks that must never be part of any route's first load (three.js, the
 * physics engine and the image cropper load on idle or on request), found by a
 * marker string in their content so the check survives chunk renames. Reported
 * on the route whose own preloads bring the chunk in.
 * @param {ManifestRoutes} routes
 * @param {{ markers: Record<string, string>; contentOf: (url: string) => string }} io
 * @returns {{ route: string; file: string; label: string }[]}
 */
export function findForbiddenInitial(routes, { markers, contentOf }) {
  const hits = [];
  for (const [route, entry] of Object.entries(routes)) {
    for (const file of entry.preloads ?? []) {
      const content = contentOf(file);
      for (const [label, marker] of Object.entries(markers)) {
        if (content.includes(marker)) hits.push({ route, file, label });
      }
    }
  }
  return hits;
}

/**
 * Bytes of the largest inline <script> in an HTML document; scripts with a
 * src don't count. Start dehydrates the router state (root context, loader
 * data) into inline scripts, so a page carrying far more than usual means
 * something large, such as the message catalog, is back in that state.
 * @param {string} html
 * @returns {number}
 */
export function largestInlineScriptBytes(html) {
  let largest = 0;
  for (const [, attributes, body] of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi,
  )) {
    if (/\bsrc\s*=/i.test(attributes)) continue;
    largest = Math.max(largest, new TextEncoder().encode(body).length);
  }
  return largest;
}

/**
 * Documents whose largest inline script is above `maxKB`, largest first.
 * @param {{ file: string; html: string }[]} documents
 * @param {number} maxKB
 * @returns {{ file: string; inlineKB: number }[]}
 */
export function oversizedDocuments(documents, maxKB) {
  return documents
    .map(({ file, html }) => ({ file, bytes: largestInlineScriptBytes(html) }))
    .filter(({ bytes }) => bytes > maxKB * 1024)
    .sort((a, b) => b.bytes - a.bytes)
    .map(({ file, bytes }) => ({ file, inlineKB: toKB(bytes) }));
}

/**
 * The budget file rewritten to the current measurements, each rounded up to a
 * whole KB; settings and the set of budgeted routes stay as they are.
 * @param {Budget} budget
 * @param {Record<string, RouteWeight>} measured
 * @returns {Budget}
 */
export function nextBudget(budget, measured) {
  /** @type {Record<string, RouteBudget>} */
  const routes = {};
  for (const [route, limits] of Object.entries(budget.routes)) {
    const actual = measured[route];
    routes[route] = actual
      ? {
          jsGzKB: Math.ceil(actual.jsGzKB),
          cssGzKB: Math.ceil(actual.cssGzKB),
        }
      : limits;
  }
  return { ...budget, routes };
}
