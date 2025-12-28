import { v } from "convex/values";
import { action, internalQuery } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { ChangeSetSchema } from "../lib/zodSchemas";
import type { Doc, Id } from "../_generated/dataModel";

const SYSTEM_PROMPT = `You are an expert Project Manager and Quantity Surveyor for a creative studio.
Your goal is to analyze project items and suggest improvements or next steps via a structured ChangeSet.
You can create tasks, materials, accounting lines, or modify existing items.
Always be precise with costs and quantities. Use your knowledge of production (print, carpentry, events) to fill in gaps.
`;

export const getContext = internalQuery({
    args: { projectId: v.id("projects"), itemIds: v.array(v.id("projectItems")) },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");

        const items = await Promise.all(
            args.itemIds.map(async (id) => {
                const item = await ctx.db.get(id);
                return item;
            })
        );

        // Filter out nulls if any (shouldn't happen with valid IDs)
        const validItems = items.filter((i): i is Doc<"projectItems"> => !!i);

        return {
            project,
            items: validItems,
        };
    },
});

export const generateBatch = action({
    args: {
        projectId: v.id("projects"),
        itemIds: v.array(v.id("projectItems")),
        strategy: v.string(), // "initial_breakdown", "material_fill", "sanity_check"
        userInstructions: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const context = await ctx.runQuery(internal.agents.suggestions.getContext, {
            projectId: args.projectId,
            itemIds: args.itemIds,
        });

        const prompt = `
Project: ${context.project.name}
Strategy: ${args.strategy}
User Instructions: ${args.userInstructions ?? "None"}

Items to Analyze:
${JSON.stringify(context.items, null, 2)}

Generate a ChangeSet that addresses the strategy.
- If "initial_breakdown": Create tasks and material lines for the items.
- If "material_fill": Focus on missing materials.
- If "sanity_check": Look for missing dependencies or unrealistic costs.

Ensure all new entities have 'tempId' and references are correct.
        `;

        const response = await callChatWithSchema(
            ctx,
            SYSTEM_PROMPT,
            prompt,
            ChangeSetSchema,
            {
                model: "gpt-4o", // or use setting
                temperature: 0.2, // Structured output needs lower temp
            }
        );

        if (!response) {
            throw new Error("Parameters generation failed"); // callChatWithSchema returns T | null? Checking...
        }

        // Ensure projectId matches
        response.projectId = args.projectId;
        response.agentName = "suggestions";

        await ctx.runMutation(api.changeSets.create, { changeSet: response });

        return { success: true };
    },
});
