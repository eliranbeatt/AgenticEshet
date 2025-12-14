import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { calculateSectionSnapshot, getProjectPricingDefaults } from "./lib/costing";

type QuoteBreakdownItem = {
    label: string;
    amount: number;
    currency: string;
    notes?: string | null;
};

function formatMoney(amount: number, currency: string) {
    const formatted = amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
    return `${formatted} ${currency}`;
}

function buildClientDocument(args: {
    project: Doc<"projects">;
    currency: string;
    breakdown: QuoteBreakdownItem[];
    totalAmount: number;
}) {
    const lines: string[] = [];
    lines.push(`Quote for ${args.project.clientName}`);
    lines.push(`Project: ${args.project.name}`);
    lines.push(`Currency: ${args.currency}`);
    lines.push(``);
    lines.push(`Line items:`);
    for (const item of args.breakdown) {
        lines.push(`- ${item.label}: ${formatMoney(item.amount, args.currency)}`);
    }
    lines.push(``);
    lines.push(`Total: ${formatMoney(args.totalAmount, args.currency)}`);
    return lines.join("\n");
}

export const generateFromAccounting = mutation({
    args: {
        projectId: v.id("projects"),
    },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");

        const activePlan = await ctx.db
            .query("plans")
            .withIndex("by_project_phase", (q) => q.eq("projectId", args.projectId).eq("phase", "planning"))
            .filter((q) => q.eq(q.field("isActive"), true))
            .first();

        if (!activePlan) {
            throw new Error("Approve a planning document first (Planning tab → Approve Plan).");
        }

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

        const defaults = getProjectPricingDefaults(project);

        const breakdown: QuoteBreakdownItem[] = sections
            .slice()
            .sort((a, b) => (a.group !== b.group ? a.group.localeCompare(b.group) : a.sortOrder - b.sortOrder))
            .map((section) => {
                const materials = materialsBySection.get(section._id) ?? [];
                const work = workBySection.get(section._id) ?? [];
                const stats = calculateSectionSnapshot(section, materials, work, defaults);
                return {
                    label: `${section.group}: ${section.name}`,
                    amount: stats.plannedClientPrice,
                    currency: defaults.currency,
                    notes: null,
                };
            })
            .filter((item) => item.amount > 0);

        const totalAmount = breakdown.reduce((sum, item) => sum + item.amount, 0);
        const clientDocumentText = buildClientDocument({
            project,
            currency: defaults.currency,
            breakdown,
            totalAmount,
        });

        const existing = await ctx.db
            .query("quotes")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();
        const version = existing.length + 1;

        await ctx.db.insert("quotes", {
            projectId: args.projectId,
            version,
            internalBreakdownJson: JSON.stringify(breakdown),
            clientDocumentText,
            currency: defaults.currency,
            totalAmount,
            createdAt: Date.now(),
            createdBy: "user",
        });

        const quoteText = [
            `Currency: ${defaults.currency}`,
            `Total: ${totalAmount}`,
            "Breakdown:",
            ...breakdown.map((item) => `- ${item.label}: ${item.amount} ${item.currency}`),
            "",
            "Client Document:",
            clientDocumentText,
        ].join("\n");

        await ctx.scheduler.runAfter(0, internal.knowledge.ingestArtifact, {
            projectId: args.projectId,
            sourceType: "quote",
            sourceRefId: `quote-v${version}`,
            title: `Quote v${version}`,
            text: quoteText,
            summary: clientDocumentText.slice(0, 500),
            tags: ["quote", "pricing", "cost-based"],
            topics: [],
            clientName: project.clientName,
            domain: "pricing",
        });

        return { version, totalAmount };
    },
});
