import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { StructuredAnswerSchema } from "./lib/zodSchemas";

export const getActiveSession = query({
    args: {
        projectId: v.id("projects"),
        stage: v.union(v.literal("clarification"), v.literal("planning"), v.literal("solutioning")),
    },
    handler: async (ctx, args) => {
        const session = await ctx.db
            .query("structuredQuestionSessions")
            .withIndex("by_project_stage", (q) =>
                q.eq("projectId", args.projectId).eq("stage", args.stage).eq("status", "active")
            )
            .first();
        return session;
    },
});

export const listTurns = query({
    args: {
        sessionId: v.id("structuredQuestionSessions"),
    },
    handler: async (ctx, args) => {
        const turns = await ctx.db
            .query("structuredQuestionTurns")
            .withIndex("by_session_turn", (q) => q.eq("sessionId", args.sessionId))
            .collect();
        return turns.sort((a, b) => a.turnNumber - b.turnNumber);
    },
});

export const getLatestTurn = query({
    args: {
        sessionId: v.id("structuredQuestionSessions"),
    },
    handler: async (ctx, args) => {
        const turns = await ctx.db
            .query("structuredQuestionTurns")
            .withIndex("by_session_turn", (q) => q.eq("sessionId", args.sessionId))
            .collect();
        
        if (turns.length === 0) return null;
        return turns.sort((a, b) => b.turnNumber - a.turnNumber)[0];
    },
});

export const startSession = mutation({
    args: {
        projectId: v.id("projects"),
        stage: v.union(v.literal("clarification"), v.literal("planning"), v.literal("solutioning")),
    },
    handler: async (ctx, args) => {
        // Archive any existing active sessions
        const existing = await ctx.db
            .query("structuredQuestionSessions")
            .withIndex("by_project_stage", (q) =>
                q.eq("projectId", args.projectId).eq("stage", args.stage).eq("status", "active")
            )
            .collect();
        
        for (const session of existing) {
            await ctx.db.patch(session._id, { status: "archived" });
        }

        const sessionId = await ctx.db.insert("structuredQuestionSessions", {
            projectId: args.projectId,
            stage: args.stage,
            status: "active",
            currentTurnNumber: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        return sessionId;
    },
});

export const saveAnswers = mutation({
    args: {
        sessionId: v.id("structuredQuestionSessions"),
        turnNumber: v.number(),
        answers: v.any(), // StructuredAnswer[]
    },
    handler: async (ctx, args) => {
        const turn = await ctx.db
            .query("structuredQuestionTurns")
            .withIndex("by_session_turn", (q) =>
                q.eq("sessionId", args.sessionId).eq("turnNumber", args.turnNumber)
            )
            .first();

        if (!turn) {
            throw new Error(`Turn ${args.turnNumber} not found for session ${args.sessionId}`);
        }

        await ctx.db.patch(turn._id, {
            answers: args.answers,
            answeredAt: Date.now(),
        });

        await ctx.db.patch(args.sessionId, {
            updatedAt: Date.now(),
        });
    },
});

export const internal_createTurn = internalMutation({
    args: {
        projectId: v.id("projects"),
        stage: v.union(v.literal("clarification"), v.literal("planning"), v.literal("solutioning")),
        sessionId: v.id("structuredQuestionSessions"),
        turnNumber: v.number(),
        questions: v.any(),
        agentRunId: v.optional(v.id("agentRuns")),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("structuredQuestionTurns", {
            projectId: args.projectId,
            stage: args.stage,
            sessionId: args.sessionId,
            turnNumber: args.turnNumber,
            questions: args.questions,
            answers: [],
            agentRunId: args.agentRunId,
            createdAt: Date.now(),
        });
    },
});

export const internal_updateSessionTurn = internalMutation({
    args: {
        sessionId: v.id("structuredQuestionSessions"),
        turnNumber: v.number(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.sessionId, {
            currentTurnNumber: args.turnNumber,
            updatedAt: Date.now(),
        });
    },
});
