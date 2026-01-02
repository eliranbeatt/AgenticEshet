import { v } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

const stageValidator = v.union(v.literal("ideation"), v.literal("planning"), v.literal("solutioning"));
const channelValidator = v.union(v.literal("free"), v.literal("structured"));

type RunStudioTurnArgs = {
    projectId: Id<"projects">;
    conversationId: Id<"projectConversations">;
    stage: "ideation" | "planning" | "solutioning";
    channel: "free" | "structured";
    payload: unknown;
};

export async function runStudioTurnHelper(ctx: ActionCtx, args: RunStudioTurnArgs) {
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

    if (args.channel === "structured") {
        const stageMap: Record<string, "clarification" | "planning" | "solutioning"> = {
            ideation: "clarification",
            planning: "planning",
            solutioning: "solutioning",
        };
        const structuredStage = stageMap[args.stage] || "clarification";
        const session = await ctx.runQuery(api.structuredQuestions.getActiveSession, {
            projectId: args.projectId,
            conversationId: args.conversationId,
            stage: structuredStage,
        });
        const sessionId = session?._id ?? await ctx.runMutation(api.structuredQuestions.startSession, {
            projectId: args.projectId,
            conversationId: args.conversationId,
            stage: structuredStage,
        });
        if (!session) {
            await ctx.runAction(api.agents.structuredQuestions.run, {
                projectId: args.projectId,
                conversationId: args.conversationId,
                stage: structuredStage,
                sessionId,
                runId: undefined as any,
            });
        }

        return {
            status: "structured" as const,
            sessionId,
            promptIdUsed: `structuredQuestions:${args.stage}`,
        };
    }

    const payload = (args.payload ?? {}) as {
        userContent?: string;
        model?: string;
        thinkingMode?: boolean;
    };
    if (!payload.userContent) {
        throw new Error("userContent is required for free chat.");
    }

    const { threadId } = await ctx.runMutation(api.chat.ensureThread, {
        projectId: conversation.projectId,
        phase: args.stage,
        scenarioKey: `agent:${conversation._id}`,
        title: conversation.title,
    });

    const now = Date.now();
    const promptIdUsed = `flow:${args.stage}:generate`;

    await ctx.runMutation(internal.projectConversations.appendMessage, {
        conversationId: conversation._id,
        projectId: conversation.projectId,
        role: "user",
        content: payload.userContent,
        stage: args.stage,
        channel: args.channel,
    });

    await ctx.runMutation(internal.projectConversations.touchConversation, {
        conversationId: conversation._id,
        updatedAt: now,
        lastMessageAt: now,
        threadId,
    });

    try {
        const result = await ctx.runAction(api.agents.flow.send, {
            threadId,
            userContent: payload.userContent,
            stage: args.stage,
            channel: args.channel,
            mode: "generate",
            scopeType:
                conversation.contextMode === "selected" && (conversation.contextElementIds ?? []).length > 0
                    ? (conversation.contextElementIds ?? []).length === 1
                        ? "singleItem"
                        : "multiItem"
                    : "allProject",
            scopeItemIds:
                conversation.contextMode === "selected" ? conversation.contextElementIds : undefined,
            conversationId: conversation._id,
            contextMode: conversation.contextMode,
            contextElementIds: conversation.contextElementIds,
            model: payload.model,
            thinkingMode: payload.thinkingMode,
        });

        await ctx.runMutation(internal.projectConversations.appendMessage, {
            conversationId: conversation._id,
            projectId: conversation.projectId,
            role: "assistant",
            content: result.assistantMarkdown ?? "(empty)",
            stage: args.stage,
            channel: args.channel,
            promptIdUsed,
        });

        const userMessages = await ctx.runQuery(internal.projectConversations.countUserMessages, {
            conversationId: conversation._id,
        });
        const shouldAutoTitle =
            conversation.title.toLowerCase().startsWith("new conversation") && userMessages.length >= 3;
        const lastUser = [...userMessages].reverse().find((message) => message.role === "user");
        const autoTitle = shouldAutoTitle && lastUser ? lastUser.content.trim().split(/\s+/).slice(0, 5).join(" ") : undefined;

        await ctx.runMutation(internal.projectConversations.touchConversation, {
            conversationId: conversation._id,
            updatedAt: Date.now(),
            lastMessageAt: Date.now(),
            threadId,
            title: autoTitle,
        });

        return {
            status: "ok" as const,
            promptIdUsed,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await ctx.runMutation(internal.projectConversations.appendMessage, {
            conversationId: conversation._id,
            projectId: conversation.projectId,
            role: "system",
            content: `Error: ${message}`,
            stage: args.stage,
            channel: args.channel,
            promptIdUsed,
        });
        await ctx.runMutation(internal.projectConversations.touchConversation, {
            conversationId: conversation._id,
            updatedAt: Date.now(),
            lastMessageAt: Date.now(),
            threadId,
        });
        throw error;
    }
}

export const runStudioTurn = action({
    args: {
        projectId: v.id("projects"),
        conversationId: v.id("projectConversations"),
        stage: stageValidator,
        channel: channelValidator,
        payload: v.any(),
    },
    handler: async (ctx, args) => runStudioTurnHelper(ctx, args),
});
