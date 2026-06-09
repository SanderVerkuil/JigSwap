import { makeCreatePersonalCategory, type OwnerId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { noopEventPublisher } from "./adapters/eventPublisher";
import { convexPersonalCategoryRepository } from "./adapters/convexPersonalCategoryRepository";
import { personalCategoryIdGenerator } from "./adapters/idGenerators";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for creating a personal category. Enforces (owner, name) uniqueness in the
// use case; returns the new PersonalCategoryId (aggregateId).
export const createPersonalCategory = mutation({
  args: {
    name: v.string(),
    color: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerId = (await requireMember(ctx)) as unknown as OwnerId;

    const create = makeCreatePersonalCategory({
      categories: convexPersonalCategoryRepository(ctx),
      ids: personalCategoryIdGenerator,
      events: noopEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await create({
      ownerId,
      name: args.name,
      color: args.color,
      description: args.description,
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});
