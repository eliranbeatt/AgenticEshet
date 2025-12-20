import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { EstimationSchema, ItemSpecV2Schema, type ItemSpecV2 } from "../lib/zodSchemas";
import type { Doc, Id } from "../_generated/dataModel";

type MutationRunner = (ref: unknown, args: unknown) => Promise<unknown>;
type QueryRunner = (ref: unknown, args: unknown) => Promise<unknown>;

type EstimatorCtx = {
    runQuery: QueryRunner;
    runMutation: MutationRunner;
};

type EstimatorContext = {
    project: { name: string };
    section: { name: string; group: string; description?: string | null };
    item?: Doc<"projectItems"> | null;
    spec?: ItemSpecV2 | null;
    catalogItems: Array<{ name: string; lastPrice: number; defaultUnit: string }>;
    systemPrompt: string;
};

async function estimateSectionImpl(
    ctx: EstimatorCtx,
    args: {
        projectId: unknown;
        sectionId?: unknown;
        itemId?: unknown;
        agentRunId?: unknown;
        label?: string;
        thinkingMode?: boolean;
    }
) {
    const agentRunId = args.agentRunId;
    const label = args.label ?? "Estimating section";

    if (agentRunId) {
        await ctx.runMutation(internal.agentRuns.appendEvent, {
            runId: agentRunId,
            level: "info",
            message: `${label}: loading context.`,
            stage: "loading_context",
        });
    }

    const { project, section, catalogItems, systemPrompt, solutionedItems, item, spec } = await ctx.runQuery(internal.agents.estimator.getContext, {
        projectId: args.projectId,
        sectionId: args.sectionId,
        itemId: args.itemId,
    }) as EstimatorContext & { solutionedItems: { label: string; solutionPlan: string }[] };

    const catalogContext = catalogItems.length > 0
        ? "Historical Prices from Catalog:\n" + catalogItems.map((c) => `- ${c.name}: ${c.lastPrice} per ${c.defaultUnit}`).join("\n")
        : "No specific catalog matches found.";

    const solutionContext = solutionedItems && solutionedItems.length > 0
        ? "\n\nLOCKED SOLUTIONS (Must adhere to these plans):\n" + solutionedItems.map(i => `Item: ${i.label}\nPlan: ${i.solutionPlan}`).join("\n---\n")
        : "";

    const userPrompt = `
Project: ${project.name}
Currency: ILS (New Israeli Shekel)
Section to Estimate: "${section.name}"
Group: ${section.group}
Description: ${section.description || "N/A"}

${catalogContext}
${solutionContext}

Please estimate the required materials and labor to execute this section.
- **LANGUAGE: HEBREW ONLY** for all labels, descriptions, and roles.
- **CURRENCY: ILS** (Shekels).
- **UNITS: Metric/Israeli** (m, sqm, kg, units).
- Be realistic with quantities and costs in the Israeli market.
- Break down labor into specific roles.
- IMPORTANT: If an item is listed in "LOCKED SOLUTIONS", you MUST use the suggested materials and methods in that plan. Do not invent new ways for those items.
`;

    const result = await callChatWithSchema(EstimationSchema, {
        systemPrompt,
        userPrompt,
        thinkingMode: args.thinkingMode,
    });

    if (agentRunId) {
        await ctx.runMutation(internal.agentRuns.appendEvent, {
            runId: agentRunId,
            level: "info",
            message: `${label}: saving materials and labor lines.`,
            stage: "persisting",
        });
    }

    if (item && spec) {
        const nextSpec = ItemSpecV2Schema.parse({
            ...spec,
            breakdown: {
                ...spec.breakdown,
                materials: result.materials.map((material, index) => ({
                    id: `mat:${material.label}:${index + 1}`,
                    category: material.category,
                    label: material.label,
                    description: material.description ?? undefined,
                    qty: material.quantity,
                    unit: material.unit,
                    unitCostEstimate: material.unitCost,
                    vendorName: material.vendor ?? undefined,
                    procurement: "either",
                    status: "planned",
                })),
                labor: result.work.map((workLine, index) => ({
                    id: `labor:${workLine.role}:${index + 1}`,
                    workType: workLine.workType,
                    role: workLine.role,
                    rateType: workLine.rateType === "flat" ? "flat" : workLine.rateType === "day" ? "day" : "hour",
                    quantity: workLine.quantity,
                    unitCost: workLine.unitCost,
                    description: workLine.description ?? undefined,
                })),
            },
        });

        const { revisionId } = await ctx.runMutation(api.items.upsertRevision, {
            itemId: item._id,
            tabScope: "accounting",
            dataOrPatch: nextSpec,
            changeReason: "Estimator update",
            createdByKind: "agent",
        }) as { revisionId: Id<"itemRevisions"> };

        await ctx.runMutation(api.items.approveRevision, {
            itemId: item._id,
            revisionId,
        });
    } else {
        await ctx.runMutation(internal.agents.estimator.saveEstimation, {
            projectId: args.projectId,
            sectionId: args.sectionId,
            estimation: result,
        });
    }
}

export const getContext = internalQuery({
    args: {
        projectId: v.id("projects"),
        sectionId: v.optional(v.id("sections")),
        itemId: v.optional(v.id("projectItems")),
    },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");
        if (!args.sectionId && !args.itemId) {
            throw new Error("Either sectionId or itemId is required");
        }

        const section = args.sectionId ? await ctx.db.get(args.sectionId) : null;
        const item = args.itemId ? await ctx.db.get(args.itemId) : null;
        if (!section && !item) throw new Error("Section or Item not found");

        let spec: ItemSpecV2 | null = null;
        if (item) {
            const revisions = await ctx.db
                .query("itemRevisions")
                .withIndex("by_item_revision", (q) => q.eq("itemId", item._id))
                .collect();
            const approved = item.approvedRevisionId
                ? revisions.find((rev) => rev._id === item.approvedRevisionId) ?? null
                : null;
            if (approved) {
                const parsed = ItemSpecV2Schema.safeParse(approved.data);
                spec = parsed.success ? parsed.data : null;
            }
            if (!spec) {
                spec = ItemSpecV2Schema.parse({
                    version: "ItemSpecV2",
                    identity: { title: item.title, typeKey: item.typeKey },
                });
            }
        }

        let resolvedSection = section;
        if (!resolvedSection && item) {
            const sections = await ctx.db
                .query("sections")
                .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
                .collect();
            resolvedSection = sections.find((s) => s.itemId === item._id) ?? null;
        }

        const sectionSnapshot = resolvedSection
            ? {
                name: resolvedSection.name,
                group: resolvedSection.group,
                description: resolvedSection.description ?? null,
            }
            : {
                name: spec?.identity.title ?? item?.title ?? "Item",
                group: spec?.identity.accountingGroup ?? item?.typeKey ?? "General",
                description: spec?.identity.description ?? null,
            };

        const catalogItems = await ctx.db
            .query("materialCatalog")
            .withSearchIndex("search_material", (q) => q.search("name", sectionSnapshot.name))
            .take(5);

        const solutionedItems: { label: string; solutionPlan: string }[] = [];
        if (resolvedSection) {
            const materialLines = await ctx.db
                .query("materialLines")
                .withIndex("by_section", (q) => q.eq("sectionId", resolvedSection._id))
                .collect();
            materialLines
                .filter((line) => line.solutioned && line.solutionPlan)
                .forEach((line) => {
                    solutionedItems.push({ label: line.label, solutionPlan: line.solutionPlan ?? "" });
                });
        }

        if (spec?.studioWork?.buildPlanMarkdown) {
            solutionedItems.push({ label: spec.identity.title, solutionPlan: spec.studioWork.buildPlanMarkdown });
        }

        return {
            project,
            section: sectionSnapshot,
            item,
            spec,
            catalogItems,
            solutionedItems,
            systemPrompt: "You are an expert Production Estimator for an events and creative studio. Your goal is to break down a high-level element (Section) into detailed Bill of Materials and Labor tasks.",
        };
    },
});

export const saveEstimation = internalMutation({
    args: {
        projectId: v.id("projects"),
        sectionId: v.id("sections"),
        estimation: v.any(),
    },
    handler: async (ctx, args) => {
        const data = args.estimation;

        const existingMaterials = await ctx.db
            .query("materialLines")
            .withIndex("by_section", (q) => q.eq("sectionId", args.sectionId))
            .collect();

        const lockedLabels = new Set(
            existingMaterials
                .filter((line) => line.solutioned && line.solutionPlan)
                .map((line) => (line.label ?? "").trim().toLowerCase())
                .filter(Boolean)
        );

        for (const line of existingMaterials) {
            if (line.solutioned && line.solutionPlan) continue;
            await ctx.db.delete(line._id);
        }

        const existingWork = await ctx.db
            .query("workLines")
            .withIndex("by_section", (q) => q.eq("sectionId", args.sectionId))
            .collect();

        for (const line of existingWork) {
            await ctx.db.delete(line._id);
        }

        for (const material of data.materials) {
            const normalizedLabel = (material.label ?? "").trim().toLowerCase();
            if (normalizedLabel && lockedLabels.has(normalizedLabel)) continue;

            await ctx.db.insert("materialLines", {
                projectId: args.projectId,
                sectionId: args.sectionId,
                category: material.category,
                label: material.label,
                description: material.description ?? undefined,
                vendorName: material.vendor ?? undefined,
                unit: material.unit,
                plannedQuantity: material.quantity,
                plannedUnitCost: material.unitCost,
                status: "planned",
            });
        }

        for (const work of data.work) {
            await ctx.db.insert("workLines", {
                projectId: args.projectId,
                sectionId: args.sectionId,
                workType: work.workType,
                role: work.role,
                rateType: work.rateType,
                plannedQuantity: work.quantity,
                plannedUnitCost: work.unitCost,
                status: "planned",
                description: work.description ?? undefined,
            });
        }
    },
});

export const runInBackground: ReturnType<typeof internalAction> = internalAction({
    args: {
        projectId: v.id("projects"),
        sectionId: v.optional(v.id("sections")),
        itemId: v.optional(v.id("projectItems")),
        agentRunId: v.optional(v.id("agentRuns")),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const agentRunId = args.agentRunId;
        if (agentRunId) {
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId: agentRunId,
                status: "running",
                stage: "llm_call",
            });
        }

        try {
            await estimateSectionImpl(ctx, { ...args, agentRunId, label: "Estimating section" });
            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.setStatus, {
                    runId: agentRunId,
                    status: "succeeded",
                    stage: "done",
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: agentRunId,
                    level: "error",
                    message,
                    stage: "failed",
                });
                await ctx.runMutation(internal.agentRuns.setStatus, {
                    runId: agentRunId,
                    status: "failed",
                    stage: "failed",
                    error: message,
                });
            }
            throw error;
        }
    },
});

export const estimateProjectInBackground: ReturnType<typeof internalAction> = internalAction({
    args: { projectId: v.id("projects"), agentRunId: v.optional(v.id("agentRuns")), thinkingMode: v.optional(v.boolean()) },
    handler: async (ctx, args) => {
        const agentRunId = args.agentRunId;
        if (agentRunId) {
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId: agentRunId,
                status: "running",
                stage: "loading_context",
            });
            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId: agentRunId,
                level: "info",
                message: "Loading all accounting sections for bulk estimation.",
                stage: "loading_context",
            });
        }

        try {
            const accounting = await ctx.runQuery(api.accounting.getProjectAccounting, { projectId: args.projectId });
            const sections = (() => {
                if (!accounting || typeof accounting !== "object") return [];
                const raw = (accounting as { sections?: unknown }).sections;
                if (!Array.isArray(raw)) return [];
                return raw as Array<{ section: { _id: unknown; name: string } }>;
            })();

            const total = sections.length;
            let index = 0;
            for (const sectionEntry of sections) {
                index += 1;
                const label = `Estimating section ${index}/${total} (${sectionEntry.section.name})`;
                await estimateSectionImpl(ctx, { projectId: args.projectId, sectionId: sectionEntry.section._id, agentRunId, label, thinkingMode: args.thinkingMode });
            }

            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.setStatus, {
                    runId: agentRunId,
                    status: "succeeded",
                    stage: "done",
                });
            }

            return { count: total };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: agentRunId,
                    level: "error",
                    message,
                    stage: "failed",
                });
                await ctx.runMutation(internal.agentRuns.setStatus, {
                    runId: agentRunId,
                    status: "failed",
                    stage: "failed",
                    error: message,
                });
            }
            throw error;
        }
    },
});

export const run: ReturnType<typeof action> = action({
    args: {
        projectId: v.id("projects"),
        sectionId: v.optional(v.id("sections")),
        itemId: v.optional(v.id("projectItems")),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        await ctx.runQuery(internal.agents.estimator.getContext, {
            projectId: args.projectId,
            sectionId: args.sectionId,
            itemId: args.itemId,
        });

        const agentRunId = await ctx.runMutation(internal.agentRuns.createRun, {
            projectId: args.projectId,
            agent: "estimator",
            stage: "queued",
            initialMessage: "Queued section estimation.",
        });

        await ctx.scheduler.runAfter(0, internal.agents.estimator.runInBackground, {
            projectId: args.projectId,
            sectionId: args.sectionId,
            itemId: args.itemId,
            agentRunId,
            thinkingMode: args.thinkingMode,
        });
        return { queued: true, runId: agentRunId };
    },
});

export const estimateProject: ReturnType<typeof action> = action({
    args: { projectId: v.id("projects"), thinkingMode: v.optional(v.boolean()) },
    handler: async (ctx, args) => {
        const agentRunId = await ctx.runMutation(internal.agentRuns.createRun, {
            projectId: args.projectId,
            agent: "estimator",
            stage: "queued",
            initialMessage: "Queued bulk project estimation.",
        });

        await ctx.scheduler.runAfter(0, internal.agents.estimator.estimateProjectInBackground, {
            projectId: args.projectId,
            agentRunId,
            thinkingMode: args.thinkingMode,
        });
        return { queued: true, runId: agentRunId };
    },
});
