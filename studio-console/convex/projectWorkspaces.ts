import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getByConversation = query({
    args: {
        projectId: v.id("projects"),
        conversationId: v.id("projectConversations"),
    },
    handler: async (ctx, args) => {
        const workspace = await ctx.db
            .query("projectWorkspaces")
            .withIndex("by_project_conversation", (q) =>
                q.eq("projectId", args.projectId).eq("conversationId", args.conversationId)
            )
            .first();
        return workspace ?? null;
    },
});

export const ensure = mutation({
    args: {
        projectId: v.id("projects"),
        conversationId: v.id("projectConversations"),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("projectWorkspaces")
            .withIndex("by_project_conversation", (q) =>
                q.eq("projectId", args.projectId).eq("conversationId", args.conversationId)
            )
            .first();

        if (existing) {
            return { workspaceId: existing._id };
        }

        const workspaceId = await ctx.db.insert("projectWorkspaces", {
            projectId: args.projectId,
            conversationId: args.conversationId,
            stagePinned: null,
            skillPinned: null,
            channelPinned: null,
            agentMode: "manual",
            activeSkillKey: null,
            draftOverlayEnabled: true,
            activeWorkflowRunId: null,
            lastSuggestionsState: { shownSkillKeys: [], shownAt: 0 },
            status: "idle",
            lastRunAt: Date.now(),
            facts: {},
            openQuestions: [],
            artifactsIndex: {},
            progressChecklist: {},
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        return { workspaceId };
    },
});

export const setPins = mutation({
    args: {
        workspaceId: v.id("projectWorkspaces"),
        stagePinned: v.optional(v.union(v.string(), v.null())),
        skillPinned: v.optional(v.union(v.string(), v.null())),
        channelPinned: v.optional(v.union(v.string(), v.null())),
    },
    handler: async (ctx, args) => {
        const stagePinned = args.stagePinned === "auto" ? null : args.stagePinned;
        const skillPinned = args.skillPinned === "auto" ? null : args.skillPinned;
        const channelPinned = args.channelPinned === "auto" ? null : args.channelPinned;
        await ctx.db.patch(args.workspaceId, {
            stagePinned,
            skillPinned,
            channelPinned,
            updatedAt: Date.now(),
        });
    },
});

export const setAgentMode = mutation({
    args: {
        workspaceId: v.id("projectWorkspaces"),
        agentMode: v.union(v.literal("manual"), v.literal("workflow")),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.workspaceId, {
            agentMode: args.agentMode,
            updatedAt: Date.now(),
        });
    },
});

export const setActiveSkill = mutation({
    args: {
        workspaceId: v.id("projectWorkspaces"),
        activeSkillKey: v.union(v.string(), v.null()),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.workspaceId, {
            activeSkillKey: args.activeSkillKey,
            updatedAt: Date.now(),
        });
    },
});

export const setDraftOverlayEnabled = mutation({
    args: {
        workspaceId: v.id("projectWorkspaces"),
        enabled: v.boolean(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.workspaceId, {
            draftOverlayEnabled: args.enabled,
            updatedAt: Date.now(),
        });
    },
});

export const setLastSuggestionsState = mutation({
    args: {
        workspaceId: v.id("projectWorkspaces"),
        shownSkillKeys: v.array(v.string()),
        shownAt: v.number(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.workspaceId, {
            lastSuggestionsState: {
                shownSkillKeys: args.shownSkillKeys,
                shownAt: args.shownAt,
            },
            updatedAt: Date.now(),
        });
    },
});

export const updateFromController = mutation({
    args: {
        workspaceId: v.id("projectWorkspaces"),
        stagePinned: v.optional(v.union(v.string(), v.null())),
        skillPinned: v.optional(v.union(v.string(), v.null())),
        channelPinned: v.optional(v.union(v.string(), v.null())),
        openQuestions: v.optional(v.any()),
        artifactsIndex: v.optional(v.any()),
        pendingChangeSetId: v.optional(v.union(v.id("itemChangeSets"), v.null())),
    },
    handler: async (ctx, args) => {
        const patch: Record<string, unknown> = {
            updatedAt: Date.now(),
        };

        if (args.stagePinned !== undefined) {
            patch.stagePinned = args.stagePinned === "auto" ? null : args.stagePinned;
        }
        if (args.skillPinned !== undefined) {
            patch.skillPinned = args.skillPinned === "auto" ? null : args.skillPinned;
        }
        if (args.channelPinned !== undefined) {
            patch.channelPinned = args.channelPinned === "auto" ? null : args.channelPinned;
        }
        if (args.openQuestions !== undefined) {
            patch.openQuestions = args.openQuestions;
        }
        if (args.artifactsIndex !== undefined) {
            patch.artifactsIndex = args.artifactsIndex;
        }
        if (args.pendingChangeSetId !== undefined) {
            patch.pendingChangeSetId = args.pendingChangeSetId;
        }

        await ctx.db.patch(args.workspaceId, patch as any);
    },
});

export const seedFacts = mutation({
    args: {
        workspaceId: v.id("projectWorkspaces"),
        facts: v.any()
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.workspaceId, {
            facts: args.facts,
            updatedAt: Date.now()
        });
    }
});

export const createQuestionSession = mutation({
    args: {
        projectId: v.id("projects"),
        stage: v.string(),
        questions: v.any(), // JSON array
    },
    handler: async (ctx, args) => {
        const sessionId = await ctx.db.insert("agentQuestionSessions", {
            projectId: args.projectId,
            stage: args.stage,
            asked: args.questions,
            answered: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
        return sessionId;
    }
});