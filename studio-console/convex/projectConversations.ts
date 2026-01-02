import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

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

const appendMessage = internalMutation({
    args: {
        conversationId: v.id("projectConversations"),
        projectId: v.id("projects"),
        role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
        content: v.string(),
        stage: stageValidator,
        channel: channelValidator,
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("conversationMessages", {
            conversationId: args.conversationId,
            projectId: args.projectId,
            role: args.role,
            content: args.content,
            stage: args.stage,
            channel: args.channel,
            createdAt: Date.now(),
        });
    },
});

const touchConversation = internalMutation({
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

const countMessages = internalQuery({
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

const countUserMessages = internalQuery({
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

        const userMessages = await ctx.runQuery(countUserMessages, { conversationId: conversation._id });
        const lastUser = [...userMessages].reverse().find((message) => message.role === "user");
        if (!lastUser) {
            throw new Error("No user messages to derive title");
        }

        await ctx.runMutation(touchConversation, {
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

        const stage = conversation.stageTag;
        const channel = conversation.defaultChannel;

        if (channel !== "free") {
            throw new Error("Structured channel uses the structured questions panel.");
        }

        const contextElementIds = (conversation.contextElementIds ?? []).filter(Boolean);
        const scopeType =
            conversation.contextMode === "selected" && contextElementIds.length > 0
                ? contextElementIds.length === 1
                    ? "singleItem"
                    : "multiItem"
                : "allProject";
        const scopeItemIds = scopeType === "allProject" ? undefined : contextElementIds;

        const { threadId } = await ctx.runMutation(api.chat.ensureThread, {
            projectId: conversation.projectId,
            phase: stage,
            scenarioKey: `agent:${conversation._id}`,
            title: conversation.title,
        });

        const now = Date.now();
        await ctx.runMutation(appendMessage, {
            conversationId: conversation._id,
            projectId: conversation.projectId,
            role: "user",
            content: args.userContent,
            stage,
            channel,
        });

        await ctx.runMutation(touchConversation, {
            conversationId: conversation._id,
            updatedAt: now,
            lastMessageAt: now,
            threadId,
        });

        try {
            const result = await ctx.runAction(api.agents.flow.send, {
                threadId,
                userContent: args.userContent,
                stage,
                channel,
                mode: "generate",
                scopeType,
                scopeItemIds,
                conversationId: conversation._id,
                contextMode: conversation.contextMode,
                contextElementIds: conversation.contextElementIds,
                model: args.model,
                thinkingMode: args.thinkingMode,
            });

            await ctx.runMutation(appendMessage, {
                conversationId: conversation._id,
                projectId: conversation.projectId,
                role: "assistant",
                content: result.assistantMarkdown ?? "(empty)",
                stage,
                channel,
            });

            const userMessages = await ctx.runQuery(countUserMessages, { conversationId: conversation._id });
            const shouldAutoTitle = isAutoTitleEligible(conversation.title) && userMessages.length >= 3;
            const lastUser = [...userMessages].reverse().find((message) => message.role === "user");
            const autoTitle = shouldAutoTitle && lastUser ? normalizeTitle(lastUser.content) : undefined;

            await ctx.runMutation(touchConversation, {
                conversationId: conversation._id,
                updatedAt: Date.now(),
                lastMessageAt: Date.now(),
                threadId,
                title: autoTitle,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await ctx.runMutation(appendMessage, {
                conversationId: conversation._id,
                projectId: conversation.projectId,
                role: "system",
                content: `Error: ${message}`,
                stage,
                channel,
            });
            await ctx.runMutation(touchConversation, {
                conversationId: conversation._id,
                updatedAt: Date.now(),
                lastMessageAt: Date.now(),
                threadId,
            });
            throw error;
        }
    },
});
