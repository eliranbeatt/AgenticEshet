import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getLatest = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("plans")
            .withIndex("by_project_phase", (q) =>
                q.eq("projectId", args.projectId).eq("phase", "clarification"),
            )
            .order("desc")
            .first();
    },
});

export const save = mutation({
    args: {
        projectId: v.id("projects"),
        contentMarkdown: v.string(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("plans")
            .withIndex("by_project_phase", (q) =>
                q.eq("projectId", args.projectId).eq("phase", "clarification"),
            )
            .collect();

        const version = existing.length + 1;

        for (const doc of existing) {
            if (!doc.isActive) continue;
            await ctx.db.patch(doc._id, { isActive: false });
        }

        return await ctx.db.insert("plans", {
            projectId: args.projectId,
            version,
            phase: "clarification",
            isDraft: false,
            isActive: true,
            contentMarkdown: args.contentMarkdown,
            createdAt: Date.now(),
            createdBy: "user",
        });
    },
});

