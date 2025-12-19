import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listConceptCards = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("ideationConceptCards")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .collect();
    },
});

export const clearConceptCards = mutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const cards = await ctx.db
            .query("ideationConceptCards")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .collect();

        for (const card of cards) {
            await ctx.db.delete(card._id);
        }
    },
});

