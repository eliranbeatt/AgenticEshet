import { action, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { runSkill } from "../lib/skills";

// 2. Controller Implementation

export type ControllerStatus = "CONTINUE" | "STOP_QUESTIONS" | "STOP_APPROVAL" | "STOP_SUGGESTIONS" | "DONE";

export type ControllerStepResult = {
    status: ControllerStatus;
    questions?: any[];
    changeSet?: any;
    artifacts?: any;
    error?: string;
    thought?: string;
    runId?: Id<"agentRuns">;
    sessionId?: Id<"agentQuestionSessions">;
};

// The core logic (helper)
export async function runControllerStepLogic(
    ctx: any,
    args: { projectId: Id<"projects">; threadId: Id<"chatThreads">; userMessage?: string }
): Promise<ControllerStepResult> {

    // 1. Read Workspace State
    // 1. Read Workspace State
    const state = await ctx.runQuery(internal.agents.controller.getWorkspaceState, {
        projectId: args.projectId
    });
    const workspace = state?.workspace;
    const latestSession = state?.latestSession;

    let finalUserMessage = args.userMessage || "Continue planning";
    if (latestSession && latestSession.status === "skipped") {
        console.log("Controller detected SKIPPED session. Injecting note.");
        const note = "\n\n[System Note: The user explicitly SKIPPED the previous structured questions session. Do NOT ask more questions immediately. Assume the user wants to proceed with current info or wants you to propose a plan based on what you have.]";
        finalUserMessage += note;
    }

    if (!workspace) {
        console.warn("Workspace not found, creating empty context.");
    }

    // 1.5 Create Agent Run
    const runId = await ctx.runMutation(internal.agentRuns.createRun, {
        projectId: args.projectId,
        agent: "controller",
        stage: workspace?.stagePinned || "planning",
        initialMessage: "Controller loop started"
    });

    // 2. Run the Brain (Controller Skill)
    console.log("Running Controller Brain...");
    await ctx.runMutation(internal.agentRuns.appendEvent, {
        runId,
        level: "info",
        message: "Invoking autonomous planner..."
    });

    const brainResult = await runSkill(ctx, {
        skillKey: "controller.autonomousPlanner",
        input: {
            ...(workspace || {}),
            projectId: args.projectId,
            stagePinned: workspace?.stagePinned || "planning",
            channelPinned: workspace?.channelPinned || "free",
            skillPinned: workspace?.skillPinned || null,
            userMessage: finalUserMessage,
            recentTranscript: (state as any)?.transcript || "",
            mode: "continue"
        }
    });

    if (!brainResult.success) {
        await ctx.runMutation(internal.agentRuns.setStatus, {
            runId,
            status: "failed",
            error: brainResult.error
        });
        return { status: "DONE", error: brainResult.error, runId };
    }

    const data = brainResult.data;
    console.log("Controller Result Data:", JSON.stringify(data, null, 2));

    const { mode, assistantSummary, questions, pendingChangeSet, skillCall, artifacts, suggestionSet } = data || {};
    const thought = assistantSummary;

    await ctx.runMutation(internal.agentRuns.appendEvent, {
        runId,
        level: "info",
        message: `Brain decided: ${mode}. Summary: ${thought?.slice(0, 50)}...`
    });

    if (!mode) {
        const err = "Controller produced no mode. Data: " + JSON.stringify(data);
        console.error(err);
        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "failed", error: err });

        return { status: "DONE", error: err, thought, runId };
    }

    // 3. Handle Decision
    if (mode === "ask_questions") {
        const stage = workspace?.stagePinned || "planning";

        // 1. Start a Structured Session (Archives old ones, creates new 'active' one)
        const sessionId = await ctx.runMutation(api.structuredQuestions.startSession, {
            projectId: args.projectId,
            stage: stage as any,
            conversationId: undefined // Controller uses chatThreads, so we don't bind to a specific projectConversation
        });

        // 2. Map Brain Questions to StructuredQuestions Schema
        // Brain: { id, text, type, options }
        // SQ: { id, title, prompt, questionType: 'text'|'boolean', expectsFreeText, ... }
        const mappedQuestions = (questions || []).map((q: any) => ({
            id: q.id,
            title: q.text,
            prompt: q.options?.join(", "), // unexpected in SQ but storing options in prompt for now
            questionType: (q.type === "select" && q.options?.includes("yes")) ? "boolean" : "text",
            expectsFreeText: true,
            blocking: true,
            stage: stage
        }));

        // 3. Create Turn 1
        await ctx.runMutation(internal.structuredQuestions.internal_createTurn, {
            projectId: args.projectId,
            stage: stage as any,
            sessionId,
            turnNumber: 1,
            questions: mappedQuestions,
            agentRunId: runId
        });

        // 4. Update Session Pointer
        await ctx.runMutation(internal.structuredQuestions.internal_updateSessionTurn, {
            sessionId,
            turnNumber: 1
        });

        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
        return { status: "STOP_QUESTIONS", questions: questions || [], thought, runId, sessionId };
    }

    if (mode === "pending_changeset") {
        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
        return { status: "STOP_APPROVAL", changeSet: pendingChangeSet, thought, runId };
    }

    if (mode === "suggestions") {
        if (suggestionSet) {
            await ctx.runMutation(api.agentSuggestionSets.create, {
                projectId: args.projectId,
                stage: workspace?.stagePinned || "planning",
                suggestionSetId: `auto-${Date.now()}`,
                sections: [{ title: suggestionSet.title || "Suggestions", items: suggestionSet.items || [] }]
            });
        }
        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
        return { status: "STOP_SUGGESTIONS", thought, runId };
    }

    if (mode === "run_skill" && skillCall) {
        const { skillKey, input } = skillCall;

        console.log(`Controller delegating to skill: ${skillKey}`);
        await ctx.runMutation(internal.agentRuns.appendEvent, {
            runId,
            level: "info",
            message: `Delegating to skill: ${skillKey}`
        });

        const subSkillResult = await runSkill(ctx, {
            skillKey,
            input: input || workspace || {}
        });

        if (!subSkillResult.success) {
            await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "failed", error: subSkillResult.error });
            return { status: "DONE", error: subSkillResult.error, thought, runId };
        }

        const subArtifacts = subSkillResult.data;

        // CHECK FOR BUBBLED UP GATES (ChangeSet / Suggestions) in subArtifacts
        // Many skills return { proposedChangeSet: ... } or { concepts: ... }

        // 1. ChangeSet Bubble Up
        if (subArtifacts && subArtifacts.proposedChangeSet) {
            await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
            return {
                status: "STOP_APPROVAL",
                changeSet: subArtifacts.proposedChangeSet,
                thought: thought + " (Proposed by " + skillKey + ")",
                runId
            };
        }

        // 2. Suggestions Bubble Up (e.g. concepts)
        if (subArtifacts && Array.isArray(subArtifacts.concepts)) {
            await ctx.runMutation(api.agentSuggestionSets.create, {
                projectId: args.projectId,
                stage: workspace?.stagePinned || "ideation",
                suggestionSetId: `auto-${Date.now()}`,
                sections: [{ title: "Generated Concepts", items: subArtifacts.concepts }]
            });
            await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
            return { status: "STOP_SUGGESTIONS", thought: thought + " (Concepts generated)", runId };
        }

        // Update workspace with artifacts
        if (workspace && subArtifacts) {
            await ctx.runMutation(internal.projectWorkspaces.updateFromController, {
                workspaceId: workspace._id,
                artifactsIndex: { ...(workspace.artifactsIndex || {}), ...subArtifacts }
            });
        }

        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });

        return {
            status: "CONTINUE",
            artifacts: subArtifacts,
            thought,
            runId
        };
    }

    if (mode === "artifacts") {
        if (workspace && artifacts) {
            await ctx.runMutation(internal.projectWorkspaces.updateFromController, {
                workspaceId: workspace._id,
                artifactsIndex: { ...(workspace.artifactsIndex || {}), ...artifacts }
            });
        }
        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
        return { status: "CONTINUE", artifacts, thought, runId };
    }

    if (mode === "done") {
        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
        return { status: "DONE", thought, runId };
    }

    await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "failed", error: "Unknown mode" });
    return { status: "DONE", thought, error: "Unknown mode", runId };
}

// The Public Action
export const runControllerStep = action({
    args: { projectId: v.id("projects"), threadId: v.id("chatThreads") },
    handler: async (ctx, args) => {
        return await runControllerStepLogic(ctx, args);
    }
});

// Internal Query
export const getWorkspaceState = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const workspace = await ctx.db
            .query("projectWorkspaces")
            .withIndex("by_project", q => q.eq("projectId", args.projectId))
            .first();

        // Fetch most recent structured session to check for skips or transcript
        const sessions = await ctx.db
            .query("structuredQuestionSessions")
            .withIndex("by_project_stage", q => q.eq("projectId", args.projectId))
            .order("desc")
            .take(1);

        const latestSession = sessions.length > 0 ? sessions[0] : null;
        let transcript = "";
        if (latestSession) {
            const turns = await ctx.db
                .query("structuredQuestionTurns")
                .withIndex("by_session_turn", (q) => q.eq("sessionId", latestSession._id))
                .collect();

            turns.sort((a, b) => a.turnNumber - b.turnNumber);

            transcript = turns.map(t => {
                const qText = (t.questions as any[]).map((q: any) => `- Q: ${q.title}`).join("\n");
                const aText = (t.answers as any[]) && (t.answers as any[]).length > 0
                    ? (t.answers as any[]).map((a: any) => `- A: [${a.quick}] ${a.text || ""}`).join("\n")
                    : "(No answers yet)";
                return `Turn ${t.turnNumber}:\n${qText}\n${aText}`;
            }).join("\n\n");
        }

        return {
            workspace,
            latestSession,
            transcript
        };
    }
});

// Mock Skill Action
export const mockSkillRun = action({
    args: { projectId: v.id("projects"), input: v.any() },
    handler: async (ctx, args) => {
        return {
            artifacts: {},
            pendingChangeSet: null
        };
    }
});

export const continueRun = action({
    args: {
        projectId: v.id("projects"),
        conversationId: v.id("projectConversations"),
        userMessage: v.optional(v.string()),
        mode: v.union(v.literal("continue"), v.literal("retry")),
        stagePinned: v.optional(v.union(v.string(), v.null())),
        skillPinned: v.optional(v.union(v.string(), v.null())),
        channelPinned: v.optional(v.union(v.string(), v.null())),
        model: v.optional(v.string()),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        // 1. Ensure Workspace
        const { workspaceId } = await ctx.runMutation(api.projectWorkspaces.ensure, {
            projectId: args.projectId,
            conversationId: args.conversationId
        });

        // 2. Run Logic
        const result = await runControllerStepLogic(ctx, {
            projectId: args.projectId,
            threadId: undefined as any,
            userMessage: args.userMessage
        });

        // 3. Map Result
        let mode = "done";
        if (result.status === "STOP_QUESTIONS") mode = "ask_questions";
        if (result.status === "STOP_APPROVAL") mode = "pending_changeset";
        if (result.status === "CONTINUE" || result.status === "STOP_SUGGESTIONS") mode = "artifacts";

        const controllerOutput = {
            mode,
            stage: args.stagePinned || "planning",
            assistantSummary: result.thought || "",
            questions: result.questions || [],
            artifacts: result.artifacts || {},
            pendingChangeSet: result.changeSet || null,
            nextSuggestedActions: []
        };

        // 4. Persist
        await ctx.runMutation(internal.projectWorkspaces.updateFromController, {
            workspaceId,
            artifactsIndex: { lastControllerOutput: controllerOutput }
        });

        return { success: true };
    }
});
