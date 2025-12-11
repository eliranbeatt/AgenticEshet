import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { EstimationSchema } from "../lib/zodSchemas";

// 1. DATA ACCESS
export const getContext = internalQuery({
  args: { 
    projectId: v.id("projects"),
    sectionId: v.id("sections") 
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    const section = await ctx.db.get(args.sectionId);
    if (!project || !section) throw new Error("Project or Section not found");

    // Retrieve some catalog items that might be relevant (naive search for now)
    // In a real app, we'd use vector search on the section name.
    const catalogItems = await ctx.db
        .query("materialCatalog")
        .withSearchIndex("search_material", q => q.search("name", section.name))
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
    estimation: v.any(), // EstimationSchema
  },
  handler: async (ctx, args) => {
    const data = args.estimation;

    // Insert Materials
    for (const m of data.materials) {
        await ctx.db.insert("materialLines", {
            projectId: args.projectId,
            sectionId: args.sectionId,
            category: m.category,
            label: m.label,
            description: m.description ?? undefined,
            vendorName: m.vendor ?? undefined,
            unit: m.unit,
            plannedQuantity: m.quantity,
            plannedUnitCost: m.unitCost,
            status: "planned"
        });
    }

    // Insert Work
    for (const w of data.work) {
        await ctx.db.insert("workLines", {
            projectId: args.projectId,
            sectionId: args.sectionId,
            workType: w.workType as any,
            role: w.role,
            rateType: w.rateType,
            plannedQuantity: w.quantity,
            plannedUnitCost: w.unitCost,
            status: "planned",
            description: w.description ?? undefined,
        });
    }
  },
});

// 2. AGENT ACTION
export const run = action({
  args: {
    projectId: v.id("projects"),
    sectionId: v.id("sections"),
  },
  handler: async (ctx, args) => {
    const { project, section, catalogItems, systemPrompt } = await ctx.runQuery(internal.agents.estimator.getContext, {
      projectId: args.projectId,
      sectionId: args.sectionId,
    });

    const catalogContext = catalogItems.length > 0 
        ? "Historical Prices from Catalog:\n" + catalogItems.map((c: any) => `- ${c.name}: ${c.lastPrice} per ${c.defaultUnit}`).join("\n")
        : "No specific catalog matches found.";

    const userPrompt = `
Project: ${project.name}
Currency: ${project.currency || "ILS"}
Section to Estimate: "${section.name}"
Group: ${section.group}
Description: ${section.description || "N/A"}

${catalogContext}

Please estimate the required materials and labor to execute this section.
- Be realistic with quantities and costs.
- Break down labor into specific roles (e.g. "Carpenter", "Installer").
- Use the project currency for all costs.
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

    return result;
  },
});
