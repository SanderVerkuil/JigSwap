#!/usr/bin/env node
/**
 * Renders a markdown summary of a Stryker mutation report
 * (mutation-testing-report-schema JSON) for use as a PR comment.
 *
 * Usage: node mutation-comment.mjs <path-to-mutation.json>
 * Optional env (passed via env: in the workflow, never inlined into run:):
 *   HEAD_SHA     — PR head commit, shown in the headline
 *   ARTIFACT_URL — upload-artifact URL for the HTML report, linked in footer
 * Writes markdown to stdout. Exits 0 even when the report is missing so the
 * workflow can still post a "run failed" comment.
 */
import { readFileSync } from "node:fs";

export const MARKER = "<!-- stryker-mutation-report -->";
const CONTEXT_GOAL = 95; // per-bounded-context score goal (see MUTATION-TESTING.md)

const [, , reportPath] = process.argv;
const { HEAD_SHA, ARTIFACT_URL } = process.env;
const shaNote = HEAD_SHA ? ` for \`${HEAD_SHA.slice(0, 7)}\`` : "";
const reportLink = ARTIFACT_URL
  ? `Full HTML report: [download artifact](${ARTIFACT_URL}).`
  : "Full HTML report in the workflow artifacts.";

function render() {
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    return [
      MARKER,
      "## 🧬 Mutation Testing",
      "",
      `⚠️ Stryker did not produce a report${shaNote} — the run likely crashed before mutation testing finished. Check the workflow logs.`,
    ].join("\n");
  }

  // detected = Killed + Timeout; undetected = Survived + NoCoverage.
  // Ignored / CompileError / RuntimeError are excluded from the score,
  // matching Stryker's own mutation-score definition.
  const empty = () => ({ killed: 0, timeout: 0, survived: 0, noCoverage: 0 });
  const contexts = new Map();
  const total = empty();

  for (const [file, { mutants }] of Object.entries(report.files ?? {})) {
    // File keys are relative to packages/domain, e.g. "src/catalog/puzzle.ts".
    const context = file.match(/(?:^|\/)src\/([^/]+)\//)?.[1] ?? "(other)";
    const bucket = contexts.get(context) ?? empty();
    contexts.set(context, bucket);
    for (const { status } of mutants) {
      const key = {
        Killed: "killed",
        Timeout: "timeout",
        Survived: "survived",
        NoCoverage: "noCoverage",
      }[status];
      if (!key) continue;
      bucket[key]++;
      total[key]++;
    }
  }

  const score = (b) => {
    const detected = b.killed + b.timeout;
    const valid = detected + b.survived + b.noCoverage;
    return valid === 0 ? null : (detected / valid) * 100;
  };
  const fmt = (s) => (s === null ? "—" : `${s.toFixed(1)}%`);

  const rows = [...contexts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, b]) => {
      const s = score(b);
      const ok = s === null || s >= CONTEXT_GOAL ? "✅" : "❌";
      return `| ${name} | ${fmt(s)} | ${b.killed + b.timeout} | ${b.survived} | ${b.noCoverage} | ${ok} |`;
    });

  const overall = score(total);
  const failing = [...contexts.values()].filter((b) => {
    const s = score(b);
    return s !== null && s < CONTEXT_GOAL;
  }).length;
  const headline =
    failing === 0
      ? `All ${contexts.size} contexts meet the ≥ ${CONTEXT_GOAL}% goal.`
      : `⚠️ ${failing} context${failing === 1 ? "" : "s"} below the ≥ ${CONTEXT_GOAL}% goal.`;

  return [
    MARKER,
    "## 🧬 Mutation Testing",
    "",
    `**Overall score: ${fmt(overall)}**${shaNote} — ${headline}`,
    "",
    `| Context | Score | Detected | Survived | No coverage | ≥ ${CONTEXT_GOAL}% |`,
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    `<sub>Detected = killed + timeout. Score excludes ignored mutants and compile/runtime errors. ${reportLink}</sub>`,
  ].join("\n");
}

process.stdout.write(`${render()}\n`);
