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

export const ensureTaskNumbers = mutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const tasks = await ctx.db
            .query("tasks")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        tasks.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

        let updated = 0;
        for (let i = 0; i < tasks.length; i++) {
            const desired = i + 1;
            if (tasks[i].taskNumber !== desired) {
                await ctx.db.patch(tasks[i]._id, { taskNumber: desired, updatedAt: Date.now() });
                updated++;
            }
        }

        return { updated };
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
        accountingSectionId: v.optional(v.id("sections")),
        accountingLineType: v.optional(v.union(v.literal("material"), v.literal("work"))),
        accountingLineId: v.optional(v.union(v.id("materialLines"), v.id("workLines"))),
        source: v.optional(v.union(v.literal("user"), v.literal("agent"))),
    },
    handler: async (ctx, args) => {
        const existingTasks = await ctx.db
            .query("tasks")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();
        let maxTaskNumber = 0;
        for (const t of existingTasks) {
            if (t.taskNumber && t.taskNumber > maxTaskNumber) maxTaskNumber = t.taskNumber;
        }
        const taskNumber = maxTaskNumber + 1;

        return await ctx.db.insert("tasks", {
            projectId: args.projectId,
            title: args.title,
            description: args.description,
            status: args.status,
            category: args.category,
            priority: args.priority,
            questId: args.questId,
            accountingSectionId: args.accountingSectionId,
            accountingLineType: args.accountingLineType,
            accountingLineId: args.accountingLineId,
            source: args.source ?? "user",
            taskNumber,
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
        accountingSectionId: v.optional(v.id("sections")),
        accountingLineType: v.optional(v.union(v.literal("material"), v.literal("work"))),
        accountingLineId: v.optional(v.union(v.id("materialLines"), v.id("workLines"))),
        
        // Gantt fields
        startDate: v.optional(v.number()),
        endDate: v.optional(v.number()),
        dependencies: v.optional(v.array(v.id("tasks"))),
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
