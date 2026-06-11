import type { ExchangeMessageView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";

// Exchange read (thin adapter): the conversation on an exchange, oldest-first, each message carrying
// a resolved sender summary (_id/name/avatar only). Ordering and sender shape match legacy
// exchanges.getExchangeMessages.
export const getExchangeMessages = query({
  args: { exchangeId: v.id("exchanges") },
  handler: async (ctx, args): Promise<ExchangeMessageView[]> => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_exchange", (q) => q.eq("exchangeId", args.exchangeId))
      .collect();

    const withSenders = await Promise.all(
      messages.map(async (message): Promise<ExchangeMessageView> => {
        const sender = await ctx.db.get(message.senderId);
        return {
          _id: message._id,
          _creationTime: message._creationTime,
          exchangeId: message.exchangeId,
          senderId: message.senderId,
          receiverId: message.receiverId,
          content: message.content,
          messageType: message.messageType,
          isRead: message.isRead,
          createdAt: message.createdAt,
          sender: sender
            ? { _id: sender._id, name: sender.name, avatar: sender.avatar }
            : null,
        };
      }),
    );

    return withSenders.sort((a, b) => a.createdAt - b.createdAt);
  },
});
