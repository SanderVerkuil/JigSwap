import { internalMutation } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import {
  chargeBudget,
  enforceRateLimit,
  firecrawlBudget,
} from "../lib/rateLimits";

// The write side of catalog/extractFromUrl (an action has no ctx.db): who may start a URL
// import, and the deployment-wide budget for the paid Firecrawl tier (SEC-21).

/**
 * Admit the acting member to one URL import, before any fetch: only an active member, and at most
 * RATE_LIMITS.urlImport / urlImportDaily of them (admins exempt). Throws requireMember's refusal,
 * or ConvexError({ code: "RateLimited", retryAfterMs }), writing nothing.
 */
export const beginUrlImport = internalMutation({
  args: {},
  handler: async (ctx) => {
    const member = await requireMember(ctx);
    if (await isAdmin(ctx)) return null;
    await enforceRateLimit(ctx, "urlImport", member);
    await enforceRateLimit(ctx, "urlImportDaily", member);
    return null;
  },
});

/** Charge one Firecrawl scrape to the global budget; false (nothing written) when it is spent. */
export const chargeFirecrawl = internalMutation({
  args: {},
  handler: async (ctx) =>
    (await chargeBudget(ctx, firecrawlBudget(process.env))) === null,
});
