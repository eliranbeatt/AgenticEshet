import { query } from "./_generated/server";
import { v } from "convex/values";

// 3. Printing Module Implementation (Queries)

export const listFiles = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("printFiles")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .collect();
    },
});
