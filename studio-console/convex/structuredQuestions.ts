import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { StructuredAnswerSchema } from "./lib/zodSchemas";
import { internal } from "./_generated/api";

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
        userInstructions: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        console.log("saveAnswers called for session", args.sessionId, "turn", args.turnNumber);
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
            userInstructions: args.userInstructions,
            answeredAt: Date.now(),
        });

        await ctx.db.patch(args.sessionId, {
            updatedAt: Date.now(),
        });

        // --- FACTS PIPELINE INTEGRATION ---
        const session = await ctx.db.get(args.sessionId);
        if (session) {
            const items = await ctx.db
                .query("projectItems")
                .withIndex("by_project_status", (q) => q.eq("projectId", session.projectId))
                .collect();
            
            const itemRefs = items.map((item) => ({
                id: item._id,
                name: item.name ?? item.title ?? "Untitled item",
            }));

            const stageMap: Record<string, "ideation" | "planning" | "solutioning"> = {
                "clarification": "ideation",
                "planning": "planning",
                "solutioning": "solutioning"
            };
            const bundleStage = stageMap[session.stage] || "ideation";

            console.log("Scheduling createFromTurn for project", session.projectId);
            // Force update
            await ctx.scheduler.runAfter(0, internal.turnBundles.createFromTurn, {
                projectId: session.projectId,
                stage: bundleStage,
                scope: { type: "project" },
                source: {
                    type: "structuredQuestions",
                    sourceIds: [turn._id],
                },
                itemRefs,
                structuredQuestions: (turn.questions as any[]).map((q: any) => ({ 
                    id: q.id, 
                    text: q.text || q.title || q.prompt || "Question" 
                })),
                userAnswers: (args.answers as any[]).map((a: any) => ({ 
                    qId: a.questionId, 
                    quick: a.quick, 
                    text: a.text 
                })),
                freeChat: args.userInstructions,
            });
        }
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

export const getTranscript = internalQuery({
    args: {
        projectId: v.id("projects"),
        stage: v.union(v.literal("clarification"), v.literal("planning"), v.literal("solutioning")),
    },
    handler: async (ctx, args) => {
        const session = await ctx.db
            .query("structuredQuestionSessions")
            .withIndex("by_project_stage", (q) =>
                q.eq("projectId", args.projectId).eq("stage", args.stage)
            )
            .order("desc")
            .first();

        if (!session) return "";

        const turns = await ctx.db
            .query("structuredQuestionTurns")
            .withIndex("by_session_turn", (q) => q.eq("sessionId", session._id))
            .collect();
        
        turns.sort((a, b) => a.turnNumber - b.turnNumber);

        const lines: string[] = [];
        for (const turn of turns) {
            lines.push(`--- Turn ${turn.turnNumber} ---`);
            if (turn.questions && Array.isArray(turn.questions)) {
                turn.questions.forEach((q: any, i: number) => {
                    lines.push(`Q${i+1}: ${q.text}`);
                });
            }
            if (turn.answers && Array.isArray(turn.answers)) {
                turn.answers.forEach((a: any, i: number) => {
                    lines.push(`A${i+1}: [${a.quick}] ${a.text || ""}`);
                });
            }
            if (turn.userInstructions) {
                lines.push(`User Note: ${turn.userInstructions}`);
            }
            lines.push("");
        }
        return lines.join("\n");
    },
});
