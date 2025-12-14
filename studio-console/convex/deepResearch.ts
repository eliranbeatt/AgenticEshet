import { v } from "convex/values";
import { query } from "./_generated/server";

export const listByProject = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("deepResearchRuns")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .collect();
    },
});

