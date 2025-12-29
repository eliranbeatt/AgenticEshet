import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { TASK_STATUSES, TASK_CATEGORIES, TASK_PRIORITIES } from "./constants";

export const listByProject = query({
    args: { projectId: v.id("projects"), itemId: v.optional(v.id("projectItems")) },
    handler: async (ctx, args) => {
        if (args.itemId) {
            return await ctx.db
                .query("tasks")
                .withIndex("by_project_item", (q) =>
                    q.eq("projectId", args.projectId).eq("itemId", args.itemId)
                )
                .collect();
        }

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
            v.literal(TASK_STATUSES[0]),
            v.literal(TASK_STATUSES[1]),
            v.literal(TASK_STATUSES[2]),
            v.literal(TASK_STATUSES[3])
        ),
        category: v.union(
            v.literal(TASK_CATEGORIES[0]),
            v.literal(TASK_CATEGORIES[1]),
            v.literal(TASK_CATEGORIES[2]),
            v.literal(TASK_CATEGORIES[3]),
            v.literal(TASK_CATEGORIES[4])
        ),
        priority: v.union(
            v.literal(TASK_PRIORITIES[0]),
            v.literal(TASK_PRIORITIES[1]),
            v.literal(TASK_PRIORITIES[2])
        ),
        questId: v.optional(v.id("quests")),
        accountingSectionId: v.optional(v.id("sections")),
        accountingLineType: v.optional(v.union(v.literal("material"), v.literal("work"))),
        accountingLineId: v.optional(v.union(v.id("materialLines"), v.id("workLines"))),
        itemId: v.optional(v.id("projectItems")),
        itemSubtaskId: v.optional(v.string()),
        workstream: v.optional(v.string()),
        isManagement: v.optional(v.boolean()),
        source: v.optional(v.union(v.literal("user"), v.literal("agent"))),
        // Gantt fields
        estimatedDuration: v.optional(v.number()), // in milliseconds
        dependencies: v.optional(v.array(v.id("tasks"))),

        // Task details
        estimatedMinutes: v.optional(v.union(v.number(), v.null())),
        steps: v.optional(v.array(v.string())),
        subtasks: v.optional(v.array(v.object({ title: v.string(), done: v.boolean() }))),
        assignee: v.optional(v.union(v.string(), v.null())),
        lock: v.optional(v.boolean()),
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
            itemId: args.itemId,
            itemSubtaskId: args.itemSubtaskId,
            workstream: args.workstream,
            isManagement: args.isManagement,
            source: args.source ?? "user",
            taskNumber,
            estimatedDuration: args.estimatedDuration,
            dependencies: args.dependencies,
            estimatedMinutes: args.estimatedMinutes,
            steps: args.steps,
            subtasks: args.subtasks,
            assignee: args.assignee,
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
        itemId: v.optional(v.id("projectItems")),
        itemSubtaskId: v.optional(v.string()),
        workstream: v.optional(v.string()),
        isManagement: v.optional(v.boolean()),

        // Gantt fields
        startDate: v.optional(v.number()),
        endDate: v.optional(v.number()),
        dependencies: v.optional(v.array(v.id("tasks"))),

        // Task details
        estimatedMinutes: v.optional(v.union(v.number(), v.null())),
        steps: v.optional(v.array(v.string())),
        subtasks: v.optional(v.array(v.object({ title: v.string(), done: v.boolean() }))),
        assignee: v.optional(v.union(v.string(), v.null())),
    },
    handler: async (ctx, args) => {
        const { taskId, estimatedMinutes, ...patches } = args;
        const task = await ctx.db.get(taskId);
        if (!task) return;

        const nextPatches: Record<string, unknown> = { ...patches };
        if (estimatedMinutes !== undefined) {
            nextPatches.estimatedMinutes = estimatedMinutes;
            if (typeof estimatedMinutes === "number" && Number.isFinite(estimatedMinutes)) {
                const minutes = Math.max(1, estimatedMinutes);
                nextPatches.estimatedDuration = minutes * 60 * 1000;
            }
        }

        if (patches.itemId && patches.accountingSectionId === undefined) {
            const section = await ctx.db
                .query("sections")
                .withIndex("by_project", (q) => q.eq("projectId", task.projectId))
                .filter((q) => q.eq(q.field("itemId"), patches.itemId))
                .first();
            if (section) {
                nextPatches.accountingSectionId = section._id;
            }
        }

        await ctx.db.patch(taskId, { ...nextPatches, updatedAt: Date.now() });
    },
});

export const deleteTask = mutation({
    args: { taskId: v.id("tasks") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.taskId);
    },
});

export const clearTasks = mutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const tasks = await ctx.db
            .query("tasks")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        for (const task of tasks) {
            await ctx.db.delete(task._id);
        }
    },
});
