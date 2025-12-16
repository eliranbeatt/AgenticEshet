import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { EstimationSchema } from "../lib/zodSchemas";

async function estimateSectionImpl(ctx: any, args: { projectId: any; sectionId: any }) {
    const { project, section, catalogItems, systemPrompt } = await ctx.runQuery(internal.agents.estimator.getContext, {
        projectId: args.projectId,
        sectionId: args.sectionId,
    });

    const catalogContext = catalogItems.length > 0
        ? "Historical Prices from Catalog:\n" + catalogItems.map((c: any) => `- ${c.name}: ${c.lastPrice} per ${c.defaultUnit}`).join("\n")
        : "No specific catalog matches found.";

    const userPrompt = `
Project: ${project.name}
Currency: ILS (New Israeli Shekel)
Section to Estimate: "${section.name}"
Group: ${section.group}
Description: ${section.description || "N/A"}

${catalogContext}

Please estimate the required materials and labor to execute this section.
- **LANGUAGE: HEBREW ONLY** for all labels, descriptions, and roles.
- **CURRENCY: ILS** (Shekels).
- **UNITS: Metric/Israeli** (m, sqm, kg, units).
- Be realistic with quantities and costs in the Israeli market.
- Break down labor into specific roles (e.g. "xÿx'x"", "xzx¦xxTxY", "xzxÿx"xo xx"xxTxx~").
`;

    const result = await callChatWithSchema(EstimationSchema, {
        systemPrompt,
        userPrompt,
    });

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

        return {
            project,
            section,
            catalogItems,
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

        for (const material of data.materials) {
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
                workType: work.workType as any,
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
    },
    handler: async (ctx, args) => {
        await estimateSectionImpl(ctx, args);
    },
});

export const estimateProjectInBackground: ReturnType<typeof internalAction> = internalAction({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const accounting = await ctx.runQuery(api.accounting.getProjectAccounting, { projectId: args.projectId });
        for (const sectionEntry of accounting.sections) {
            await estimateSectionImpl(ctx, { projectId: args.projectId, sectionId: sectionEntry.section._id });
        }
        return { count: accounting.sections.length };
    },
});

export const run: ReturnType<typeof action> = action({
    args: {
        projectId: v.id("projects"),
        sectionId: v.id("sections"),
    },
    handler: async (ctx, args) => {
        await ctx.scheduler.runAfter(0, internal.agents.estimator.runInBackground, {
            projectId: args.projectId,
            sectionId: args.sectionId,
        });
        return { queued: true };
    },
});

export const estimateProject: ReturnType<typeof action> = action({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        await ctx.scheduler.runAfter(0, internal.agents.estimator.estimateProjectInBackground, {
            projectId: args.projectId,
        });
        return { queued: true };
    },
});
