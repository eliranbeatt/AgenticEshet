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
    const workspace = await ctx.runQuery(internal.agents.controller.getWorkspaceState, {
        projectId: args.projectId
    });

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
            userMessage: args.userMessage || "Continue planning",
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
        const sessionId = await ctx.runMutation(api.projectWorkspaces.createQuestionSession, {
            projectId: args.projectId,
            stage: workspace?.stagePinned || "planning",
            questions: questions || []
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
        return await ctx.db
            .query("projectWorkspaces")
            .withIndex("by_project", q => q.eq("projectId", args.projectId))
            .first();
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
