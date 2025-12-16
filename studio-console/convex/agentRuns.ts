import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

const MAX_EVENTS = 60;

export const createRun = internalMutation({
    args: {
        projectId: v.id("projects"),
        agent: v.string(),
        stage: v.optional(v.string()),
        initialMessage: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const events = [];

        if (args.initialMessage) {
            events.push({
                ts: now,
                level: "info" as const,
                message: args.initialMessage,
                stage: args.stage,
            });
        }

        return await ctx.db.insert("agentRuns", {
            projectId: args.projectId,
            agent: args.agent,
            status: "queued",
            stage: args.stage,
            createdAt: now,
            updatedAt: now,
            events,
        });
    },
});

export const appendEvent = internalMutation({
    args: {
        runId: v.id("agentRuns"),
        level: v.union(v.literal("info"), v.literal("warn"), v.literal("error")),
        message: v.string(),
        stage: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run) return;

        const nextEvents = [
            ...(run.events ?? []),
            { ts: Date.now(), level: args.level, message: args.message, stage: args.stage },
        ].slice(-MAX_EVENTS);

        await ctx.db.patch(args.runId, {
            events: nextEvents,
            updatedAt: Date.now(),
            stage: args.stage ?? run.stage,
        });
    },
});

export const setStatus = internalMutation({
    args: {
        runId: v.id("agentRuns"),
        status: v.union(
            v.literal("queued"),
            v.literal("running"),
            v.literal("succeeded"),
            v.literal("failed")
        ),
        stage: v.optional(v.string()),
        error: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const patch: Record<string, unknown> = {
            status: args.status,
            updatedAt: now,
        };

        if (args.stage !== undefined) patch.stage = args.stage;
        if (args.error !== undefined) patch.error = args.error;
        if (args.status === "running") patch.startedAt = now;
        if (args.status === "succeeded" || args.status === "failed") patch.finishedAt = now;

        await ctx.db.patch(args.runId, patch);
    },
});

export const get = query({
    args: { runId: v.id("agentRuns") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.runId);
    },
});

export const listByProject = query({
    args: {
        projectId: v.id("projects"),
        limit: v.optional(v.number()),
        agent: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const limit = Math.max(1, Math.min(args.limit ?? 15, 50));

        if (args.agent) {
            return await ctx.db
                .query("agentRuns")
                .withIndex("by_project_agent_createdAt", (q) =>
                    q.eq("projectId", args.projectId).eq("agent", args.agent as string)
                )
                .order("desc")
                .take(limit);
        }

        return await ctx.db
            .query("agentRuns")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .take(limit);
    },
});

