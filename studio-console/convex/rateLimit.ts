import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { consumeFromBucket } from "./lib/rateLimit";

export const consume = internalMutation({
    args: {
        key: v.string(),
        limit: v.number(),
        windowMs: v.number(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const existing =
            (await ctx.db
                .query("rateLimitBuckets")
                .withIndex("by_key", (q) => q.eq("key", args.key))
                .first()) ?? null;

        const { allowed, nextBucket, remaining, resetAt } = consumeFromBucket({
            now,
            limit: args.limit,
            windowMs: args.windowMs,
            bucket: existing ? { windowStart: existing.windowStart, count: existing.count } : null,
        });

        if (existing) {
            await ctx.db.patch(existing._id, { ...nextBucket, updatedAt: now });
        } else {
            await ctx.db.insert("rateLimitBuckets", { key: args.key, ...nextBucket, updatedAt: now });
        }

        if (!allowed) {
            const waitSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
            throw new Error(`Rate limit exceeded. Try again in ${waitSeconds}s.`);
        }

        return { ok: true, remaining, resetAt };
    },
});

