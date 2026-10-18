import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { adminMemberLabelOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import { readCsamHashCheckConfig } from "../lib/imageModeration/csamHashCheck";

// At most this many escalations per status are listed (newest first).
export const CSAM_ESCALATION_LIST_LIMIT = 100;

// Admin-only list of CSAM hash matches for the operator to report (lib/imageModeration/
// quarantine). METADATA ONLY: never an image URL, thumbnail, blurhash or storage id. The image is
// never shown to anyone, admins included. Also reports whether hash matching is configured on
// this deployment (provider + the NAMES of missing env vars, never values).
export const listCsamEscalations = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const statuses = ["open", "reported", "closed"] as const;
    const escalations = [];
    for (const status of statuses) {
      const rows = await ctx.db
        .query("csamEscalations")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .take(CSAM_ESCALATION_LIST_LIMIT);
      for (const row of rows) {
        const uploader = await ctx.db.get(row.uploaderId);
        escalations.push({
          id: row._id,
          table: row.table,
          uploaderId: row.uploaderId,
          uploaderLabel: uploader ? adminMemberLabelOf(uploader) : null,
          md5: row.md5,
          sha1: row.sha1,
          provider: row.provider,
          matchedAt: row.matchedAt,
          status: row.status,
          reportedAt: row.reportedAt ?? null,
          note: row.note ?? null,
        });
      }
    }
    return { hashCheck: readCsamHashCheckConfig(process.env), escalations };
  },
});
