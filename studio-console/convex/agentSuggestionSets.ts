import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listLatestByConversation = query({
    args: {
        projectId: v.id("projects"),
        conversationId: v.id("projectConversations"),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const limit = Math.max(1, Math.min(args.limit ?? 5, 10));
        return await ctx.db
            .query("agentSuggestionSets")
            .withIndex("by_project_conversation", (q) =>
                q.eq("projectId", args.projectId).eq("conversationId", args.conversationId)
            )
            .order("desc")
            .take(limit);
    },
});

export const create = mutation({
    args: {
        projectId: v.id("projects"),
        conversationId: v.optional(v.id("projectConversations")),
        stage: v.string(),
        suggestionSetId: v.string(),
        sections: v.any(),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("agentSuggestionSets", {
            projectId: args.projectId,
            conversationId: args.conversationId,
            threadId: undefined,
            stage: args.stage,
            suggestionSetId: args.suggestionSetId,
            sections: args.sections,
            createdAt: Date.now(),
            createdBy: "agent",
        });
    },
});
