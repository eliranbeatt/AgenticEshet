import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { TASK_STATUSES } from "./constants";

const STATUS_KEYS = TASK_STATUSES;
type StatusKey = (typeof STATUS_KEYS)[number];

// Config now only stores board and mapping, auth is via env vars
export type TrelloConfig = {
    boardId: string;
    listMap: Record<StatusKey, string>;
};

// --- Mutations ---

export const saveConfig = mutation({
    args: {
        projectId: v.id("projects"),
        config: v.object({
            boardId: v.string(),
            listMap: v.object({
                todo: v.string(),
                in_progress: v.string(),
                blocked: v.string(),
                done: v.string(),
            }),
        }),
    },
    handler: async (ctx, args) => {
        const key = `project_trello_${args.projectId}`;
        const existing = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).first();
        // Since we changed the shape of config, we just overwrite whatever is there
        const valueJson = JSON.stringify(args.config);

        if (existing) {
            await ctx.db.patch(existing._id, { valueJson });
        } else {
            await ctx.db.insert("settings", { key, valueJson });
        }
    },
});

export const updateMapping = internalMutation({
    args: {
        projectId: v.id("projects"),
        taskId: v.id("tasks"),
        trelloCardId: v.string(),
        trelloListId: v.string(),
        contentHash: v.string(),
        lastSyncedAt: v.optional(v.number()),
        // Optional because sometimes we only update one or the other?
        // Actually, let's keep it safe. If provided, update.
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("trelloMappings")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .filter((q) => q.eq(q.field("taskId"), args.taskId))
            .first();

        const now = args.lastSyncedAt ?? Date.now();

        if (existing) {
            await ctx.db.patch(existing._id, {
                lastSyncedAt: now,
                contentHash: args.contentHash,
                trelloListId: args.trelloListId,
                trelloCardId: args.trelloCardId,
            });
        } else {
            await ctx.db.insert("trelloMappings", {
                projectId: args.projectId,
                taskId: args.taskId,
                trelloCardId: args.trelloCardId,
                trelloListId: args.trelloListId,
                lastSyncedAt: now,
                contentHash: args.contentHash,
            });
        }
    },
});

export const removeMapping = internalMutation({
    args: { mappingId: v.id("trelloMappings") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.mappingId);
    },
});

// --- Queries ---

export const getConfig = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const key = `project_trello_${args.projectId}`;
        const setting = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).first();
        if (!setting) return null;

        try {
            const parsed = JSON.parse(setting.valueJson);
            // Quick check - if it has apiKey, it's old config format, treat as null or migrate?
            // For now, simpler to just treat as null if shape is wrong, or partial.
            // But let's assume if it has boardId it's usable.
            if (parsed.boardId && parsed.listMap) {
                return parsed as TrelloConfig;
            }
            return null;
        } catch {
            return null;
        }
    },
});

export const getMappings = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db.query("trelloMappings").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect();
    },
});

export const getSyncState = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const mappings = await ctx.db.query("trelloMappings").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect();
        const tasks = await ctx.db.query("tasks").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect();
        const lastSyncedAt = mappings.reduce((latest, mapping) => Math.max(latest, mapping.lastSyncedAt), 0);
        const mappedIds = new Set(mappings.map((m) => m.taskId));

        return {
            lastSyncedAt: lastSyncedAt === 0 ? null : lastSyncedAt,
            mappedTaskCount: mappings.length,
            totalTasks: tasks.length,
            unmappedTasks: tasks.filter((task) => !mappedIds.has(task._id)).length,
        };
    },
});
