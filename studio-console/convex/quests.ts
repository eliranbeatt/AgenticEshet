import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("quests")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .order("asc")
            .collect();
    },
});

export const create = mutation({
    args: {
        projectId: v.id("projects"),
        title: v.string(),
        description: v.optional(v.string()),
        order: v.number(),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("quests", {
            projectId: args.projectId,
            title: args.title,
            description: args.description,
            order: args.order,
            createdAt: Date.now(),
        });
    },
});

export const deleteQuest = mutation({
    args: { questId: v.id("quests") },
    handler: async (ctx, args) => {
        // Optional: Unlink tasks?
        const tasks = await ctx.db
            .query("tasks")
            .filter(q => q.eq(q.field("questId"), args.questId))
            .collect();
        
        for(const task of tasks) {
            await ctx.db.patch(task._id, { questId: undefined });
        }

        await ctx.db.delete(args.questId);
    },
});

export const updateQuest = mutation({
    args: {
        questId: v.id("quests"),
        title: v.optional(v.string()),
        description: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { questId, ...patches } = args;
        await ctx.db.patch(questId, patches);
    },
});

export const reorderQuests = mutation({
    args: {
        projectId: v.id("projects"),
        questIds: v.array(v.id("quests")),
    },
    handler: async (ctx, args) => {
        const quests = await ctx.db
            .query("quests")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const questLookup = new Map(quests.map((quest) => [quest._id, quest]));
        let orderCounter = 1;

        for (const questId of args.questIds) {
            if (!questLookup.has(questId)) continue;
            await ctx.db.patch(questId, { order: orderCounter++ });
            questLookup.delete(questId);
        }

        const remaining = Array.from(questLookup.values()).sort((a, b) => a.order - b.order);
        for (const quest of remaining) {
            await ctx.db.patch(quest._id, { order: orderCounter++ });
        }
    },
});

export const getStats = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const quests = await ctx.db
            .query("quests")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();
        
        const tasks = await ctx.db
            .query("tasks")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();
        
        // Calculate completion per quest
        const stats = quests.map(q => {
            const qTasks = tasks.filter(t => t.questId === q._id);
            const total = qTasks.length;
            const done = qTasks.filter(t => t.status === "done").length;
            const percent = total > 0 ? Math.round((done / total) * 100) : 0;
            return {
                questId: q._id,
                total,
                done,
                percent
            };
        });

        return stats;
    }
});
