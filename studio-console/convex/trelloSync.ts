import { v } from "convex/values";
import { action, mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { calculateHash } from "./lib/hash";
import type { Doc } from "./_generated/dataModel";
import { TASK_STATUSES, TRELLO_API_BASE } from "./constants";

const STATUS_KEYS = TASK_STATUSES;
type StatusKey = (typeof STATUS_KEYS)[number];

type TrelloConfig = {
    apiKey: string;
    token: string;
    boardId: string;
    listMap: Record<StatusKey, string>;
};

type TrelloAuth = Pick<TrelloConfig, "apiKey" | "token">;

type TrelloRequestOptions = {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    params?: Record<string, string | undefined>;
    auth: TrelloAuth;
    expectJson?: boolean;
    label: string;
    retryLog: string[];
};
async function trelloRequest<T>(options: TrelloRequestOptions): Promise<T | undefined> {
    const url = new URL(`${TRELLO_API_BASE}${options.path}`);
    const searchParams = new URLSearchParams({
        key: options.auth.apiKey,
        token: options.auth.token,
    });

    for (const [key, value] of Object.entries(options.params ?? {})) {
        if (value === undefined) continue;
        searchParams.set(key, value);
    }
    url.search = searchParams.toString();

    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const res = await fetch(url.toString(), { method: options.method });
        if (res.ok) {
            if (options.expectJson) {
                return (await res.json()) as T;
            }
            return undefined;
        }
        const message = await res.text();
        options.retryLog.push(`Attempt ${attempt} failed for ${options.label}: ${message}`);
        if (attempt === maxAttempts) {
            throw new Error(message);
        }
    }
    return undefined;
}

type TrelloCardPayload = {
    name: string;
    desc: string;
    idList: string;
    pos: "bottom";
    closed: "true" | "false";
};

export function deriveListId(
    status: Doc<"tasks">["status"],
    listMap: Record<StatusKey, string>
): string {
    const safeStatus: StatusKey = STATUS_KEYS.includes(status as StatusKey)
        ? (status as StatusKey)
        : "todo";
    return listMap[safeStatus] || listMap.todo || "";
}

export function buildCardPayload(
    task: Pick<Doc<"tasks">, "title" | "category" | "description" | "priority" | "status">,
    listId: string
): TrelloCardPayload {
    const baseDescription = task.description ? task.description.trim() : "";
    const descSections = [baseDescription, `Priority: ${task.priority}`].filter(Boolean);
    return {
        name: `[${task.category}] ${task.title}`,
        desc: descSections.join("\n\n"),
        idList: listId,
        pos: "bottom",
        closed: task.status === "done" ? "true" : "false",
    };
}

// --- Data Models for Trello Config (stored in settings) ---
// We'll store a JSON object in the 'settings' table under key "trello_config_{projectId}"
// or global "trello_auth" + project specific "trello_board"

// For simplicity, let's store per-project config in the 'settings' table 
// Key: `project_trello_${projectId}`
// Value: { apiKey, token, boardId, listMapping: { todo: "id", in_progress: "id", done: "id" } }

// --- Mutations ---

export const saveConfig = mutation({
    args: {
        projectId: v.id("projects"),
        config: v.object({
            apiKey: v.string(),
            token: v.string(),
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

        if (existing) {
            await ctx.db.patch(existing._id, { valueJson: JSON.stringify(args.config) });
        } else {
            await ctx.db.insert("settings", { key, valueJson: JSON.stringify(args.config) });
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
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("trelloMappings")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .filter((q) => q.eq(q.field("taskId"), args.taskId))
            .first();

        if (existing) {
            await ctx.db.patch(existing._id, {
                lastSyncedAt: Date.now(),
                contentHash: args.contentHash,
                trelloListId: args.trelloListId,
            });
        } else {
            await ctx.db.insert("trelloMappings", {
                projectId: args.projectId,
                taskId: args.taskId,
                trelloCardId: args.trelloCardId,
                trelloListId: args.trelloListId,
                lastSyncedAt: Date.now(),
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
        return setting ? (JSON.parse(setting.valueJson) as TrelloConfig) : null;
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

// --- Actions (The heavy lifting) ---

export const fetchLists: ReturnType<typeof action> = action({
    args: { apiKey: v.string(), token: v.string(), boardId: v.string() },
    handler: async (_ctx, args) => {
        const retryLog: string[] = [];
        const lists = await trelloRequest<unknown[]>({
            method: "GET",
            path: `/1/boards/${args.boardId}/lists`,
            params: {},
            auth: { apiKey: args.apiKey, token: args.token },
            expectJson: true,
            label: "Fetch Trello lists",
            retryLog,
        });
        return lists ?? [];
    },
});

export const snapshotBoard: ReturnType<typeof action> = action({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const config = await ctx.runQuery(api.trelloSync.getConfig, { projectId: args.projectId });
        if (!config) {
            throw new Error("Trello not configured for this project");
        }
        const retryLog: string[] = [];
        const lists = await trelloRequest<Array<{ id: string; name: string; cards?: Array<{ id: string; name: string; shortUrl?: string }> }>>({
            method: "GET",
            path: `/1/boards/${config.boardId}/lists`,
            params: {
                cards: "open",
                card_fields: "name,shortUrl,idList",
                fields: "name,id",
            },
            auth: config,
            expectJson: true,
            label: "Snapshot Trello board",
            retryLog,
        });
        return {
            lists: (lists ?? []).map((list) => ({
                id: list.id,
                name: list.name,
                cards: (list.cards ?? []).map((card) => ({
                    id: card.id,
                    name: card.name,
                    shortUrl: card.shortUrl,
                })),
            })),
            retries: retryLog,
        };
    },
});

export const sync: ReturnType<typeof action> = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const config = await ctx.runQuery(api.trelloSync.getConfig, { projectId: args.projectId });
    if (!config) {
        throw new Error("Trello not configured for this project");
    }

    const tasks = await ctx.runQuery(api.tasks.listByProject, { projectId: args.projectId });
    const mappings = await ctx.runQuery(internal.trelloSync.getMappings, { projectId: args.projectId });
    const mapLookup = new Map(mappings.map((m) => [m.taskId, m]));
    const taskIds = new Set(tasks.map((task) => task._id));

    const retryLog: string[] = [];
    let syncedCount = 0;
    let archivedCount = 0;
    const errors: string[] = [];

    for (const task of tasks) {
        const listId = deriveListId(task.status, config.listMap);
        if (!listId) {
            continue;
        }

        const cardParams = buildCardPayload(task, listId);
        const shouldArchive = cardParams.closed === "true";
        const currentHash = await calculateHash({
            ...cardParams,
            status: task.status,
            category: task.category,
            priority: task.priority,
        });

        const mapping = mapLookup.get(task._id);
        try {
            if (mapping) {
                if (mapping.contentHash !== currentHash || mapping.trelloListId !== listId) {
                    await trelloRequest({
                        method: "PUT",
                        path: `/1/cards/${mapping.trelloCardId}`,
                        params: cardParams,
                        auth: config,
                        label: `Update card ${mapping.trelloCardId}`,
                        retryLog,
                    });
                    await ctx.runMutation(internal.trelloSync.updateMapping, {
                        projectId: args.projectId,
                        taskId: task._id,
                        trelloCardId: mapping.trelloCardId,
                        trelloListId: listId,
                        contentHash: currentHash,
                    });
                    syncedCount++;
                }
            } else {
                const card = await trelloRequest<{ id: string; idList: string }>({
                    method: "POST",
                    path: "/1/cards",
                    params: cardParams,
                    auth: config,
                    expectJson: true,
                    label: `Create Trello card for ${task.title}`,
                    retryLog,
                });
                if (card) {
                    await ctx.runMutation(internal.trelloSync.updateMapping, {
                        projectId: args.projectId,
                        taskId: task._id,
                        trelloCardId: card.id,
                        trelloListId: card.idList,
                        contentHash: currentHash,
                    });
                    syncedCount++;
                }
            }
            if (shouldArchive) {
                archivedCount++;
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown error";
            errors.push(`Failed to sync ${task.title}: ${message}`);
        }
    }

    for (const mapping of mappings) {
        if (taskIds.has(mapping.taskId)) continue;
        try {
            await trelloRequest({
                method: "PUT",
                path: `/1/cards/${mapping.trelloCardId}`,
                params: { closed: "true" },
                auth: config,
                label: `Archive removed card ${mapping.trelloCardId}`,
                retryLog,
            });
            await ctx.runMutation(internal.trelloSync.removeMapping, { mappingId: mapping._id });
            archivedCount++;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown error";
            errors.push(`Failed to archive removed Trello card ${mapping.trelloCardId}: ${message}`);
        }
    }

    return { syncedCount, archivedCount, errors, retries: retryLog };
  },
});
