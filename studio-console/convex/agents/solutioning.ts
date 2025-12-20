import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { ItemSpecV2Schema, type ItemSpecV2 } from "../lib/zodSchemas";
import { syncItemProjections } from "../lib/itemProjections";
import type { Doc, Id } from "../_generated/dataModel";
import { z } from "zod";

const SolutioningResponseSchema = z.object({
    response: z.string().describe("The conversational response to the user, in Hebrew."),
    suggestedPlan: z.optional(z.string().describe("A drafted technical plan for the item, if enough information is gathered. In Markdown.")),
    isComplete: z.boolean().describe("True if the solution seems fully defined and ready to be applied."),
});

function parseItemSpec(data: unknown): ItemSpecV2 | null {
    const parsed = ItemSpecV2Schema.safeParse(data);
    if (!parsed.success) return null;
    return parsed.data;
}

function buildBaseItemSpec(item: Doc<"projectItems">): ItemSpecV2 {
    return ItemSpecV2Schema.parse({
        version: "ItemSpecV2",
        identity: {
            title: item.title,
            typeKey: item.typeKey,
        },
    });
}

function findSolutioningDraft(revisions: Doc<"itemRevisions">[]) {
    return revisions
        .filter((rev) => rev.tabScope === "solutioning" && rev.state === "proposed")
        .sort((a, b) => b.revisionNumber - a.revisionNumber)[0] ?? null;
}

function findApprovedRevision(
    revisions: Doc<"itemRevisions">[],
    approvedRevisionId?: Id<"itemRevisions">
) {
    if (!approvedRevisionId) return null;
    return revisions.find((rev) => rev._id === approvedRevisionId) ?? null;
}

function resolveActiveSpec(item: Doc<"projectItems">, revisions: Doc<"itemRevisions">[]) {
    const draft = findSolutioningDraft(revisions);
    const approved = findApprovedRevision(revisions, item.approvedRevisionId);
    const active = draft ?? approved;
    const spec = active ? parseItemSpec(active.data) : null;
    return {
        draft,
        approved,
        active,
        spec: spec ?? buildBaseItemSpec(item),
    };
}

// 1. GET DATA (Public)
export const getPlanningItems = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const statuses: Array<"approved" | "draft"> = ["approved", "draft"];
        const items: Doc<"projectItems">[] = [];

        for (const status of statuses) {
            const batch = await ctx.db
                .query("projectItems")
                .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", status))
                .collect();
            items.push(...batch);
        }

        items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

        const results = [];
        for (const item of items) {
            const revisions = await ctx.db
                .query("itemRevisions")
                .withIndex("by_item_revision", (q) => q.eq("itemId", item._id))
                .collect();

            const { draft, spec } = resolveActiveSpec(item, revisions);
            const planMarkdown = spec.studioWork?.buildPlanMarkdown;
            const planJson = spec.studioWork?.buildPlanJson;
            const planState = draft ? "draft" : planMarkdown || planJson ? "approved" : "none";

            results.push({
                _id: item._id,
                title: item.title,
                typeKey: item.typeKey,
                status: item.status,
                description: spec.identity.description,
                tags: spec.identity.tags,
                planMarkdown,
                planJson,
                planState,
            });
        }

        return results;
    },
});

export const getConversation = query({
    args: { projectId: v.id("projects"), itemId: v.id("projectItems") },
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
    args: { projectId: v.id("projects"), itemId: v.id("projectItems") },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        const item = await ctx.db.get(args.itemId);

        const conversation = await ctx.db
            .query("conversations")
            .withIndex("by_project_phase", (q) => q.eq("projectId", args.projectId).eq("phase", "solutioning"))
            .filter((q) => q.eq(q.field("agentRole"), `solutioning:${args.itemId}`))
            .unique();

        if (!item) {
            return {
                project,
                item: null,
                spec: null,
                conversationId: conversation?._id,
                messagesJson: conversation?.messagesJson,
            };
        }

        const revisions = await ctx.db
            .query("itemRevisions")
            .withIndex("by_item_revision", (q) => q.eq("itemId", item._id))
            .collect();

        const { spec } = resolveActiveSpec(item, revisions);

        return {
            project,
            item,
            spec,
            conversationId: conversation?._id,
            messagesJson: conversation?.messagesJson,
        };
    },
});

export const saveChatHistory = internalMutation({
    args: {
        projectId: v.id("projects"),
        itemId: v.id("projectItems"),
        messagesJson: v.string(),
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
        itemId: v.id("projectItems"),
        solutionPlan: v.string(),
        solutionPlanJson: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const item = await ctx.db.get(args.itemId);
        if (!item) throw new Error("Item not found");

        const planMarkdown = args.solutionPlan.trim();
        const { revisionId } = await ctx.runMutation(internal.agents.solutioningV2.saveDraftPlan, {
            itemId: args.itemId,
            solutionPlan: planMarkdown,
            solutionPlanJson: args.solutionPlanJson,
            createdBy: "user",
        });

        const revision = await ctx.db.get(revisionId);
        if (!revision) throw new Error("Revision not found");

        const now = Date.now();
        if (item.approvedRevisionId && item.approvedRevisionId !== revisionId) {
            await ctx.db.patch(item.approvedRevisionId, { state: "superseded" });
        }

        await ctx.db.patch(revisionId, { state: "approved" });
        await ctx.db.patch(item._id, {
            approvedRevisionId: revisionId,
            status: "approved",
            updatedAt: now,
        });

        const spec = parseItemSpec(revision.data);
        if (spec) {
            await syncItemProjections(ctx, { item, revision, spec, force: true });
        }

        return { solutioned: true };
    },
});

type Message = { role: "user" | "assistant" | "system"; content: string };

export const chat = action({
    args: {
        projectId: v.id("projects"),
        itemId: v.id("projectItems"),
        message: v.string(),
        useWebSearch: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const { project, item, spec, messagesJson } = await ctx.runQuery(internal.agents.solutioning.getChatContext, {
            projectId: args.projectId,
            itemId: args.itemId,
        });

        const settings = await ctx.runQuery(internal.settings.getAll);
        const model = settings.modelConfig?.solutioning || "gpt-5.2";

        if (!item || !spec) throw new Error("Item not found");

        let messages: Message[] = [];
        if (messagesJson) {
            try {
                messages = JSON.parse(messagesJson);
            } catch (e) {
                console.error("Failed to parse conversation", e);
            }
        }

        const identity = spec.identity;
        const tags = identity.tags?.join(", ") || "None";
        const plan = spec.studioWork?.buildPlanMarkdown ?? "Not active yet.";

        const systemPrompt = `You are a Production Solutioning Expert for a creative studio.
        Your goal is to help the user define exactly HOW to produce or procure a specific item.
        
        Project: ${project?.name}
        Item: ${identity.title} (${identity.typeKey})
        Description: ${identity.description ?? "None"}
        Tags: ${tags}
        Accounting group: ${identity.accountingGroup ?? "None"}
        
        Current Solution Plan: ${plan}
        
        Instructions:
        - Analyze the item and suggest the best production methods, materials, and tools.
        - If the user explicitly asks for search, or 'useWebSearch' is ON, simulate/perform search (internal knowledge or pretend external).
        - Be practical, efficient, and cost-aware.
        - Engage in a conversation. Ask clarifying questions.
        - If you have a solid recommendation, provide a "Suggested Plan" snippet (Markdown) that describes the production steps/materials clearly.
        - LANGUAGE: Hebrew (User facing). Technical terms can be English.

        REQUIRED OUTPUT FORMAT:
        You must return a valid JSON object with the following fields:
        {
            "response": "Your conversational reply in Hebrew",
            "suggestedPlan": "Optional: The complete markdown plan content if you are proposing one",
            "isComplete": boolean // true if the user has agreed to a final plan and you are submitting it
        }
        `;

        const userMessage: Message = { role: "user", content: args.message };
        const messagesForLlm = [...messages, userMessage];
        const recentMessages = messagesForLlm.slice(-10);

        const result = await callChatWithSchema(SolutioningResponseSchema, {
            model,
            systemPrompt,
            userPrompt: args.message,
            additionalMessages: recentMessages.slice(0, -1),
            thinkingMode: false,
        });

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
