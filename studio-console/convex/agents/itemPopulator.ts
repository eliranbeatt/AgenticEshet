import { v } from "convex/values";
import { action } from "../_generated/server";
import { z } from "zod";
import { api, internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { ItemSpecV2Schema, ItemUpdateOutputSchema, ItemSpecV2 } from "../lib/zodSchemas";
import { parseItemSpec, buildBaseItemSpec, normalizeRateType } from "../lib/itemHelpers";
import { summarizeElementSnapshots } from "../lib/contextSummary";
import { buildBrainContext } from "../lib/brainContext";

const SYSTEM_PROMPT = `
You are an expert Production Manager for events and construction.
Your goal is to populate the technical specifications of a "Project Item" (Element) based on a list of known facts.
You will be given the current state of the item (if any) and a list of facts relative to the project or specifically to this item.

Instructions:
1. Analyze the facts provided. Look for details about dimensions, materials, logistics, installation, safety, and budget.
2. Update the Item Spec to reflect these facts.
3. If the item is new or empty, inferred reasonable defaults based on the item title and category.
4. Do NOT remove existing data unless it strictly contradicts the new facts. Is strictly contradicts, prefer the facts.
5. In the "changeReason" field, explain briefly what you updated and why. (e.g. "Updated dimensions and materials based on client meeting notes").
6. The output must be valid JSON matching the schema. PREFER returning the data wrapped in a "proposedData" field, but if you return the spec directly, ensure you include "changeReason".
7. Use Hebrew for all user-facing text (descriptions, notes, reasons). Keys/IDs must remain as is.
8. For "breakdown.materials" each entry MUST include "id" and "label". For "breakdown.labor" each entry MUST include "id", "workType", "role", and "rateType" ("hour" | "day" | "flat").
`;

const PopulatorEnvelopeSchema = z.object({
    proposedData: z.unknown(),
    summaryMarkdown: z.string().optional(),
    changeReason: z.string().optional(),
});

// Allow the LLM to return the spec directly, but capture the extra fields if it adds them
const FlattenedResponseSchema = z
    .object({
        summaryMarkdown: z.string().optional(),
        changeReason: z.string().optional(),
    })
    .passthrough();

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length ? value : undefined;
}

function normalizeMaterials(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry, index) => {
            if (typeof entry === "string") {
                return {
                    id: `material-${index + 1}`,
                    label: entry,
                };
            }
            if (!isRecord(entry)) return null;

            const label =
                asString(entry.label) ||
                asString(entry.name) ||
                asString(entry.title) ||
                asString(entry.material) ||
                `חומר ${index + 1}`;

            return {
                id: asString(entry.id) ?? `material-${index + 1}`,
                category: asString(entry.category),
                label,
                description: asString(entry.description) ?? asString(entry.notes),
                qty: typeof entry.qty === "number" ? entry.qty : typeof entry.quantity === "number" ? entry.quantity : undefined,
                unit: asString(entry.unit),
                unitCostEstimate:
                    typeof entry.unitCostEstimate === "number"
                        ? entry.unitCostEstimate
                        : typeof entry.unitCost === "number"
                            ? entry.unitCost
                            : undefined,
                vendorName: asString(entry.vendorName) ?? asString(entry.vendor),
                procurement: asString(entry.procurement) as "in_stock" | "local" | "abroad" | "either" | undefined,
                status: asString(entry.status),
                note: asString(entry.note),
            };
        })
        .filter(Boolean);
}

function normalizeLabor(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry, index) => {
            if (typeof entry === "string") {
                return {
                    id: `labor-${index + 1}`,
                    workType: "general",
                    role: entry,
                    rateType: "hour",
                };
            }
            if (!isRecord(entry)) return null;

            const role =
                asString(entry.role) ||
                asString(entry.title) ||
                asString(entry.name) ||
                asString(entry.work) ||
                "עבודה כללית";

            const rateTypeInput = asString(entry.rateType) || asString(entry.rate) || "hour";

            return {
                id: asString(entry.id) ?? `labor-${index + 1}`,
                workType: asString(entry.workType) ?? "general",
                role,
                rateType: normalizeRateType(rateTypeInput),
                quantity:
                    typeof entry.quantity === "number"
                        ? entry.quantity
                        : typeof entry.qty === "number"
                            ? entry.qty
                            : undefined,
                unitCost:
                    typeof entry.unitCost === "number"
                        ? entry.unitCost
                        : typeof entry.unitCostEstimate === "number"
                            ? entry.unitCostEstimate
                            : undefined,
                description: asString(entry.description) ?? asString(entry.notes),
            };
        })
        .filter(Boolean);
}

function normalizeSubtasks(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry, index) => {
            if (!isRecord(entry)) return null;
            const title = asString(entry.title) || asString(entry.name);
            if (!title) return null;
            return {
                ...entry,
                id: asString(entry.id) ?? `subtask-${index + 1}`,
                title,
            };
        })
        .filter(Boolean);
}

function normalizeItemSpec(input: unknown, baseSpec: ItemSpecV2) {
    const parsed = ItemSpecV2Schema.safeParse(input);
    if (parsed.success) return parsed.data;

    const raw = isRecord(input) ? input : {};
    const identity = isRecord(raw.identity)
        ? { ...baseSpec.identity, ...raw.identity }
        : baseSpec.identity;
    const breakdownRaw = isRecord(raw.breakdown) ? raw.breakdown : {};
    const breakdown = {
        subtasks: normalizeSubtasks(breakdownRaw.subtasks ?? baseSpec.breakdown.subtasks),
        materials: normalizeMaterials(breakdownRaw.materials ?? baseSpec.breakdown.materials),
        labor: normalizeLabor(breakdownRaw.labor ?? baseSpec.breakdown.labor),
    };
    const state = isRecord(raw.state)
        ? { ...baseSpec.state, ...raw.state }
        : baseSpec.state;

    const candidate = {
        ...baseSpec,
        ...raw,
        version: "ItemSpecV2",
        identity,
        breakdown,
        state,
    };

    return ItemSpecV2Schema.parse(candidate);
}

export const populate = action({
    args: {
        itemId: v.id("projectItems"),
        revisionId: v.optional(v.id("itemRevisions")),
    },
    handler: async (ctx, args) => {
        const itemData = await ctx.runQuery(internal.items.getItem, { itemId: args.itemId });
        if (!itemData || !itemData.item) throw new Error("Item not found");

        const { item, revisions } = itemData;

        // Determine base spec
        let baseSpec: ItemSpecV2;
        if (args.revisionId) {
            const rev = revisions.find((r) => r._id === args.revisionId);
            if (!rev) throw new Error("Revision not found");
            baseSpec = parseItemSpec(rev.data);
        } else if (item.approvedRevisionId) {
            const rev = revisions.find((r) => r._id === item.approvedRevisionId);
            baseSpec = rev ? parseItemSpec(rev.data) : buildBaseItemSpec(item.title, item.typeKey);
        } else {
            // Find latest draft or create empty
            const latestDraft = revisions
                .filter((r) => r.state === "proposed")
                .sort((a, b) => b.revisionNumber - a.revisionNumber)[0];
            baseSpec = latestDraft ? parseItemSpec(latestDraft.data) : buildBaseItemSpec(item.title, item.typeKey);
        }

        const project = await ctx.db.get(item.projectId);
        if (!project) throw new Error("Project not found");

        // Fetch facts
        // We want all facts for this project to be safe, but especially those linked to this item
        const allFacts = project.features?.factsEnabled === false
            ? []
            : await ctx.runQuery(internal.factsV2.listFacts, { projectId: item.projectId });

        const brain = await ctx.runQuery(api.projectBrain.getCurrent, {
            projectId: item.projectId,
        });

        const elementSnapshots = project.features?.elementsCanonical
            ? await ctx.runQuery(internal.elementVersions.getActiveSnapshotsByItemIds, {
                itemIds: [args.itemId],
            })
            : [];
        const elementSnapshotsSummary = project.features?.elementsCanonical
            ? summarizeElementSnapshots(elementSnapshots, 4)
            : "(none)";

        // Filter facts
        // We want:
        // 1. Facts scoped to this item
        // 2. Facts scoped to project (general context)
        // 3. We exclude deprecated/rejected facts (listFacts might return them, let's allow the query to handle it if possible, but listFacts returns all.
        //    Actually listFacts returns sorted facts. We should filter by status "accepted" or "proposed" (high confidence)

        const relevantFacts = allFacts.filter(f => {
            const isHighConfidence = (f.status === "accepted" || (f.status === "proposed" && f.confidence > 0.8));
            if (!isHighConfidence) return false;

            if (f.scopeType === "project") return true;
            if (f.itemId === args.itemId) return true;

            // Include unlinked item facts that might match
            if (f.scopeType === "item" && !f.itemId) {
                // Simple token match
                const factTokens = f.factTextHe.toLowerCase().split(/\s+/);
                const titleTokens = item.title.toLowerCase().split(/\s+/);
                return titleTokens.some(t => t.length > 2 && factTokens.includes(t));
            }
            return false;
        });

        if (relevantFacts.length === 0) {
            // No facts, maybe just infer from title?
            // For now, let's proceed even with no facts, maybe the model can fill defaults.
        }

        const factsText = relevantFacts.map(f =>
            `- [${f.scopeType === "item" ? "Item" : "Project"}] ${f.factTextHe} (${f.key || "general"})`
        ).join("\n");

        const userPrompt = `
Current Item Identity:
Title: ${item.title}
Type: ${item.typeKey}
Description: ${item.description || "(none)"}

Current Spec JSON:
${JSON.stringify(baseSpec, null, 2)}

Element Snapshot (canonical, overrides knowledge/chat):
${elementSnapshotsSummary}

Project Brain (authoritative, overrides chat):
${brain ? buildBrainContext(brain) : "(none)"}

Available Facts:
${factsText || "(No facts available)"}

Please generate the updated ItemSpecV2.
`;


        // Fetch model config
        const settings = await ctx.runQuery(internal.settings.getAll);
        const model = settings.modelConfig?.items || "gpt-4o";

        const ResponseSchema = PopulatorEnvelopeSchema;
        const response = await callChatWithSchema(ResponseSchema, {
            systemPrompt: SYSTEM_PROMPT + "\nIMPORTANT: You MUST return the JSON wrapped in { proposedData: ..., changeReason: ... }.",
            userPrompt,
            model,
            temperature: 0.1,
        });

        let proposedData: ItemSpecV2;
        let summaryMarkdown: string;
        let changeReason: string;

        proposedData = normalizeItemSpec(response.proposedData, baseSpec);
        summaryMarkdown = response.summaryMarkdown || "עודכן על בסיס העובדות שסופקו.";
        changeReason = response.changeReason || "עודכן על בסיס העובדות שסופקו.";

        // Apply update
        // We can either return the data or apply it directly.
        // Let's apply it directly via mutation to ensure atomicity from the user's perspective (one click -> done)

        // We need to know which tabScope to use. 
        // If we are editing a specific revision, we use its tabScope.
        // If not, we default to 'planning' or 'ideation' depending on phase?
        // Let's assume 'planning' if undefined, or derive from current revision.

        let targetTabScope = "planning";
        if (args.revisionId) {
            const rev = revisions.find((r) => r._id === args.revisionId);
            if (rev) targetTabScope = rev.tabScope;
        }

        await ctx.runMutation(internal.items.upsertRevision, {
            itemId: args.itemId,
            // @ts-ignore
            tabScope: targetTabScope,
            dataOrPatch: proposedData,
            changeReason: changeReason,
            createdByKind: "agent",
            agentRunId: undefined // We don't have a run ID here, that's fine
        });

        return { ok: true, summary: summaryMarkdown };
    }
});
