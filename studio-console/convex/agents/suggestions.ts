import { v } from "convex/values";
import { action, internalQuery } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { summarizeElementSnapshots } from "../lib/contextSummary";
import { AgentSuggestionOutputSchema, ChangeSetSchema } from "../lib/zodSchemas";
import { buildBrainContext } from "../lib/brainContext";
import type { Doc, Id } from "../_generated/dataModel";
import { buildSearchText } from "../lib/itemHelpers";

const SYSTEM_PROMPT = `You are an expert Project Manager and Quantity Surveyor for a creative studio.
Your goal is to analyze project items and suggest improvements or next steps.
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
                // For canonical flow, we might want the active snapshot. 
                // But for now, returning the item doc is a start. 
                // Agents should ideally look at the snapshot if available.
                let snapshot = null;
                if (project.features?.elementsCanonical && item?.activeVersionId) {
                    const ver = await ctx.db.get(item.activeVersionId);
                    snapshot = ver?.snapshot;
                }
                return { ...item, snapshot };
            })
        );

        // Filter out nulls if any (shouldn't happen with valid IDs)
        const validItems = items.filter((i): i is Doc<"projectItems"> & { snapshot?: unknown } => !!i && !!i._id);

        let currentKnowledge = "";
        if (project.features?.elementsCanonical) {
            const brain = await ctx.db
                .query("projectBrains")
                .withIndex("by_project", q => q.eq("projectId", args.projectId))
                .unique();
            currentKnowledge = brain ? buildBrainContext(brain) : "";
        }

        return {
            project,
            items: validItems,
            currentKnowledge,
        };
    },
});

export const generateBatch = action({
    args: {
        projectId: v.id("projects"),
        itemIds: v.array(v.id("projectItems")),
        strategy: v.string(), // "initial_breakdown", "material_fill", "sanity_check"
        phase: v.optional(v.union(
            v.literal("planning"),
            v.literal("solutioning"),
            v.literal("accounting"),
            v.literal("tasks"),
            v.literal("item_edit"),
            v.literal("convert"),
            v.literal("element_edit"),
            v.literal("procurement"),
            v.literal("runbook"),
            v.literal("closeout")
        )),
        userInstructions: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const context = await ctx.runQuery(internal.agents.suggestions.getContext, {
            projectId: args.projectId,
            itemIds: args.itemIds,
        });

        const canonical = context.project.features?.elementsCanonical;

        if (canonical) {
             const snapshotsSummary = summarizeElementSnapshots(
                context.items.map((item) => ({
                    itemId: item._id,
                    title: item.title,
                    typeKey: item.typeKey,
                    snapshot: item.snapshot ?? null,
                })),
                20
            );

             const prompt = `
Project: ${context.project.name}
Strategy: ${args.strategy}
User Instructions: ${args.userInstructions ?? "None"}
Element Snapshots (canonical, overrides knowledge/chat):
${snapshotsSummary}
Project Brain: ${context.currentKnowledge}

Items to Analyze:
${JSON.stringify(context.items.map(i => ({ 
    id: i._id, 
    title: i.title, 
    type: i.typeKey, 
    activeVersionId: i.activeVersionId ?? null,
    snapshot: i.snapshot ?? "No snapshot (legacy)" 
})), null, 2)}

Output a valid JSON matching AgentSuggestionOutputSchema.
Mode: ${args.strategy} (map strictly to enum if possible, or use 'planning'/'improve')
Action: create_element or update_element.
For update_element, you MUST provide targetElementId and baseVersionId (if available).
For create_element, output a fullSnapshot proposal.
Generate ElementSnapshot or PatchOps as appropriate.
`;
            const response = await callChatWithSchema(
                ctx,
                SYSTEM_PROMPT,
                prompt,
                AgentSuggestionOutputSchema,
                { model: "gpt-4o", temperature: 0.2 }
            );

            if (!response) throw new Error("Generation failed");

            // Write to Revisions
            for (const suggestion of response.suggestions) {
                const actionType =
                    suggestion.mode === "critique"
                        ? "critique"
                        : suggestion.mode === "stress_test"
                            ? "stress_test"
                            : suggestion.mode === "risk_scan"
                                ? "risk_scan"
                                : suggestion.mode === "improve"
                                    ? "improve"
                                    : suggestion.mode === "dependencies"
                                        ? "dependency_calc"
                                        : "agent_suggestions";

                const revisionId = await ctx.runMutation(api.revisions.createDraft, {
                    projectId: args.projectId,
                    originTab: suggestion.tab,
                    actionType,
                    summary: suggestion.title,
                    createdBy: "agent",
                });

                if (suggestion.action === "update_element") {
                    if (!suggestion.targetElementId) {
                        throw new Error("update_element requires targetElementId");
                    }
                    const baseVersionId = suggestion.baseVersionId as Id<"elementVersions"> | undefined;
                    if (suggestion.proposal.type === "patchOps") {
                        await ctx.runMutation(api.revisions.patchElement, {
                            revisionId: revisionId.revisionId,
                            elementId: suggestion.targetElementId as Id<"projectItems">,
                            patchOps: suggestion.proposal.patchOps,
                            baseVersionId,
                        });
                    } else {
                        await ctx.runMutation(api.revisions.upsertChange, {
                            revisionId: revisionId.revisionId,
                            elementId: suggestion.targetElementId as Id<"projectItems">,
                            proposedSnapshot: suggestion.proposal.snapshot,
                            replaceMask: suggestion.replaceMask,
                            baseVersionId,
                        });
                    }
                } else if (suggestion.action === "create_element") {
                    const now = Date.now();
                    const typeKey = "studio_build";
                    const elementId = await ctx.db.insert("projectItems", {
                        projectId: args.projectId,
                        parentItemId: null,
                        sortKey: String(now),
                        title: suggestion.title,
                        typeKey,
                        name: suggestion.title,
                        category: typeKey,
                        kind: "deliverable",
                        description: suggestion.rationale,
                        searchText: buildSearchText({ name: suggestion.title, description: suggestion.rationale, typeKey }),
                        status: "draft",
                        elementStatus: "suggested",
                        createdFrom: { source: "agent", sourceId: suggestion.suggestionId },
                        latestRevisionNumber: 1,
                        createdAt: now,
                        updatedAt: now,
                    });

                    if (suggestion.proposal.type === "patchOps") {
                        await ctx.runMutation(api.revisions.patchElement, {
                            revisionId: revisionId.revisionId,
                            elementId,
                            patchOps: suggestion.proposal.patchOps,
                        });
                    } else {
                        await ctx.runMutation(api.revisions.upsertChange, {
                            revisionId: revisionId.revisionId,
                            elementId,
                            proposedSnapshot: suggestion.proposal.snapshot,
                            replaceMask: suggestion.replaceMask,
                        });
                    }
                }
            }
            return { success: true };
        }

        // --- LEGACY FLOW (ChangeSet) ---
        const templates = await ctx.runQuery(api.items.listTemplates);
        const prompt = `
Project: ${context.project.name}
Strategy: ${args.strategy}
User Instructions: ${args.userInstructions ?? "None"}

Available Templates:
${JSON.stringify(templates.map(t => ({ id: t.templateId, name: t.name, version: t.version, description: t.quotePattern })), null, 2)}

Items to Analyze:
${JSON.stringify(context.items, null, 2)}

Generate a ChangeSet that addresses the strategy.
- If "initial_breakdown": Create tasks and material lines for the items.
- If "material_fill": Focus on missing materials.
- If "sanity_check": Look for missing dependencies or unrealistic costs.
- Populate basedOnBulletIds with Project Brain bullet IDs you relied on.
- If you update existing elements, include basedOnApprovedSnapshotId (element version id when available).
- Populate conflictsReferenced if any conflicts were considered.

Start by checking the "Available Templates".
If you propose creating a NEW Item (Op: Create Item), prefer using 'templateId' if a matching template exists.
If you use 'templateId', the system will automatically create the standard tasks and materials for that template.
You can then ADD extra tasks or materials on top of the template if needed, but do not re-list the standard ones.

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
        if (args.phase) {
            response.phase = args.phase;
        }

        await ctx.runMutation(api.changeSets.create, { changeSet: response });

        return { success: true };
    },
});
