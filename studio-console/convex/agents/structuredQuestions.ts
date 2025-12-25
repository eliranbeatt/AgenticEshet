import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { StructuredQuestionsTurnSchema } from "../lib/zodSchemas";

export const run = action({
    args: {
        projectId: v.id("projects"),
        stage: v.union(v.literal("clarification"), v.literal("planning"), v.literal("solutioning")),
        sessionId: v.id("structuredQuestionSessions"),
        runId: v.optional(v.id("agentRuns")),
    },
    handler: async (ctx, args) => {
        const runId = args.runId ?? await ctx.runMutation(internal.agentRuns.createRun, {
            projectId: args.projectId,
            agent: "structured_questions",
            stage: args.stage,
        });

        await ctx.runMutation(internal.agentRuns.setStatus, {
            runId,
            status: "running",
            stage: "generating_questions",
        });

        // 1. Load context (previous turns)
        const turns = await ctx.runQuery(api.structuredQuestions.listTurns, {
            sessionId: args.sessionId,
        });

        // 2. Build Prompt
        const systemPrompt = buildSystemPrompt(args.stage);
        const userPrompt = buildUserPrompt(turns);

        try {
            // 3. Call Model
            const result = await callChatWithSchema(StructuredQuestionsTurnSchema, {
                systemPrompt,
                userPrompt,
                model: "gpt-4o", // Use a strong model for structured output
                temperature: 0.7,
            });

            // 4. Save Turn
            const nextTurnNumber = turns.length + 1;
            
            await ctx.runMutation(internal.structuredQuestions.internal_createTurn, {
                projectId: args.projectId,
                stage: args.stage,
                sessionId: args.sessionId,
                turnNumber: nextTurnNumber,
                questions: result.questions,
                agentRunId: runId,
            });

            // 5. Update Session
            await ctx.runMutation(internal.structuredQuestions.internal_updateSessionTurn, {
                sessionId: args.sessionId,
                turnNumber: nextTurnNumber,
            });

            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId,
                status: "succeeded",
                stage: "done",
            });

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId,
                status: "failed",
                stage: "error",
                error: message,
            });
            throw error;
        }
    },
});

function buildSystemPrompt(stage: string) {
    const base = `You are an expert studio producer for 'Emily Studio'.
Your goal is to ask structured questions to clarify the project requirements.
    
RULES:
1. Return 1 to 5 questions only.
2. Each question must specify:
   - questionType: "boolean" or "text"
   - expectsFreeText: boolean
   - blocking: boolean (if unanswered -> can't proceed)
3. At least 2 questions per turn must be questionType="boolean" unless the session is nearly done.
4. Do NOT ask anything that was already answered in previous turns.
5. Ask "high leverage" questions first (unknowns that block next steps).
6. If you have enough information to proceed to the next phase (Generation), set sessionState.done = true.
`;

    if (stage === "clarification") {
        return base + `
Stage: CLARIFICATION (Ideation)
Focus on:
- Desired look & feel
- Constraints (location, approvals, brand)
- Scope boundaries ("is it one hero element or multiple?")
- Target outcome for client presentation
`;
    }

    if (stage === "planning") {
        return base + `
Stage: PLANNING
Focus on:
- Dimensions / quantities
- Schedule windows
- Transport / install constraints
- Budget signal
- "Client provides vs Studio provides"
`;
    }

    if (stage === "solutioning") {
        return base + `
Stage: SOLUTIONING
Focus on:
- Material choices
- Build approach
- Lead times
- Risk flags
- Assembly / disassembly method
`;
    }

    return base;
}

function buildUserPrompt(turns: any[]) {
    if (turns.length === 0) {
        return "Start the questioning session. Ask the most critical initial questions.";
    }

    const history = turns.map(t => {
        return `Turn ${t.turnNumber}:
Questions:
${t.questions.map((q: any) => `- ${q.title} (${q.questionType})`).join("\n")}
Answers:
${t.answers ? t.answers.map((a: any) => `- [${a.quick}] ${a.text || ""}`).join("\n") : "No answers yet"}`;
    }).join("\n\n");

    return `Here is the history of the session so far:\n\n${history}\n\nBased on these answers, generate the next batch of questions.`;
}
