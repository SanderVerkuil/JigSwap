// zod speeds up object schemas with parsers compiled by `new Function`, after probing once whether
// eval is allowed. In the browser that probe is itself a script-src violation of the
// Content-Security-Policy (lib/csp.ts allows no 'unsafe-eval'), so the report-only policy would
// report one on every page load. Jitless parsing gives the same results without eval, which is
// also what an enforced policy would leave zod with.
//
// The flag must be set before the first schema is built, and chunks build their schemas as they
// load, before any module body of ours could run first. So it ships as an inline script that runs
// before every module (RootDocument in routes/__root.tsx). It writes zod's global config, which
// zod keeps on globalThis.__zod_globalConfig and only creates when missing; zod-jitless.test.ts
// fails if a zod upgrade moves it. The server never runs it and keeps zod's compiled parsers.
export const ZOD_JITLESS_SCRIPT =
  "globalThis.__zod_globalConfig=Object.assign(globalThis.__zod_globalConfig||{},{jitless:true})";
