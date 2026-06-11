#!/usr/bin/env node
/**
 * Renders the PR comment for the reports workflow from summary.json
 * (written by render-pr-index.mjs).
 *
 * Usage: node render-reports-comment.mjs <path-to-summary.json>
 * Env (passed via env: in the workflow, never inlined into run:):
 *   PAGES_BASE — base URL of the per-PR Pages dir, e.g.
 *                https://owner.github.io/repo/pr-16
 * Writes markdown to stdout.
 */
import { readFileSync } from "node:fs";

export const MARKER = "<!-- pr-reports -->";

const [, , summaryPath] = process.argv;
const { PAGES_BASE } = process.env;

let summary = {};
try {
  summary = JSON.parse(readFileSync(summaryPath, "utf8"));
} catch {
  // Headline numbers are optional; links below still work without them.
}

const shaNote = summary.headSha
  ? ` for \`${summary.headSha.slice(0, 7)}\``
  : "";
const kb = (b) => `${(b / 1024).toFixed(1)} kB`;

const headline = [
  summary.coverage?.domain != null &&
    `**domain** ${summary.coverage.domain}% lines`,
  summary.coverage?.backend != null &&
    `**backend** ${summary.coverage.backend}% lines`,
  summary.bundleGzipBytes != null &&
    `**client bundle** ${kb(summary.bundleGzipBytes)} gz`,
]
  .filter(Boolean)
  .join(" · ");

const link = (path, label) =>
  PAGES_BASE ? `[${label}](${PAGES_BASE}/${path})` : label;

process.stdout.write(
  [
    MARKER,
    "## 📋 CI Reports",
    "",
    `${link("index.html", "📑 Report index")}${shaNote}${headline ? ` — ${headline}` : ""}`,
    "",
    [
      link("coverage/domain/index.html", "coverage: domain"),
      link("coverage/backend/index.html", "coverage: backend"),
      link("bundle/stats.html", "bundle treemap"),
      link("deps/domain-deps.html", "dependency graph"),
    ].join(" · "),
    "",
    "<sub>Mutation testing reports separately (only when packages/domain changes). Reports are republished on every push.</sub>",
  ].join("\n") + "\n",
);
