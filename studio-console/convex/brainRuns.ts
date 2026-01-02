import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const create = internalMutation({
    args: {
        projectId: v.id("projects"),
        eventId: v.id("brainEvents"),
        model: v.string(),
        outputJson: v.optional(v.string()),
        runSummary: v.optional(v.string()),
        status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
        error: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("brainRuns", {
            projectId: args.projectId,
            eventId: args.eventId,
            model: args.model,
            outputJson: args.outputJson,
            runSummary: args.runSummary,
            status: args.status,
            error: args.error,
            createdAt: Date.now(),
        });
    },
});
