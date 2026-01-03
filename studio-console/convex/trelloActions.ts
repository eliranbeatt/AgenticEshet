"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { TRELLO_API_BASE } from "./constants";
import { executeTrelloSyncPlan } from "./lib/trelloExecutor";

type TrelloRequestOptions = {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    params?: Record<string, string | undefined>;
    // Auth is injected automatically
    expectJson?: boolean;
    label: string;
    retryLog: string[];
};

function getTrelloAuth() {
    const apiKey = process.env.TRELLO_API_KEY || process.env.TRELLO_KEY;
    const token = process.env.TRELLO_TOKEN;
    if (!apiKey || !token) {
        throw new Error("Trello API key/token not configured on server.");
    }
    return { apiKey, token };
}

async function trelloRequest<T>(options: TrelloRequestOptions): Promise<T | undefined> {
    const { apiKey, token } = getTrelloAuth();

    const url = new URL(`${TRELLO_API_BASE}${options.path}`);
    const searchParams = new URLSearchParams({
        key: apiKey,
        token: token,
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

// New: Verify credentials
export const verifyCredentials = action({
    args: {},
    handler: async () => {
        const retryLog: string[] = [];
        try {
            const member = await trelloRequest<{ id: string; username: string }>({
                method: "GET",
                path: "/1/members/me",
                expectJson: true,
                label: "Verify Trello Credentials",
                retryLog,
            });
            return { success: true, username: member?.username };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { success: false, error: msg };
        }
    },
});

// New: List boards
export const listBoards = action({
    args: {},
    handler: async () => {
        const retryLog: string[] = [];
        const boards = await trelloRequest<Array<{ id: string; name: string }>>({
            method: "GET",
            path: "/1/members/me/boards",
            params: {
                fields: "name,id",
                filter: "open"
            },
            expectJson: true,
            label: "List Trello Boards",
            retryLog,
        });
        return boards ?? [];
    },
});

// New: Create Board
export const createBoard = action({
    args: { name: v.string() },
    handler: async (_ctx, args) => {
        const retryLog: string[] = [];
        // Note: 'defaultLists' param is part of POST /1/boards options
        const board = await trelloRequest<{ id: string; name: string }>({
            method: "POST",
            path: "/1/boards",
            params: {
                name: args.name,
                defaultLists: "true"
            },
            expectJson: true,
            label: "Create Trello Board",
            retryLog
        });
        return board;
    }
});

// Updated: Fetch lists for a specific board
export const fetchLists = action({
    args: { boardId: v.string() },
    handler: async (_ctx, args) => {
        const retryLog: string[] = [];
        const lists = await trelloRequest<Array<{ id: string; name: string }>>({
            method: "GET",
            path: `/1/boards/${args.boardId}/lists`,
            params: {},
            expectJson: true,
            label: "Fetch Trello lists",
            retryLog,
        });
        return lists ?? [];
    },
});

export const snapshotBoard = action({
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

export const sync = action({
    args: { projectId: v.id("projects"), dryRun: v.optional(v.boolean()) },
    handler: async (ctx, args) => {
        const config = await ctx.runQuery(api.trelloSync.getConfig, { projectId: args.projectId });
        if (!config) {
            throw new Error("Trello not configured for this project");
        }

        const auth = getTrelloAuth();

        // 1. Gather Context
        const [tasks, mappings] = await Promise.all([
            ctx.runQuery(api.tasks.listByProject, { projectId: args.projectId }),
            ctx.runQuery(internal.trelloSync.getMappings, { projectId: args.projectId }),
        ]);

        // Optimization: Fetch current board state here or let Executor do it?
        // Agent needs to know lists/labels to "ENSURE" them correctly (or reuse them).
        // Let's do a quick fetch of lists/labels to give context to the Agent.
        // We reuse the existing 'trelloRequest' helper for this "context gathering".
        const [lists, labels, customFields] = await Promise.all([
            trelloRequest<any[]>({ method: "GET", path: `/boards/${config.boardId}/lists`, label: "Get Lists", retryLog: [] }),
            trelloRequest<any[]>({ method: "GET", path: `/boards/${config.boardId}/labels`, label: "Get Labels", retryLog: [] }),
            trelloRequest<any[]>({ method: "GET", path: `/boards/${config.boardId}/customFields`, label: "Get Custom Fields", retryLog: [] }),
        ]);

        const trelloContext = {
            boardId: config.boardId,
            listsByStatus: config.listMap
                ? Object.fromEntries(
                    Object.entries(config.listMap).map(([k, v]) => [k, { id: v, name: k }])
                  )
                : {}, // Fallback if no map, though config should have it
            // Also provide raw lists found on board, in case config is stale
            knownLists: lists?.map((l: any) => ({ id: l.id, name: l.name })),
            knownLabels: labels?.map((l: any) => ({ id: l.id, name: l.name, color: l.color })),
            knownCustomFields: customFields?.map((f: any) => ({ id: f.id, name: f.name, type: f.type })),
            labelsByName: labels ? Object.fromEntries(labels.map((l: any) => [l.name, { id: l.id, color: l.color }])) : {},
            customFieldsByName: customFields ? Object.fromEntries(customFields.map((f: any) => [f.name, { id: f.id, type: f.type }])) : {},
        };

        // 2. Call Agent
        const plan = await ctx.runAction(internal.agents.trelloSyncAgent.generateTrelloSyncPlan, {
            projectId: args.projectId,
            tasks,
            trelloMappings: mappings,
            trelloContext,
            config: {
                listNames: config.listMap, // Hint preferred list mapping
            },
        });

        // 3. Execute Plan
        const report = await executeTrelloSyncPlan(plan, {
            apiKey: auth.apiKey,
            token: auth.token,
            dryRun: args.dryRun
        }, {
             knownLists: lists,
             knownLabels: labels,
             knownCustomFields: customFields
        });

        // 4. Persist Updates
        // Map runtime vars to actual IDs
        const vars: Record<string, string> = {};
        for (const r of report.opResults) {
            if (r.producedVars) Object.assign(vars, r.producedVars);
        }

        const resolveVar = (val: string) => {
            if (val.startsWith("$")) {
                const key = val.slice(1);
                return vars[key] || val; // fallback to val if not found (shouldn't happen if plan is valid)
            }
            return val;
        };

        let syncedCount = 0;
        const mappingUpserts = plan.mappingUpserts ?? [];

        if (!args.dryRun) {
            for (const upsert of mappingUpserts) {
                await ctx.runMutation(internal.trelloSync.updateMapping, {
                    projectId: args.projectId,
                    taskId: upsert.taskId as Id<"tasks">,
                    trelloCardId: resolveVar(upsert.trelloCardIdVarOrValue),
                    trelloListId: resolveVar(upsert.trelloListIdVarOrValue),
                    contentHash: upsert.contentHash,
                    lastSyncedAt: report.finishedAt,
                });
                syncedCount++;
            }
        }

        return {
            syncedCount,
            archivedCount: 0, // Agent currently doesn't output explicit "Archive" ops in mappingUpserts, but could via 'ops'
            errors: report.opResults.filter(r => !r.ok).map(r => `Op ${r.opId} (${r.op}) failed: ${r.error?.message}`),
            retries: [], // Executor handles retries internally
            report, // Return full report for debugging
        };
    },
});