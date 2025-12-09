import { v } from "convex/values";
import { query } from "./_generated/server";

export const listByProject = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("conversations")
            .withIndex("by_project_phase", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .collect();
    },
});

export const recentByPhase = query({
    args: {
        projectId: v.id("projects"),
        phase: v.string(),
        limit: v.number(),
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("conversations")
            .withIndex("by_project_phase", (q) =>
                q.eq("projectId", args.projectId).eq("phase", args.phase)
            )
            .order("desc")
            .take(args.limit);
    },
});
