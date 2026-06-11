#!/usr/bin/env node
/**
 * Maintains the root of the gh-pages site: prunes report directories of
 * closed PRs (and any unknown top-level entries) and regenerates the root
 * index.html listing the remaining PRs.
 *
 * Usage: node render-root-index.mjs <gh-pages-checkout-dir>
 * Env (passed via env: in the workflow, never inlined into run:):
 *   OPEN_PRS — comma-separated open PR numbers, e.g. "16,21"
 *   REPO     — owner/name, used for PR links
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const [, , pagesDir] = process.argv;
const { OPEN_PRS = "", REPO = "" } = process.env;

const open = new Set(
  OPEN_PRS.split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s)),
);

// Everything else at the top level (legacy layouts, closed PRs) is pruned.
// .git is the checkout's own metadata (a file in worktrees, a dir in CI).
const KEEP = new Set([".git", ".nojekyll", "index.html", "main"]);

const kept = [];
for (const entry of readdirSync(pagesDir, { withFileTypes: true })) {
  if (KEEP.has(entry.name)) continue;
  const prMatch = entry.name.match(/^pr-(\d+)$/);
  if (prMatch && open.has(prMatch[1])) {
    kept.push(Number(prMatch[1]));
    continue;
  }
  console.error(`pruning ${entry.name}`);
  rmSync(join(pagesDir, entry.name), { recursive: true, force: true });
}
kept.sort((a, b) => b - a);

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const rows = kept
  .map((n) => {
    let meta = {};
    try {
      meta = JSON.parse(
        readFileSync(join(pagesDir, `pr-${n}`, "summary.json"), "utf8"),
      );
    } catch {
      // summary.json is best-effort metadata; the link works without it.
    }
    const sha = meta.headSha
      ? ` · <code>${esc(meta.headSha.slice(0, 7))}</code>`
      : "";
    const when = meta.generatedAt
      ? ` · ${esc(meta.generatedAt.slice(0, 10))}`
      : "";
    const prLink = REPO
      ? ` · <a href="https://github.com/${esc(REPO)}/pull/${n}">PR ↗</a>`
      : "";
    return `      <li><a href="./pr-${n}/index.html">PR #${n}</a>${sha}${when}${prLink}</li>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>JigSwap CI reports</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 46rem; margin: 3rem auto; padding: 0 1rem; color: #1f2328; }
    h1 { font-size: 1.4rem; }
    li { margin: 0.5rem 0; }
    a { color: #0969da; }
    .empty { color: #59636e; }
  </style>
</head>
<body>
  <h1>JigSwap CI reports</h1>
  ${kept.length ? `<ul>\n${rows}\n  </ul>` : `<p class="empty">No open PRs with reports.</p>`}
  ${existsSync(join(pagesDir, "main")) ? `<p><a href="./main/">main branch baselines</a></p>` : ""}
</body>
</html>
`;
writeFileSync(join(pagesDir, "index.html"), html);
console.error(`root index.html written (${kept.length} open PR dirs kept)`);
