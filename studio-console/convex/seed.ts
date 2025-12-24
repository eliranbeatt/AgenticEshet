import { mutation } from "./_generated/server";
import {
    accountingPrompt,
    architectPrompt,
    changeSetSchemaText,
    chatRules,
    clarificationPrompt,
    convertToItemPrompt,
    deepResearchPrompt,
    extractGuardrails,
    ideationPrompt,
    itemEditorPrompt,
    itemTypeDefinitions,
    planningPrompt,
    quotePrompt,
    sharedContextContract,
    solutioningPrompt,
    tasksPrompt,
} from "./prompts/itemsPromptPack";

// Public mutation for UI button access
export const seedSkillsPublic = mutation({
    handler: async (ctx) => {
        const sharedPrefix = [sharedContextContract, extractGuardrails, chatRules, itemTypeDefinitions].join("\n\n");
        const changeSetPrefix = [sharedPrefix, changeSetSchemaText].join("\n\n");

        const skills = [
            {
                name: "ideation",
                type: "agent_system",
                content: [sharedPrefix, ideationPrompt].join("\n\n"),
                metadata: { phase: "ideation" },
            },
            {
                name: "convert_to_item",
                type: "agent_system",
                content: [changeSetPrefix, convertToItemPrompt].join("\n\n"),
                metadata: { phase: "convert" },
            },
            {
                name: "clarification",
                type: "agent_system",
                content: [sharedPrefix, clarificationPrompt].join("\n\n"),
                metadata: { phase: "clarification" },
            },
            {
                name: "planning",
                type: "agent_system",
                content: [changeSetPrefix, planningPrompt].join("\n\n"),
                metadata: { phase: "planning" },
            },
            {
                name: "solutioning",
                type: "agent_system",
                content: [changeSetPrefix, solutioningPrompt].join("\n\n"),
                metadata: { phase: "solutioning" },
            },
            {
                name: "accounting",
                type: "agent_system",
                content: [changeSetPrefix, accountingPrompt].join("\n\n"),
                metadata: { phase: "accounting" },
            },
            {
                name: "tasks",
                type: "agent_system",
                content: [changeSetPrefix, tasksPrompt].join("\n\n"),
                metadata: { phase: "tasks" },
            },
            {
                name: "quote",
                type: "agent_system",
                content: [sharedPrefix, quotePrompt].join("\n\n"),
                metadata: { phase: "quote" },
            },
            {
                name: "deep_research",
                type: "agent_system",
                content: [sharedPrefix, deepResearchPrompt].join("\n\n"),
                metadata: { phase: "deep_research" },
            },
            {
                name: "item_editor",
                type: "agent_system",
                content: [changeSetPrefix, itemEditorPrompt].join("\n\n"),
                metadata: { phase: "item_edit" },
            },
            {
                name: "architect",
                type: "agent_system",
                content: [sharedPrefix, architectPrompt].join("\n\n"),
                metadata: { phase: "tasks" },
            },
        ];

        for (const skill of skills) {
            const existing = await ctx.db
                .query("skills")
                .withIndex("by_name", (q) => q.eq("name", skill.name))
                .first();

            if (!existing) {
                await ctx.db.insert("skills", {
                    name: skill.name,
                    type: skill.type,
                    content: skill.content,
                    metadataJson: JSON.stringify(skill.metadata),
                });
            } else {
                await ctx.db.patch(existing._id, {
                    content: skill.content,
                    metadataJson: JSON.stringify(skill.metadata),
                });
            }
        }
    },
});
