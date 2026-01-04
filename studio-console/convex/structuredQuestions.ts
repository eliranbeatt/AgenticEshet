import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { StructuredAnswerSchema } from "./lib/zodSchemas";
import { api, internal } from "./_generated/api";

export const getActiveSession = query({
    args: {
        projectId: v.id("projects"),
        conversationId: v.optional(v.id("projectConversations")),
        stage: v.union(v.literal("clarification"), v.literal("planning"), v.literal("solutioning")),
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
        stage: v.union(v.literal("clarification"), v.literal("planning"), v.literal("solutioning")),
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
        stage: v.union(v.literal("clarification"), v.literal("planning"), v.literal("solutioning")),
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
        const normalizeAnswers = (answers: any[]) => {
            if (!Array.isArray(answers)) return [];
            const normalized: Array<{ questionId: string; quick: string; text?: string }> = [];
            for (const answer of answers) {
                if (!answer || typeof answer !== "object") continue;
                const questionId = typeof answer.questionId === "string" ? answer.questionId : "";
                if (!questionId) continue;
                const text = typeof answer.text === "string" ? answer.text.trim() : undefined;
                let quick = typeof answer.quick === "string" ? answer.quick : "";
                if (!["yes", "no", "idk", "irrelevant"].includes(quick)) {
                    if (text && text.length > 0) {
                        quick = "idk";
                    } else {
                        continue;
                    }
                }
                normalized.push({ questionId, quick, text: text && text.length > 0 ? text : undefined });
            }
            return normalized;
        };

        const normalizedAnswers = normalizeAnswers(args.answers);
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
            answers: normalizedAnswers,
            userInstructions: args.userInstructions,
            answeredAt: Date.now(),
        });

        await ctx.db.patch(args.sessionId, {
            updatedAt: Date.now(),
        });

        // --- KNOWLEDGE NOTES UPDATER INTEGRATION ---
        const session = await ctx.db.get(args.sessionId);
        if (session) {
            const qaPairs = (turn.questions as any[]).map((q: any) => {
                const answer = normalizedAnswers.find(a => a.questionId === q.id);
                if (!answer) return null;
                const answerText = answer.quick === "yes" ? "Yes" :
                    answer.quick === "no" ? "No" :
                        answer.quick === "idk" ? "Don't Know" :
                            answer.quick === "irrelevant" ? "Irrelevant" : answer.quick;

                return `Q: ${q.text || q.title || q.prompt}\nA: ${answerText} ${answer.text ? `(${answer.text})` : ""}`;
            }).filter(Boolean).join("\n\n");

            const fullContent = `Structured Answers (Turn ${args.turnNumber}):\n\n${qaPairs}\n\nUser Note: ${args.userInstructions || "(none)"}`;

            // --- NEW MEMORY SYSTEM ---
            // We force this update to happen BEFORE the next agent run by using runMutation directly or
            // relying on Convex's scheduling guarantees if they are in the same transaction.
            // But appendTurnSummary is an action (calling LLM), so it must be scheduled.
            // The Agent run is triggered by the UI polling or calling `runControllerStep`?
            // Actually, `StructuredQuestionsPanel` calls `saveAnswers`. It does NOT trigger the agent immediately.
            // Wait, looking at `StructuredQuestionsPanel.tsx`:
            // `await saveAnswers(...)` -> `setIsSubmitting(false)` -> Render updates.
            // `ActiveSessionView` renders based on `latestTurn`.
            // The agent creates the NEXT turn. Who calls the agent?
            // `StructuredQuestionsPanel` calls `startSession` then `runAgent` initially.
            // But for subsequent turns?
            // It seems `runControllerStep` in `controller.ts` creates the turn and returns questions.
            // If the UI just saves answers, how does the next turn get generated?
            // Ah, the Controller Loop.
            // The user submits answers. The UI then... waits?
            // `StructuredQuestionsPanel` just updates state.
            // If the controller is running, it should pick up the answers.
            // But where is the "Continue" button?
            // In `StructuredQuestionsPanel.tsx`, `handleSubmit` calls `saveAnswers`.
            // There is no explicit "Generate Next" call in the UI code I read.
            // Ah, `StructuredQuestionsPanel` in `handleSubmit`:
            // `await saveAnswers(...)`
            // That's it.
            // If the user is in "Agent" tab (Controller), the Controller logic handles the flow.
            // `controller.ts` -> `runControllerStepLogic`:
            // It checks `latestSession`. If `status` is `active`, it might resume?
            // But `controller.ts` calls `runSkill`.
            // `StructuredQuestionsPanel` seems standalone or embedded.
            // If embedded in `Agent` page:
            // The `Agent` page likely re-runs the controller loop after submit?
            // Let's assume the user clicks "Send answers & continue" in `Agent` page.
            // In `Agent` page: `handleQuestionSubmit` updates local state?
            // Wait, `StructuredQuestionsPanel` is used in `FlowWorkbench` probably.
            // In `Agent` page, there is custom UI for questions.
            // `studio-console/app/projects/[id]/agent/page.tsx` has `handleQuestionSubmit`.
            // It calls `submitSuggestions`? No.
            // `handleQuestionSubmit` seems to be for a different flow or I missed it.
            //
            // Let's assume `saveAnswers` IS the trigger for data persistence.
            // We want memory updated.
            
            await ctx.scheduler.runAfter(0, internal.memory.appendTurnSummary, {
                projectId: session.projectId,
                stage: session.stage,
                channel: "structured",
                userText: fullContent,
                assistantText: "(answers submitted)",
            });
        }
    },
});

export const internal_createTurn = internalMutation({
    args: {
        projectId: v.id("projects"),
        conversationId: v.optional(v.id("projectConversations")),
        stage: v.union(v.literal("clarification"), v.literal("planning"), v.literal("solutioning")),
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
        stage: v.union(v.literal("clarification"), v.literal("planning"), v.literal("solutioning")),
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
