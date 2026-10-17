import matter from "gray-matter";
import {
  parseWhatsNewFrontmatter,
  WHATS_NEW_FILE_NAME,
  type WhatsNewFrontmatter,
} from "./frontmatter";
import { compileWhatsNewBody } from "./markdown";
import type {
  WhatsNewEntry,
  WhatsNewLocale,
  WhatsNewLocalizedContent,
} from "./types";

export interface WhatsNewSourceFile {
  /** File name inside docs/whats-new, e.g. "2026-10-20-households.en.md". */
  name: string;
  raw: string;
}

export interface LoadedWhatsNew {
  entries: WhatsNewEntry[];
  warnings: string[];
}

// Every content problem found in one pass, so an author fixes them all at once.
export class WhatsNewContentError extends Error {
  constructor(readonly problems: string[]) {
    super(`[whats-new] invalid content:\n- ${problems.join("\n- ")}`);
    this.name = "WhatsNewContentError";
  }
}

interface ParsedFile {
  name: string;
  date: string; // from the file name
  fm: WhatsNewFrontmatter;
  html: string;
}

// Fields that describe the entry rather than its wording: they must agree across locales.
const invariantOf = (fm: WhatsNewFrontmatter) => ({
  id: fm.id,
  publishedAt: fm.publishedAt,
  category: fm.category,
  highlight: fm.highlight,
  notify: fm.notify,
  tour: fm.tour,
  image: fm.image,
  ctaTo: fm.cta?.to,
});

const contentOf = (
  file: ParsedFile,
  fallback: boolean,
): WhatsNewLocalizedContent => ({
  title: file.fm.title,
  summary: file.fm.summary,
  html: file.html,
  ...(file.fm.imageAlt ? { imageAlt: file.fm.imageAlt } : {}),
  ...(file.fm.cta ? { ctaLabel: file.fm.cta.label } : {}),
  fallback,
});

async function parseFile(
  name: string,
  raw: string,
  date: string,
  problems: string[],
): Promise<ParsedFile | null> {
  // gray-matter caches by input string and its YAML may yield Dates; both are fine here.
  const { content, data } = matter(raw);
  const result = parseWhatsNewFrontmatter(data);
  if (!result.ok) {
    problems.push(...result.problems.map((p) => `${name}: ${p}`));
    return null;
  }
  const publishedDate = new Date(result.data.publishedAt)
    .toISOString()
    .slice(0, 10);
  if (publishedDate !== date) {
    problems.push(
      `${name}: publishedAt (${publishedDate} UTC) must match the file name date ${date}`,
    );
    return null;
  }
  try {
    return {
      name,
      date,
      fm: result.data,
      html: await compileWhatsNewBody(content),
    };
  } catch (error) {
    problems.push(`${name}: ${(error as Error).message}`);
    return null;
  }
}

// Validate and render the docs/whats-new Markdown into entries (newest first). Throws a
// WhatsNewContentError listing every problem; a missing nl translation is only a warning.
export async function loadWhatsNewEntries(
  files: readonly WhatsNewSourceFile[],
): Promise<LoadedWhatsNew> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const groups = new Map<string, Partial<Record<WhatsNewLocale, ParsedFile>>>();
  const failed = new Set<string>();

  for (const { name, raw } of files) {
    const match = WHATS_NEW_FILE_NAME.exec(name);
    if (!match) {
      problems.push(
        `${name}: file name must match <yyyy-mm-dd>-<kebab-slug>.<en|nl>.md`,
      );
      continue;
    }
    const [, date, slug, locale] = match;
    const base = `${date}-${slug}`;
    const parsed = await parseFile(name, raw, date, problems);
    if (!parsed) {
      failed.add(base);
      continue;
    }
    groups.set(base, { ...groups.get(base), [locale]: parsed });
  }

  const entries: WhatsNewEntry[] = [];
  const seenIds = new Map<string, string>();
  for (const [base, { en, nl }] of groups) {
    if (failed.has(base)) continue; // already reported; don't pile on
    if (!en) {
      problems.push(`${base}: missing en file (en is canonical)`);
      continue;
    }
    if (nl) {
      const a = invariantOf(en.fm);
      const b = invariantOf(nl.fm);
      const differing = (Object.keys(a) as (keyof typeof a)[])
        .filter((key) => a[key] !== b[key])
        .sort();
      if (differing.length > 0) {
        problems.push(`${base}: nl differs from en in ${differing.join(", ")}`);
        continue;
      }
    } else {
      warnings.push(
        `[whats-new] ${base}: no nl translation, falling back to en`,
      );
    }
    const other = seenIds.get(en.fm.id);
    if (other) {
      problems.push(`${base}: duplicate id "${en.fm.id}" (also in ${other})`);
      continue;
    }
    seenIds.set(en.fm.id, base);

    const fm = en.fm;
    entries.push({
      id: fm.id,
      publishedAt: fm.publishedAt,
      category: fm.category,
      highlight: fm.highlight,
      notify: fm.notify,
      ...(fm.tour ? { tour: fm.tour } : {}),
      ...(fm.image ? { image: fm.image } : {}),
      ...(fm.cta ? { ctaTo: fm.cta.to } : {}),
      content: {
        en: contentOf(en, false),
        nl: nl ? contentOf(nl, false) : contentOf(en, true),
      },
    });
  }

  if (problems.length > 0) throw new WhatsNewContentError(problems);

  entries.sort(
    (a, b) => b.publishedAt - a.publishedAt || a.id.localeCompare(b.id),
  );
  return { entries, warnings };
}
