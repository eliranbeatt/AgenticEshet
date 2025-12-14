import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const updateDraftMarkdown = mutation({
    args: {
        planId: v.id("plans"),
        contentMarkdown: v.string(),
    },
    handler: async (ctx, args) => {
        const plan = await ctx.db.get(args.planId);
        if (!plan) throw new Error("Plan not found");
        if (plan.phase !== "planning") throw new Error("Only planning documents can be updated here");
        if (!plan.isDraft) throw new Error("Only draft plans can be edited");

        await ctx.db.patch(args.planId, {
            contentMarkdown: args.contentMarkdown,
        });
    },
});
