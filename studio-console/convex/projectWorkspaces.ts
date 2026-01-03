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
        await ctx.db.patch(args.workspaceId, {
            stagePinned: args.stagePinned,
            skillPinned: args.skillPinned,
            channelPinned: args.channelPinned,
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
        await ctx.db.patch(args.workspaceId, {
            stagePinned: args.stagePinned,
            skillPinned: args.skillPinned,
            channelPinned: args.channelPinned,
            openQuestions: args.openQuestions,
            artifactsIndex: args.artifactsIndex,
            pendingChangeSetId: args.pendingChangeSetId ?? undefined,
            updatedAt: Date.now(),
        });
    },
});
