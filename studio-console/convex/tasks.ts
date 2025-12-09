import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const listByProject = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("tasks")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();
    },
});

export const createTask = mutation({
    args: {
        projectId: v.id("projects"),
        title: v.string(),
        description: v.optional(v.string()),
        status: v.union(
            v.literal("todo"),
            v.literal("in_progress"),
            v.literal("done"),
            v.literal("blocked")
        ),
        category: v.union(
            v.literal("Logistics"),
            v.literal("Creative"),
            v.literal("Finance"),
            v.literal("Admin"),
            v.literal("Studio")
        ),
        priority: v.union(
            v.literal("High"),
            v.literal("Medium"),
            v.literal("Low")
        ),
        questId: v.optional(v.id("quests")),
        source: v.optional(v.union(v.literal("user"), v.literal("agent"))),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("tasks", {
            projectId: args.projectId,
            title: args.title,
            description: args.description,
            status: args.status,
            category: args.category,
            priority: args.priority,
            questId: args.questId,
            source: args.source ?? "user",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    },
});

export const updateTask = mutation({
    args: {
        taskId: v.id("tasks"),
        title: v.optional(v.string()),
        description: v.optional(v.string()),
        status: v.optional(
            v.union(
                v.literal("todo"),
                v.literal("in_progress"),
                v.literal("done"),
                v.literal("blocked")
            )
        ),
        category: v.optional(
            v.union(
                v.literal("Logistics"),
                v.literal("Creative"),
                v.literal("Finance"),
                v.literal("Admin"),
                v.literal("Studio")
            )
        ),
        priority: v.optional(
            v.union(
                v.literal("High"),
                v.literal("Medium"),
                v.literal("Low")
            )
        ),
        questId: v.optional(v.id("quests")),
    },
    handler: async (ctx, args) => {
        const { taskId, ...patches } = args;
        await ctx.db.patch(taskId, {
            ...patches,
            updatedAt: Date.now(),
        });
    },
});

export const deleteTask = mutation({
    args: { taskId: v.id("tasks") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.taskId);
    },
});
