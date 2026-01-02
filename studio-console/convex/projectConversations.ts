import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { runStudioTurnHelper } from "./agents/orchestrator";

const stageValidator = v.union(v.literal("ideation"), v.literal("planning"), v.literal("solutioning"));
const channelValidator = v.union(v.literal("free"), v.literal("structured"));
const contextModeValidator = v.union(v.literal("none"), v.literal("selected"), v.literal("all"));

function normalizeTitle(source: string) {
    const words = source
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter(Boolean)
        .slice(0, 5);
    return words.length > 0 ? words.join(" ") : "Conversation";
}

function isAutoTitleEligible(title: string) {
    return title.trim().toLowerCase().startsWith("new conversation");
}

export const list = query({
    args: {
        projectId: v.id("projects"),
        stageTag: v.optional(stageValidator),
        includeArchived: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const status = args.includeArchived ? ["active", "archived"] : ["active"];
        const conversations: Doc<"projectConversations">[] = [];
        for (const entry of status) {
            const batch = await ctx.db
                .query("projectConversations")
                .withIndex("by_project_status_updatedAt", (q) =>
                    q.eq("projectId", args.projectId).eq("status", entry)
                )
                .order("desc")
                .collect();
            conversations.push(...batch);
        }

        const filtered = args.stageTag
            ? conversations.filter((conversation) => conversation.stageTag === args.stageTag)
            : conversations;

        return filtered.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    },
});

export const getById = query({
    args: {
        projectId: v.id("projects"),
        conversationId: v.id("projectConversations"),
    },
    handler: async (ctx, args) => {
        const conversation = await ctx.db.get(args.conversationId);
        if (!conversation || conversation.projectId !== args.projectId) {
            return null;
        }
        return conversation;
    },
});

export const listMessages = query({
    args: {
        projectId: v.id("projects"),
        conversationId: v.id("projectConversations"),
    },
    handler: async (ctx, args) => {
        const conversation = await ctx.db.get(args.conversationId);
        if (!conversation || conversation.projectId !== args.projectId) {
            return [];
        }
        return await ctx.db
            .query("conversationMessages")
            .withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", args.conversationId))
            .order("asc")
            .collect();
    },
});

export const create = mutation({
    args: {
        projectId: v.id("projects"),
        stageTag: stageValidator,
        defaultChannel: channelValidator,
        title: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const conversationId = await ctx.db.insert("projectConversations", {
            projectId: args.projectId,
            title: args.title?.trim() || "New conversation",
            stageTag: args.stageTag,
            defaultChannel: args.defaultChannel,
            contextMode: "all",
            contextElementIds: [],
            status: "active",
            createdAt: now,
            updatedAt: now,
        });
        return { conversationId };
    },
});

export const rename = mutation({
    args: { conversationId: v.id("projectConversations"), title: v.string() },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, {
            title: args.title.trim() || "Conversation",
            updatedAt: Date.now(),
        });
    },
});

export const archive = mutation({
    args: { conversationId: v.id("projectConversations") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, {
            status: "archived",
            archivedAt: Date.now(),
            updatedAt: Date.now(),
        });
    },
});

export const setStage = mutation({
    args: { conversationId: v.id("projectConversations"), stageTag: stageValidator },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, {
            stageTag: args.stageTag,
            threadId: undefined,
            updatedAt: Date.now(),
        });
    },
});

export const setChannel = mutation({
    args: { conversationId: v.id("projectConversations"), defaultChannel: channelValidator },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, {
            defaultChannel: args.defaultChannel,
            updatedAt: Date.now(),
        });
    },
});

export const setContext = mutation({
    args: {
        conversationId: v.id("projectConversations"),
        contextMode: contextModeValidator,
        contextElementIds: v.optional(v.array(v.id("projectItems"))),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, {
            contextMode: args.contextMode,
            contextElementIds: args.contextElementIds ?? [],
            updatedAt: Date.now(),
        });
    },
});

export const appendMessage = internalMutation({
    args: {
        conversationId: v.id("projectConversations"),
        projectId: v.id("projects"),
        role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
        content: v.string(),
        stage: stageValidator,
        channel: channelValidator,
        promptIdUsed: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("conversationMessages", {
            conversationId: args.conversationId,
            projectId: args.projectId,
            role: args.role,
            content: args.content,
            stage: args.stage,
            channel: args.channel,
            stageAtTime: args.stage,
            channelAtTime: args.channel,
            promptIdUsed: args.promptIdUsed,
            createdAt: Date.now(),
        });
    },
});

export const touchConversation = internalMutation({
    args: {
        conversationId: v.id("projectConversations"),
        updatedAt: v.number(),
        threadId: v.optional(v.id("chatThreads")),
        lastMessageAt: v.optional(v.number()),
        title: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, {
            updatedAt: args.updatedAt,
            lastMessageAt: args.lastMessageAt,
            threadId: args.threadId,
            ...(args.title ? { title: args.title } : {}),
        });
    },
});

export const countMessages = internalQuery({
    args: { conversationId: v.id("projectConversations") },
    handler: async (ctx, args) => {
        const messages = await ctx.db
            .query("conversationMessages")
            .withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", args.conversationId))
            .order("asc")
            .take(6);
        return messages;
    },
});

export const countUserMessages = internalQuery({
    args: { conversationId: v.id("projectConversations") },
    handler: async (ctx, args) => {
        const messages = await ctx.db
            .query("conversationMessages")
            .withIndex("by_conversation_createdAt", (q) => q.eq("conversationId", args.conversationId))
            .order("asc")
            .collect();
        return messages.filter((message) => message.role === "user");
    },
});

export const regenerateTitle = action({
    args: {
        projectId: v.id("projects"),
        conversationId: v.id("projectConversations"),
    },
    handler: async (ctx, args) => {
        const conversation = await ctx.runQuery(api.projectConversations.getById, {
            projectId: args.projectId,
            conversationId: args.conversationId,
        });
        if (!conversation) {
            throw new Error("Conversation not found");
        }

        const userMessages = await ctx.runQuery(internal.projectConversations.countUserMessages, { conversationId: conversation._id });
        const lastUser = [...userMessages].reverse().find((message) => message.role === "user");
        if (!lastUser) {
            throw new Error("No user messages to derive title");
        }

        await ctx.runMutation(internal.projectConversations.touchConversation, {
            conversationId: conversation._id,
            updatedAt: Date.now(),
            title: normalizeTitle(lastUser.content),
        });
    },
});

export const sendMessage = action({
    args: {
        projectId: v.id("projects"),
        conversationId: v.id("projectConversations"),
        userContent: v.string(),
        model: v.optional(v.string()),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        console.log("DEBUG sendMessage - api.agents:", api.agents);
        console.log("DEBUG sendMessage - api.agents?.orchestrator:", api.agents?.orchestrator);
        console.log("DEBUG sendMessage - api.agents?.orchestrator?.runStudioTurn:", api.agents?.orchestrator?.runStudioTurn);

        const conversation = await ctx.runQuery(api.projectConversations.getById, {
            projectId: args.projectId,
            conversationId: args.conversationId,
        });

        if (!conversation) {
            throw new Error("Conversation not found");
        }
        if (conversation.status === "archived") {
            throw new Error("Conversation is archived");
        }

        if (conversation.defaultChannel !== "free") {
            throw new Error("Structured channel uses the structured questions panel.");
        }

        return await runStudioTurnHelper(ctx, {
            projectId: args.projectId,
            conversationId: args.conversationId,
            stage: conversation.stageTag,
            channel: "free",
            payload: {
                userContent: args.userContent,
                model: args.model,
                thinkingMode: args.thinkingMode,
            },
        });
    },
});
