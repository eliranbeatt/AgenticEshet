import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listByProjectPhase = query({
    args: {
        projectId: v.id("projects"),
        phase: v.union(
            v.literal("ideation"),
            v.literal("clarification"),
            v.literal("planning"),
            v.literal("solutioning"),
            v.literal("tasks"),
            v.literal("quote")
        ),
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("projectScenarios")
            .withIndex("by_project_phase", (q) => q.eq("projectId", args.projectId).eq("phase", args.phase))
            .order("desc")
            .collect();
    },
});

export const ensureScenario = mutation({
    args: {
        projectId: v.id("projects"),
        phase: v.union(
            v.literal("ideation"),
            v.literal("clarification"),
            v.literal("planning"),
            v.literal("solutioning"),
            v.literal("tasks"),
            v.literal("quote")
        ),
        scenarioKey: v.string(),
        title: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("projectScenarios")
            .withIndex("by_project_phase_key", (q) =>
                q.eq("projectId", args.projectId).eq("phase", args.phase).eq("scenarioKey", args.scenarioKey)
            )
            .first();

        if (existing) {
            if (args.title && args.title !== existing.title) {
                await ctx.db.patch(existing._id, { title: args.title, updatedAt: Date.now() });
            }
            return existing._id;
        }

        return await ctx.db.insert("projectScenarios", {
            projectId: args.projectId,
            phase: args.phase,
            scenarioKey: args.scenarioKey,
            title: args.title,
            createdAt: Date.now(),
            createdBy: "user",
        });
    },
});

