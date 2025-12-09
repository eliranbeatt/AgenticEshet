import { v } from "convex/values";
import { action, mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { calculateHash } from "./lib/hash";

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
            done: v.string(),
        })
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
                trelloListId: args.trelloListId, // In case it moved
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
    }
});

// --- Queries ---

export const getConfig = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const key = `project_trello_${args.projectId}`;
        const setting = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).first();
        return setting ? JSON.parse(setting.valueJson) : null;
    }
});

export const getMappings = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db.query("trelloMappings").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect();
    }
});

// --- Actions (The heavy lifting) ---

export const fetchLists = action({
    args: { apiKey: v.string(), token: v.string(), boardId: v.string() },
    handler: async (ctx, args) => {
        const url = `https://api.trello.com/1/boards/${args.boardId}/lists?key=${args.apiKey}&token=${args.token}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Trello API Error: ${res.statusText}`);
        return await res.json();
    }
});

export const sync = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    // 1. Get Config
    const config = await ctx.runQuery(api.trelloSync.getConfig, { projectId: args.projectId });
    if (!config) throw new Error("Trello not configured for this project");

    // 2. Get Tasks & Mappings
    const tasks = await ctx.runQuery(api.tasks.listByProject, { projectId: args.projectId });
    const mappings = await ctx.runQuery(internal.trelloSync.getMappings, { projectId: args.projectId });
    
    // Create lookup for mappings
    const mapLookup = new Map(mappings.map(m => [m.taskId, m]));

    let syncedCount = 0;
    const errors: string[] = [];

    // 3. Iterate
    for (const task of tasks) {
        // Prepare task payload
        const listId = config.listMap[task.status] || config.listMap["todo"]; // Fallback
        if (!listId) continue; // Skip if status not mapped (e.g. 'blocked' if not in map)

        // Calculate hash of relevant fields
        const payload = {
            name: `[${task.category}] ${task.title}`,
            desc: task.description || "",
            idList: listId,
        };
        const currentHash = await calculateHash(payload);

        const mapping = mapLookup.get(task._id);

        if (mapping) {
            // Update existing?
            if (mapping.contentHash !== currentHash || mapping.trelloListId !== listId) {
                // Update Card
                try {
                    const url = `https://api.trello.com/1/cards/${mapping.trelloCardId}?key=${config.apiKey}&token=${config.token}`;
                    // We only update what changed. Simplification: Update all.
                    // Note: Trello 'PUT' expects fields in body or query.
                    await fetch(url, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload),
                    });

                    // Update DB mapping
                    await ctx.runMutation(internal.trelloSync.updateMapping, {
                        projectId: args.projectId,
                        taskId: task._id,
                        trelloCardId: mapping.trelloCardId,
                        trelloListId: listId,
                        contentHash: currentHash,
                    });
                    syncedCount++;
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : "Unknown error";
                    errors.push(`Failed to update ${task.title}: ${message}`);
                }
            }
        } else {
            // Create New
            try {
                const url = `https://api.trello.com/1/cards?idList=${listId}&key=${config.apiKey}&token=${config.token}`;
                const res = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });
                if (!res.ok) throw new Error(await res.text());
                
                const card = await res.json();

                await ctx.runMutation(internal.trelloSync.updateMapping, {
                    projectId: args.projectId,
                    taskId: task._id,
                    trelloCardId: card.id,
                    trelloListId: listId,
                    contentHash: currentHash,
                });
                syncedCount++;
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : "Unknown error";
                errors.push(`Failed to create ${task.title}: ${message}`);
            }
        }
    }

    return { syncedCount, errors };
  },
});
