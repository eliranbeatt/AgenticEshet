import { action, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";

// 2. Controller Implementation

export type ControllerStatus = "CONTINUE" | "STOP_QUESTIONS" | "STOP_APPROVAL" | "DONE";

export type ControllerStepResult = {
    status: ControllerStatus;
    questions?: any[];
    changeSet?: any;
    artifacts?: any;
    error?: string;
};

// The core logic (helper)
export async function runControllerStepLogic(
    ctx: any,
    args: { projectId: Id<"projects">; threadId: Id<"chatThreads"> }
): Promise<ControllerStepResult> {

    // 1. Read Workspace State
    const workspace = await ctx.runQuery(internal.agents.controller.getWorkspaceState, {
        projectId: args.projectId
    });

    if (!workspace) {
        // For testing/prototyping, if no workspace, we can't do much.
        // Or we treat it as empty.
        // throw new Error("Workspace not found");
        // Let's return DONE if not found to be safe? Or throw.
        // Test expects it to work if mocked.
    }

    // 2. Gate: Missing Info (Question Gate)
    // Simple logic: if facts are empty and stage is ideation, ask questions.
    if (workspace?.stagePinned === "ideation" && Object.keys(workspace.facts || {}).length === 0) {
        return {
            status: "STOP_QUESTIONS",
            questions: [
                { id: "q1", text: "What is the event date?", type: "date" },
                { id: "q2", text: "What is the location?", type: "text" },
                { id: "q3", text: "What is the budget?", type: "number" },
                { id: "q4", text: "Any style constraints?", type: "text" },
                { id: "q5", text: "Who is the audience?", type: "text" },
            ]
        };
    }

    // 3. Run Skill (Simulation)
    const skillResult = await ctx.runAction(internal.agents.controller.mockSkillRun, {
        projectId: args.projectId,
        input: workspace?.facts || {}
    });

    if (skillResult.pendingChangeSet) {
        return {
            status: "STOP_APPROVAL",
            changeSet: skillResult.pendingChangeSet
        };
    }

    return {
        status: "CONTINUE",
        artifacts: skillResult.artifacts
    };
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
        // This is just a stub for the test to mock/spy on.
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
        // We use the public 'ensure' mutation (or internal if valid) to get the workspace ID
        // Since we are in an action, we runMutation
        const { workspaceId } = await ctx.runMutation(api.projectWorkspaces.ensure, {
            projectId: args.projectId,
            conversationId: args.conversationId
        });

        // 2. Handle User Message (Append to conversation)
        if (args.userMessage) {
            // We can use api.projectConversations.sendMessage or internal appendMessage.
            // sendMessage validates and runs studio turn.
            // If we use sendMessage, it might duplicate logic if we also want to run custom controller logic.
            // But for now, let's just append it as a user message if it's not already handled.
            // Actually, the frontend calls runControllerWithMessage which passes the message.

            // Let's assume we just want to acknowledge it for this fix.
            // We'll trust the Orchestrator/Flow to handle the actual chat in a real implementation.
        }

        // 3. Update Workspace State (Mock for now to satisfy UI)
        // The UI expects artifactsIndex.lastControllerOutput
        const mockOutput = {
            mode: "done",
            stage: args.stagePinned || "planning",
            assistantSummary: "The controller received your request. (Logic not fully implemented)",
            questions: [],
            artifacts: {},
            pendingChangeSet: null,
            nextSuggestedActions: []
        };

        await ctx.runMutation(internal.projectWorkspaces.updateFromController, {
            workspaceId,
            artifactsIndex: { lastControllerOutput: mockOutput }
        });

        return { success: true };
    }
});