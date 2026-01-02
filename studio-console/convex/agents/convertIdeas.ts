import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { ChangeSetSchema } from "../lib/zodSchemas";
import {
    changeSetSchemaText,
    convertToItemPrompt,
    extractGuardrails,
    sharedContextContract,
} from "../prompts/itemsPromptPack";
import { summarizeItems, summarizeKnowledgeBlocks, summarizeElementSnapshots } from "../lib/contextSummary";
import { buildBrainContext } from "../lib/brainContext";

function normalizeChangeSet(input: any, projectId: string) {
    const base = ChangeSetSchema.parse(input);
    return {
        ...base,
        projectId,
        phase: "convert",
        agentName: base.agentName || "IDEA_CONVERT",
        items: {
            create: base.items.create,
            patch: base.items.patch,
            deleteRequest: base.items.deleteRequest,
        },
        tasks: { create: [], patch: [], dependencies: [] },
        accountingLines: { create: [], patch: [] },
    };
}

export const createChangeSet = action({
    args: {
        projectId: v.id("projects"),
        selectionId: v.id("ideaSelections"),
        model: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const selection = await ctx.db.get(args.selectionId);
        if (!selection) throw new Error("Idea selection not found");
        if (selection.projectId !== args.projectId) {
            throw new Error("Idea selection does not match project");
        }

        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");

        const cards = await Promise.all(selection.conceptCardIds.map((id) => ctx.db.get(id)));
        const concepts = cards.filter(Boolean).map((card) => ({
            id: card!._id,
            title: card!.title,
            oneLiner: card!.oneLiner,
            detailsMarkdown: card!.detailsMarkdown,
        }));

        const factsContext = project.features?.factsEnabled === false
            ? { bullets: "(facts disabled)" }
            : await ctx.runAction(internal.factsV2.getFactsContext, {
                projectId: args.projectId,
                scopeType: "project",
                queryText: selection.notes ?? project.name,
            });

        const brain = await ctx.runQuery(api.projectBrain.getCurrent, {
            projectId: args.projectId,
        });

        const knowledgeBlocks = await ctx.runQuery(api.facts.listBlocks, {
            projectId: args.projectId,
        });

        const { items } = await ctx.runQuery(api.items.listSidebarTree, {
            projectId: args.projectId,
            includeDrafts: true,
        });

        const elementSnapshots = project.features?.elementsCanonical
            ? await ctx.runQuery(internal.elementVersions.getActiveSnapshotsByItemIds, {
                itemIds: items.map((item) => item._id),
            })
            : [];
        const elementSnapshotsSummary = project.features?.elementsCanonical
            ? summarizeElementSnapshots(elementSnapshots, 20)
            : "(none)";

        const systemPrompt = [
            sharedContextContract,
            extractGuardrails,
            changeSetSchemaText,
            convertToItemPrompt,
        ].join("\n\n");

        const userPrompt = [
            `PROJECT: ${project.name}`,
            `CLIENT: ${project.clientName}`,
            `DEFAULT_LANGUAGE: ${project.defaultLanguage ?? "he"}`,
            "",
            "ELEMENT SNAPSHOTS (CANONICAL - OVERRIDES KNOWLEDGE/CHAT):",
            elementSnapshotsSummary,
            "",
            "PROJECT BRAIN (AUTHORITATIVE - OVERRIDES CHAT):",
            brain ? buildBrainContext(brain) : "(none)",
            "",
            "KNOWN FACTS (accepted + high-confidence proposed):",
            factsContext.bullets,
            "",
            "KNOWLEDGE BLOCKS:",
            summarizeKnowledgeBlocks(knowledgeBlocks ?? []),
            "",
            "CURRENT ITEMS SUMMARY:",
            summarizeItems(items ?? []),
            "",
            "SELECTED IDEAS:",
            JSON.stringify(
                {
                    selectionId: selection._id,
                    notes: selection.notes ?? "",
                    concepts,
                },
                null,
                2,
            ),
            "",
            "TASK: Convert selected ideas into element ChangeSet (items.create/items.patch only).",
            "REQUIREMENTS: Fill basedOnBulletIds with Brain bullet IDs you used. Set basedOnApprovedSnapshotId when modifying existing elements. Add conflictsReferenced if applicable.",
        ].join("\n");

        try {
            const result = await callChatWithSchema(ChangeSetSchema, {
                model: args.model,
                systemPrompt,
                userPrompt,
                maxRetries: 2,
                language: project.defaultLanguage === "en" ? "en" : "he",
            });

            const normalized = normalizeChangeSet(result, String(args.projectId));
            const { changeSetId } = await ctx.runMutation(api.changeSets.create, { changeSet: normalized });
            await ctx.runMutation(api.changeSets.setIdeaSelection, {
                changeSetId,
                ideaSelectionId: args.selectionId,
            });
            await ctx.runMutation(api.ideaSelections.markConverted, {
                selectionId: args.selectionId,
                changeSetId,
            });

            return { changeSetId };
        } catch (error) {
            await ctx.runMutation(api.ideaSelections.markFailed, { selectionId: args.selectionId });
            throw error;
        }
    },
});
