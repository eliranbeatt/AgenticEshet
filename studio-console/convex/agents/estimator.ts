import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { EstimationSchema } from "../lib/zodSchemas";

type MutationRunner = (ref: unknown, args: unknown) => Promise<unknown>;
type QueryRunner = (ref: unknown, args: unknown) => Promise<unknown>;

type EstimatorCtx = {
    runQuery: QueryRunner;
    runMutation: MutationRunner;
};

type EstimatorContext = {
    project: { name: string };
    section: { name: string; group: string; description?: string | null };
    catalogItems: Array<{ name: string; lastPrice: number; defaultUnit: string }>;
    systemPrompt: string;
};

async function estimateSectionImpl(
    ctx: EstimatorCtx,
    args: { projectId: unknown; sectionId: unknown; agentRunId?: unknown; label?: string; thinkingMode?: boolean }
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

    const { project, section, catalogItems, systemPrompt, solutionedItems } = await ctx.runQuery(internal.agents.estimator.getContext, {
        projectId: args.projectId,
        sectionId: args.sectionId,
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

    await ctx.runMutation(internal.agents.estimator.saveEstimation, {
        projectId: args.projectId,
        sectionId: args.sectionId,
        estimation: result,
    });
}

export const getContext = internalQuery({
    args: {
        projectId: v.id("projects"),
        sectionId: v.id("sections"),
    },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        const section = await ctx.db.get(args.sectionId);
        if (!project || !section) throw new Error("Project or Section not found");

        const catalogItems = await ctx.db
            .query("materialCatalog")
            .withSearchIndex("search_material", (q) => q.search("name", section.name))
            .take(5);

        // Fetch existing solutioned items to enforce their plan
        const materialLines = await ctx.db
            .query("materialLines")
            .withIndex("by_section", (q) => q.eq("sectionId", args.sectionId))
            .collect();

        const solutionedItems = materialLines.filter(m => m.solutioned && m.solutionPlan);

        return {
            project,
            section,
            catalogItems,
            solutionedItems: solutionedItems.map(item => ({
                label: item.label,
                solutionPlan: item.solutionPlan
            })),
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
        sectionId: v.id("sections"),
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
        sectionId: v.id("sections"),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        await ctx.runQuery(internal.agents.estimator.getContext, { projectId: args.projectId, sectionId: args.sectionId });

        const agentRunId = await ctx.runMutation(internal.agentRuns.createRun, {
            projectId: args.projectId,
            agent: "estimator",
            stage: "queued",
            initialMessage: "Queued section estimation.",
        });

        await ctx.scheduler.runAfter(0, internal.agents.estimator.runInBackground, {
            projectId: args.projectId,
            sectionId: args.sectionId,
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
