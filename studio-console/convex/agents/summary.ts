import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { z } from "zod";

const SummarySchema = z.object({
    text: z.string(),
});

function buildSystemPrompt() {
    return [
        "You summarize a conversation into plain text facts.",
        "Return only text with these sections in order:",
        "Facts",
        "Preferences",
        "Constraints",
        "Open Questions",
        "",
        "Rules:",
        "- Use short bullet points.",
        "- If a section has no items, output a single bullet: (none)",
        "- Do not include any other sections or metadata.",
        "- Keep to the conversation context; do not invent details.",
    ].join("\n");
}

export const summarizeConversation = action({
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

        const messages = await ctx.runQuery(api.projectConversations.listMessages, {
            projectId: args.projectId,
            conversationId: args.conversationId,
        });

        const stageMap: Record<string, "clarification" | "planning" | "solutioning"> = {
            ideation: "clarification",
            planning: "planning",
            solutioning: "solutioning",
        };

        const structuredTranscript = await ctx.runQuery(internal.structuredQuestions.getTranscript, {
            projectId: args.projectId,
            conversationId: args.conversationId,
            stage: stageMap[conversation.stageTag] || "clarification",
        });

        const userPrompt = [
            "Conversation:",
            messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n"),
            "",
            "Structured Answers:",
            structuredTranscript || "(none)",
        ].join("\n");

        const result = await callChatWithSchema(SummarySchema, {
            systemPrompt: buildSystemPrompt(),
            userPrompt,
            model: "gpt-5-mini",
            temperature: 0.2,
        });

        return { text: result.text };
    },
});
