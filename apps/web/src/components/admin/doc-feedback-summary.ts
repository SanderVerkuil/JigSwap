// Groups the raw "Was this page helpful?" votes (gateway.adminTriage.docFeedback)
// into one summary per docs page, so an admin sees which pages need work
// rather than a stream of individual votes. Pure and client-side: it summarises
// whatever rows are loaded, so it keeps working if the listing is paged.

export interface DocFeedbackEntry {
  _id: string;
  slug: string;
  helpful: boolean;
  comment?: string;
  locale?: string;
  createdAt: number;
}

export interface DocFeedbackComment {
  id: string;
  comment: string;
  helpful: boolean;
  locale?: string;
  createdAt: number;
}

export interface DocFeedbackSummary {
  slug: string;
  helpful: number;
  notHelpful: number;
  // notHelpful / all votes, 0..1.
  unhelpfulShare: number;
  // Non-blank comments, newest first.
  comments: DocFeedbackComment[];
}

// Most not-helpful votes first, then the higher unhelpful share, then slug.
export function summarizeDocFeedback(
  entries: readonly DocFeedbackEntry[],
): DocFeedbackSummary[] {
  const bySlug = new Map<string, DocFeedbackSummary>();
  for (const entry of entries) {
    let summary = bySlug.get(entry.slug);
    if (!summary) {
      summary = {
        slug: entry.slug,
        helpful: 0,
        notHelpful: 0,
        unhelpfulShare: 0,
        comments: [],
      };
      bySlug.set(entry.slug, summary);
    }
    if (entry.helpful) summary.helpful += 1;
    else summary.notHelpful += 1;
    const comment = entry.comment?.trim();
    if (comment) {
      summary.comments.push({
        id: entry._id,
        comment,
        helpful: entry.helpful,
        locale: entry.locale,
        createdAt: entry.createdAt,
      });
    }
  }
  const summaries = [...bySlug.values()];
  for (const summary of summaries) {
    summary.unhelpfulShare =
      summary.notHelpful / (summary.helpful + summary.notHelpful);
    summary.comments.sort((a, b) => b.createdAt - a.createdAt);
  }
  return summaries.sort(
    (a, b) =>
      b.notHelpful - a.notHelpful ||
      b.unhelpfulShare - a.unhelpfulShare ||
      a.slug.localeCompare(b.slug),
  );
}
