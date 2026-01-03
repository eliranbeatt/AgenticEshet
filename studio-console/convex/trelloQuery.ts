import { query, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const getLatestPlan = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("trelloSyncPlans")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .first();
    },
});

export const executeSync = action({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        // Mock execution
        console.log("Executing Trello Sync for", args.projectId);
        // In real app, call internal Trello API
        return { success: true };
    }
});
