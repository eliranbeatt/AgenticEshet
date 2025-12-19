import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
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

type WizardBreakdownItem = {
    label: string;
    amount: number;
    currency: string;
    notes?: string | null;
};

function buildWizardClientDocument(args: {
    project: Doc<"projects">;
    currency: string;
    breakdown: WizardBreakdownItem[];
    totalAmount: number;
    notesToClient?: string;
}) {
    const lines: string[] = [];
    lines.push("הצעת מחיר");
    lines.push(`לקוח: ${args.project.clientName}`);
    lines.push(`פרויקט: ${args.project.name}`);
    lines.push(`מטבע: ${args.currency}`);
    lines.push("");
    lines.push("סעיפים:");
    for (const item of args.breakdown) {
        const notes = item.notes ? ` — ${item.notes}` : "";
        lines.push(`- ${item.label}: ${formatMoney(item.amount, args.currency)}${notes}`);
    }
    lines.push("");
    lines.push(`סה\"כ: ${formatMoney(args.totalAmount, args.currency)}`);
    if (args.notesToClient?.trim()) {
        lines.push("");
        lines.push(args.notesToClient.trim());
    }
    return lines.join("\n");
}

export const createFromWizard = mutation({
    args: {
        projectId: v.id("projects"),
        currency: v.string(),
        breakdown: v.array(
            v.object({
                label: v.string(),
                amount: v.number(),
                currency: v.string(),
                notes: v.optional(v.union(v.string(), v.null())),
            })
        ),
        notesToClient: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");

        const breakdown = args.breakdown.filter((i) => i.amount > 0);
        const totalAmount = breakdown.reduce((sum, item) => sum + item.amount, 0);

        const existing = await ctx.db
            .query("quotes")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();
        const version = existing.length + 1;

        const clientDocumentText = buildWizardClientDocument({
            project,
            currency: args.currency,
            breakdown,
            totalAmount,
            notesToClient: args.notesToClient,
        });

        const quoteId = await ctx.db.insert("quotes", {
            projectId: args.projectId,
            version,
            internalBreakdownJson: JSON.stringify(breakdown),
            clientDocumentText,
            currency: args.currency,
            totalAmount,
            createdAt: Date.now(),
            createdBy: "user",
        });

        return { quoteId, version, totalAmount };
    },
});

async function getSettingValue(ctx: QueryCtx, key: string): Promise<string | null> {
    const row = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();
    if (!row?.valueJson) return null;
    try {
        return JSON.parse(row.valueJson) as string;
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export const getQuotePdfData = query({
    args: { quoteId: v.id("quotes") },
    handler: async (ctx, args) => {
        const quote = await ctx.db.get(args.quoteId);
        if (!quote) throw new Error("Quote not found");
        const project = await ctx.db.get(quote.projectId);
        if (!project) throw new Error("Project not found");

        const brandingLogoStorageId = await getSettingValue(ctx, "branding_logo_storage_id");
        const quoteFooterHebrew = (await getSettingValue(ctx, "quote_footer_hebrew")) ?? "";

        const brandingLogoUrl = brandingLogoStorageId ? await ctx.storage.getUrl(brandingLogoStorageId) : null;
        const pdfUrl = quote.pdfStorageId ? await ctx.storage.getUrl(quote.pdfStorageId) : null;

        let breakdown: WizardBreakdownItem[] = [];
        try {
            const parsed = JSON.parse(quote.internalBreakdownJson) as unknown;
            if (Array.isArray(parsed)) {
                breakdown = parsed
                    .map((item) => {
                        if (!isRecord(item)) {
                            return { label: "", amount: 0, currency: quote.currency, notes: null };
                        }
                        const label = typeof item.label === "string" ? item.label : String(item.label ?? "");
                        const amount = typeof item.amount === "number" ? item.amount : Number(item.amount ?? 0);
                        const currency = typeof item.currency === "string" ? item.currency : quote.currency;
                        const notes = item.notes === null || typeof item.notes === "string" ? item.notes : null;
                        return { label, amount, currency, notes };
                    })
                    .filter((i) => i.label && i.amount > 0);
            }
        } catch {
            breakdown = [];
        }

        return {
            quote,
            project,
            breakdown,
            brandingLogoUrl,
            quoteFooterHebrew,
            pdfUrl,
        };
    },
});

export const generatePdfUploadUrl = mutation({
    args: {},
    handler: async (ctx) => {
        return await ctx.storage.generateUploadUrl();
    },
});

export const attachPdf = mutation({
    args: { quoteId: v.id("quotes"), pdfStorageId: v.string() },
    handler: async (ctx, args) => {
        const quote = await ctx.db.get(args.quoteId);
        if (!quote) throw new Error("Quote not found");
        await ctx.db.patch(args.quoteId, { pdfStorageId: args.pdfStorageId });
        const pdfUrl = await ctx.storage.getUrl(args.pdfStorageId);
        return { pdfUrl };
    },
});
