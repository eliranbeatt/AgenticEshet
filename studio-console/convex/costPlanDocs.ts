import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { calculateSectionSnapshot, getProjectPricingDefaults } from "./lib/costing";

function formatPercent(value: number) {
    return `${Math.round(value * 1000) / 10}%`;
}

function formatMoney(amount: number, currency: string) {
    const formatted = amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
    return `${formatted} ${currency}`;
}

function buildCostPlanMarkdown(args: {
    project: Doc<"projects">;
    clarificationMarkdown: string | null;
    sections: Doc<"sections">[];
    materialsBySection: Map<string, Doc<"materialLines">[]>;
    workBySection: Map<string, Doc<"workLines">[]>;
}) {
    const defaults = getProjectPricingDefaults(args.project);

    const sectionSnapshots = args.sections
        .slice()
        .sort((a, b) => (a.group !== b.group ? a.group.localeCompare(b.group) : a.sortOrder - b.sortOrder))
        .map((section) => {
            const materials = args.materialsBySection.get(section._id) ?? [];
            const work = args.workBySection.get(section._id) ?? [];
            const stats = calculateSectionSnapshot(section, materials, work, defaults);
            return { section, materials, work, stats };
        });

    const totals = sectionSnapshots.reduce(
        (acc, curr) => ({
            plannedMaterials: acc.plannedMaterials + curr.stats.plannedMaterialsCostE,
            plannedWork: acc.plannedWork + curr.stats.plannedWorkCostS,
            plannedDirect: acc.plannedDirect + curr.stats.plannedDirectCost,
            plannedClient: acc.plannedClient + curr.stats.plannedClientPrice,
        }),
        { plannedMaterials: 0, plannedWork: 0, plannedDirect: 0, plannedClient: 0 },
    );

    const lines: string[] = [];
    lines.push(`# Project Plan (Cost-Based)`);
    lines.push(``);
    lines.push(`## Project`);
    lines.push(`- Project: ${args.project.name}`);
    lines.push(`- Customer: ${args.project.clientName}`);
    lines.push(`- Currency: ${defaults.currency}`);
    if (args.project.details.eventDate) lines.push(`- Event date: ${args.project.details.eventDate}`);
    if (args.project.details.location) lines.push(`- Location: ${args.project.details.location}`);
    if (args.project.details.budgetCap !== undefined)
        lines.push(`- Budget cap: ${formatMoney(args.project.details.budgetCap, defaults.currency)}`);
    if (args.project.details.notes) lines.push(`- Notes: ${args.project.details.notes}`);

    lines.push(``);
    lines.push(`## Pricing Policy (Cost + Margins)`);
    lines.push(`- Risk: ${formatPercent(defaults.risk)}`);
    lines.push(`- Overhead: ${formatPercent(defaults.overhead)}`);
    lines.push(`- Profit: ${formatPercent(defaults.profit)}`);

    lines.push(``);
    lines.push(`## Clarifications`);
    if (args.clarificationMarkdown?.trim()) {
        lines.push(args.clarificationMarkdown.trim());
    } else {
        lines.push(`(No clarification document yet.)`);
    }

    lines.push(``);
    lines.push(`## Cost Summary`);
    lines.push(`- Materials (E): ${formatMoney(totals.plannedMaterials, defaults.currency)}`);
    lines.push(`- Labor (S): ${formatMoney(totals.plannedWork, defaults.currency)}`);
    lines.push(`- Direct cost: ${formatMoney(totals.plannedDirect, defaults.currency)}`);
    lines.push(`- Client price (after margins): ${formatMoney(totals.plannedClient, defaults.currency)}`);

    lines.push(``);
    lines.push(`## Line Items (Accounting Breakdown)`);

    let currentGroup: string | null = null;
    for (const entry of sectionSnapshots) {
        if (entry.section.group !== currentGroup) {
            currentGroup = entry.section.group;
            lines.push(``);
            lines.push(`### ${currentGroup}`);
        }

        lines.push(``);
        lines.push(`#### ${entry.section.name}`);
        if (entry.section.description) lines.push(entry.section.description);

        lines.push(``);
        lines.push(`**Totals**`);
        lines.push(`- Materials (E): ${formatMoney(entry.stats.plannedMaterialsCostE, defaults.currency)}`);
        lines.push(`- Labor (S): ${formatMoney(entry.stats.plannedWorkCostS, defaults.currency)}`);
        lines.push(`- Direct cost: ${formatMoney(entry.stats.plannedDirectCost, defaults.currency)}`);
        lines.push(`- Client price: ${formatMoney(entry.stats.plannedClientPrice, defaults.currency)}`);

        if (entry.materials.length > 0) {
            lines.push(``);
            lines.push(`**Materials**`);
            for (const material of entry.materials) {
                const lineTotal = material.plannedQuantity * material.plannedUnitCost;
                lines.push(
                    `- ${material.label}: ${material.plannedQuantity} ${material.unit} × ${formatMoney(
                        material.plannedUnitCost,
                        defaults.currency,
                    )} = ${formatMoney(lineTotal, defaults.currency)}`,
                );
            }
        }

        if (entry.work.length > 0) {
            lines.push(``);
            lines.push(`**Labor**`);
            for (const workLine of entry.work) {
                const quantityLabel = workLine.rateType === "flat" ? "flat" : `${workLine.plannedQuantity} ${workLine.rateType}`;
                const lineTotal =
                    workLine.rateType === "flat"
                        ? workLine.plannedUnitCost
                        : workLine.plannedQuantity * workLine.plannedUnitCost;
                lines.push(
                    `- ${workLine.role}: ${quantityLabel} × ${formatMoney(
                        workLine.plannedUnitCost,
                        defaults.currency,
                    )} = ${formatMoney(lineTotal, defaults.currency)}`,
                );
            }
        }
    }

    lines.push(``);
    lines.push(`---`);
    lines.push(`Generated from Accounting (sections, materials, labor). Edit the numbers in Accounting; re-generate a draft if needed.`);

    return lines.join("\n");
}

export const createDraftFromAccounting = mutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");

        const clarification = await ctx.db
            .query("plans")
            .withIndex("by_project_phase", (q) =>
                q.eq("projectId", args.projectId).eq("phase", "clarification"),
            )
            .order("desc")
            .first();

        const sections = await ctx.db
            .query("sections")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const allMaterials = await ctx.db
            .query("materialLines")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const allWork = await ctx.db
            .query("workLines")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const materialsBySection = new Map<string, Doc<"materialLines">[]>();
        for (const material of allMaterials) {
            if (!materialsBySection.has(material.sectionId)) materialsBySection.set(material.sectionId, []);
            materialsBySection.get(material.sectionId)!.push(material);
        }

        const workBySection = new Map<string, Doc<"workLines">[]>();
        for (const workLine of allWork) {
            if (!workBySection.has(workLine.sectionId)) workBySection.set(workLine.sectionId, []);
            workBySection.get(workLine.sectionId)!.push(workLine);
        }

        const contentMarkdown = buildCostPlanMarkdown({
            project,
            clarificationMarkdown: clarification?.contentMarkdown ?? null,
            sections,
            materialsBySection,
            workBySection,
        });

        const existingPlans = await ctx.db
            .query("plans")
            .withIndex("by_project_phase", (q) => q.eq("projectId", args.projectId).eq("phase", "planning"))
            .collect();

        const version = existingPlans.length + 1;

        return await ctx.db.insert("plans", {
            projectId: args.projectId,
            version,
            phase: "planning",
            isDraft: true,
            isActive: false,
            contentMarkdown,
            createdAt: Date.now(),
            createdBy: "user",
        });
    },
});

export const updateDraftMarkdown = mutation({
    args: {
        planId: v.id("plans"),
        contentMarkdown: v.string(),
    },
    handler: async (ctx, args) => {
        const plan = await ctx.db.get(args.planId);
        if (!plan) throw new Error("Plan not found");
        if (plan.phase !== "planning") throw new Error("Only planning documents can be updated here");
        if (!plan.isDraft) throw new Error("Only draft plans can be edited");

        await ctx.db.patch(args.planId, {
            contentMarkdown: args.contentMarkdown,
        });
    },
});

