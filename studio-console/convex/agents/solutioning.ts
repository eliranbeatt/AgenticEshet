import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { z } from "zod";

// Schema for the agent's response
const SolutioningResponseSchema = z.object({
    response: z.string().describe("The conversational response to the user, in Hebrew."),
    suggestedPlan: z.optional(z.string().describe("A drafted technical plan for the item, if enough information is gathered. In Markdown.")),
    isComplete: z.boolean().describe("True if the solution seems fully defined and ready to be applied."),
});

// 1. GET DATA (Public)
export const getPlanningItems = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const materialLines = await ctx.db
            .query("materialLines")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const sections = await ctx.db
            .query("sections")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const sectionMap = new Map(sections.map(s => [s._id, s]));

        return materialLines.map(line => ({
            _id: line._id,
            label: line.label,
            category: line.category,
            sectionName: sectionMap.get(line.sectionId)?.name || "Unknown Section",
            group: sectionMap.get(line.sectionId)?.group || "General",
            status: line.status,
            note: line.note,
            solutioned: line.solutioned,
            solutionPlan: line.solutionPlan,
            plannedQuantity: line.plannedQuantity,
            unit: line.unit,
        }));
    },
});

export const getConversation = query({
    args: { projectId: v.id("projects"), itemId: v.id("materialLines") },
    handler: async (ctx, args) => {
        const conversation = await ctx.db
            .query("conversations")
            .withIndex("by_project_phase", (q) => q.eq("projectId", args.projectId).eq("phase", "solutioning"))
            .filter((q) => q.eq(q.field("agentRole"), `solutioning:${args.itemId}`))
            .unique();

        if (!conversation) return [];

        try {
            return JSON.parse(conversation.messagesJson) as { role: "user" | "assistant" | "system", content: string }[];
        } catch {
            return [];
        }
    },
});

// 2. HELPERS FOR ACTION (Internal)

export const getChatContext = internalQuery({
    args: { projectId: v.id("projects"), itemId: v.id("materialLines") },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        const item = await ctx.db.get(args.itemId);

        const conversation = await ctx.db
            .query("conversations")
            .withIndex("by_project_phase", (q) => q.eq("projectId", args.projectId).eq("phase", "solutioning"))
            .filter((q) => q.eq(q.field("agentRole"), `solutioning:${args.itemId}`))
            .unique();

        return {
            project,
            item,
            conversationId: conversation?._id,
            messagesJson: conversation?.messagesJson,
        };
    },
});

export const saveChatHistory = internalMutation({
    args: {
        projectId: v.id("projects"),
        itemId: v.id("materialLines"),
        messagesJson: v.string(), // JSON string of Message[]
    },
    handler: async (ctx, args) => {
        const conversation = await ctx.db
            .query("conversations")
            .withIndex("by_project_phase", (q) => q.eq("projectId", args.projectId).eq("phase", "solutioning"))
            .filter((q) => q.eq(q.field("agentRole"), `solutioning:${args.itemId}`))
            .unique();

        if (conversation) {
            await ctx.db.patch(conversation._id, {
                messagesJson: args.messagesJson,
            });
        } else {
            await ctx.db.insert("conversations", {
                projectId: args.projectId,
                phase: "solutioning",
                agentRole: `solutioning:${args.itemId}`,
                messagesJson: args.messagesJson,
                createdAt: Date.now(),
            });
        }
    },
});

// 3. MUTATIONS / ACTIONS (Public)

export const updateSolution = mutation({
    args: {
        itemId: v.id("materialLines"),
        solutionPlan: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.itemId, {
            solutioned: true,
            solutionPlan: args.solutionPlan,
            lastUpdatedBy: "solutioning_agent", // or user
            updatedAt: Date.now(),
        });
    },
});

type Message = { role: "user" | "assistant" | "system"; content: string };

export const chat = action({
    args: {
        projectId: v.id("projects"),
        itemId: v.id("materialLines"),
        message: v.string(),
        useWebSearch: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        // 1. Get Context
        const { project, item, messagesJson } = await ctx.runQuery(internal.agents.solutioning.getChatContext, {
            projectId: args.projectId,
            itemId: args.itemId,
        });

        if (!item) throw new Error("Item not found");

        let messages: Message[] = [];
        if (messagesJson) {
            try {
                messages = JSON.parse(messagesJson);
            } catch (e) {
                console.error("Failed to parse conversation", e);
            }
        }

        // 2. Prompt
        const systemPrompt = `You are a Production Solutioning Expert for a creative studio.
        Your goal is to help the user define exactly HOW to produce or procure a specific item.
        
        Project: ${project?.name}
        Item: ${item.label} (${item.category})
        Quantity: ${item.plannedQuantity} ${item.unit}
        Note: ${item.note || "None"}
        
        Current Solution Plan: ${item.solutionPlan || "Not active yet."}
        
        Instructions:
        - Analyze the item and suggest the best production methods, materials, and tools.
        - If the user explicitly asks for search, or 'useWebSearch' is ON, simulate/perform search (internal knowledge or pretend external).
        - Be practical, efficient, and cost-aware.
        - Engage in a conversation. Ask clarifying questions.
        - If you have a solid recommendation, provide a "Suggested Plan" snippet (Markdown) that describes the production steps/materials clearly.
        - LANGUAGE: Hebrew (User facing). Technical terms can be English.
        `;

        const userMessage: Message = { role: "user", content: args.message };
        const messagesForLlm = [...messages, userMessage];
        const recentMessages = messagesForLlm.slice(-10);

        // 3. LLM Call
        const result = await callChatWithSchema(SolutioningResponseSchema, {
            systemPrompt,
            userPrompt: args.message, // Last message
            additionalMessages: recentMessages.slice(0, -1), // History
            thinkingMode: false,
        });

        // 4. Save History
        const assistantMessage: Message = { role: "assistant", content: result.response };
        const updatedMessages = [...messages, userMessage, assistantMessage];

        await ctx.runMutation(internal.agents.solutioning.saveChatHistory, {
            projectId: args.projectId,
            itemId: args.itemId,
            messagesJson: JSON.stringify(updatedMessages),
        });

        return result;
    },
});
