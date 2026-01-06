import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { StructuredAnswerSchema } from "./lib/zodSchemas";
import { api, internal } from "./_generated/api";
import { createTurnBundleLogic } from "./turnBundles";

export const getActiveSession = query({
    args: {
        projectId: v.id("projects"),
        conversationId: v.optional(v.id("projectConversations")),
        stage: v.string(),
    },
    handler: async (ctx, args) => {
        const query = ctx.db.query("structuredQuestionSessions");
        const session = args.conversationId
            ? await query
                .withIndex("by_project_conversation_stage_status", (q) =>
                    q.eq("projectId", args.projectId)
                        .eq("conversationId", args.conversationId)
                        .eq("stage", args.stage)
                        .eq("status", "active")
                )
                .first()
            : await query
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
        conversationId: v.optional(v.id("projectConversations")),
        stage: v.string(),
    },
    handler: async (ctx, args) => {
        // Archive any existing active sessions
        const query = ctx.db.query("structuredQuestionSessions");
        const existing = args.conversationId
            ? await query
                .withIndex("by_project_conversation_stage_status", (q) =>
                    q.eq("projectId", args.projectId)
                        .eq("conversationId", args.conversationId)
                        .eq("stage", args.stage)
                        .eq("status", "active")
                )
                .collect()
            : await query
                .withIndex("by_project_stage", (q) =>
                    q.eq("projectId", args.projectId).eq("stage", args.stage).eq("status", "active")
                )
                .collect();

        for (const session of existing) {
            await ctx.db.patch(session._id, { status: "archived" });
        }

        const sessionId = await ctx.db.insert("structuredQuestionSessions", {
            projectId: args.projectId,
            conversationId: args.conversationId,
            stage: args.stage,
            status: "active",
            currentTurnNumber: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        return sessionId;
    },
});

export const skipSession = mutation({
    args: {
        projectId: v.id("projects"),
        conversationId: v.optional(v.id("projectConversations")),
        stage: v.string(),
    },
    handler: async (ctx, args) => {
        const query = ctx.db.query("structuredQuestionSessions");
        const existing = args.conversationId
            ? await query
                .withIndex("by_project_conversation_stage_status", (q) =>
                    q.eq("projectId", args.projectId)
                        .eq("conversationId", args.conversationId)
                        .eq("stage", args.stage)
                        .eq("status", "active")
                )
                .collect()
            : await query
                .withIndex("by_project_stage", (q) =>
                    q.eq("projectId", args.projectId).eq("stage", args.stage).eq("status", "active")
                )
                .collect();

        for (const session of existing) {
            await ctx.db.patch(session._id, { status: "skipped", updatedAt: Date.now() });
        }
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
        console.log("saveAnswers raw inputs:", JSON.stringify({ sessionId: args.sessionId, turnNumber: args.turnNumber, answersCount: Array.isArray(args.answers) ? args.answers.length : 0 }));

        const normalizeAnswers = (answers: any[]) => {
            if (!Array.isArray(answers)) return [];
            console.log("saveAnswers raw:", JSON.stringify(answers));
            const normalized: Array<{ questionId: string; quick: string; text?: string }> = [];
            for (const answer of answers) {
                if (!answer || typeof answer !== "object") continue;
                const questionId = typeof answer.questionId === "string" ? answer.questionId : "";
                if (!questionId) {
                    console.warn("Skipping answer without questionId:", answer);
                    continue;
                }
                const text = typeof answer.text === "string" ? answer.text.trim() : undefined;
                let quick = typeof answer.quick === "string" ? answer.quick : "";

                // Relaxed normalization: If quick is invalid but text exists, default to 'yes' or 'idk' (context dependent, but 'yes' implies confirmation of the text detail)
                // Actually, if text is present, we shouldn't drop it.
                if (!["yes", "no", "idk", "irrelevant"].includes(quick)) {
                    if (text && text.length > 0) {
                        quick = "yes"; // Assume yes if they provided text details, or 'idk'
                        // Let's use 'idk' as safe default or just stringify it?
                        // Schema requires enum.
                    } else {
                        console.warn("Skipping invalid answer:", answer);
                        continue;
                    }
                }
                normalized.push({ questionId, quick, text: text && text.length > 0 ? text : undefined });
            }
            console.log("saveAnswers normalized:", JSON.stringify(normalized));
            return normalized;
        };

        const normalizedAnswers = normalizeAnswers(args.answers);
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
            answers: normalizedAnswers,
            userInstructions: args.userInstructions,
            answeredAt: Date.now(),
        });

        await ctx.db.patch(args.sessionId, {
            updatedAt: Date.now(),
        });

        // --- TURN BUNDLE + RUNNING MEMORY (RAW, IMMEDIATE) ---
        // Persist a TurnBundle so the structured session becomes a first-class "turn".
        // The TurnBundle pipeline will append the RAW Q&A transcript to Running Memory synchronously
        // (no LLM summarization) so the next question generation can depend on it.
        const session = await ctx.db.get(args.sessionId);
        if (session) {
            const stageMap: Record<string, "ideation" | "planning" | "solutioning"> = {
                clarification: "ideation",
                planning: "planning",
                solutioning: "solutioning",
            };
            const mappedStage = stageMap[session.stage] ?? "ideation";

            const itemRefs = await ctx.runQuery(internal.items.getItemRefs, {
                projectId: session.projectId,
            });

            const structuredQuestions = (turn.questions as any[]).map((q: any) => ({
                id: String(q.id ?? ""),
                text: String(q.text || q.title || q.prompt || ""),
            })).filter((q: any) => q.id && q.text);

            const userAnswers = normalizedAnswers.map((a) => ({
                qId: a.questionId,
                quick: a.quick,
                text: a.text,
            }));

            // Use synchronous helper!
            await createTurnBundleLogic(ctx, {
                projectId: session.projectId,
                stage: mappedStage,
                scope: { type: "project" as const },
                source: {
                    type: "structuredQuestions" as const,
                    sourceIds: [String(args.sessionId), `turn:${turn._id}`, `turnNumber:${args.turnNumber}`],
                },
                itemRefs,
                structuredQuestions,
                userAnswers,
                freeChat: args.userInstructions?.trim() ? `User Note: ${args.userInstructions.trim()}` : undefined,
                agentOutput: "(answers submitted)",
            });
        }
    },
});

export const internal_createTurn = internalMutation({
    args: {
        projectId: v.id("projects"),
        conversationId: v.optional(v.id("projectConversations")),
        stage: v.string(),
        sessionId: v.id("structuredQuestionSessions"),
        turnNumber: v.number(),
        questions: v.any(),
        agentRunId: v.optional(v.id("agentRuns")),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("structuredQuestionTurns", {
            projectId: args.projectId,
            conversationId: args.conversationId,
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
        conversationId: v.optional(v.id("projectConversations")),
        stage: v.string(),
    },
    handler: async (ctx, args) => {
        const query = ctx.db.query("structuredQuestionSessions");
        const session = args.conversationId
            ? await query
                .withIndex("by_project_conversation_stage_status", (q) =>
                    q.eq("projectId", args.projectId)
                        .eq("conversationId", args.conversationId)
                        .eq("stage", args.stage)
                        .eq("status", "active")
                )
                .first()
            : await query
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
                    lines.push(`Q${i + 1}: ${q.text}`);
                });
            }
            if (turn.answers && Array.isArray(turn.answers)) {
                turn.answers.forEach((a: any, i: number) => {
                    lines.push(`A${i + 1}: [${a.quick}] ${a.text || ""}`);
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
