import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

export const create = internalMutation({
    args: {
        projectId: v.id("projects"),
        title: v.string(),
        descriptionMarkdown: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("elementSuggestions", {
            projectId: args.projectId,
            title: args.title,
            descriptionMarkdown: args.descriptionMarkdown,
            status: "SUGGESTED",
            createdAt: Date.now(),
        });
    },
});

export const listOpen = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("elementSuggestions")
            .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", "SUGGESTED"))
            .collect();
    },
});
