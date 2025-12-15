import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { Doc } from "../_generated/dataModel";
import { calculateSectionSnapshot, getProjectPricingDefaults } from "../lib/costing";
import { createDeepResearchInteraction, getInteraction } from "../lib/geminiInteractions";

function escapeTableCell(text: string) {
    return text.replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}

function buildPromptHebrewMarkdown(args: {
    project: Doc<"projects">;
    planMarkdown: string;
    accountingSummaryMarkdown: string;
    materialsPlanningMarkdown: string;
    laborPlanningMarkdown: string;
    sections: Array<{ group: string; name: string; description?: string | null }>;
}) {
    return [
        "Run deep research to produce a highly detailed cost-estimation report for this project.",
        "",
        "Output requirements:",
        "- Language: Hebrew.",
        "- Format: GitHub-flavored Markdown (headings, tables, lists).",
        "- Render-friendly: avoid raw HTML.",
        "",
        "Citations requirement (important):",
        "- Use GitHub-flavored Markdown footnotes for citations.",
        "- Cite inline as `[^1]` (numbers only, no 'cite:' text).",
        "- At the end, include a 'Sources' section that contains footnote definitions like:",
        "  `[^1]: [Title](https://example.com) — short snippet`",
        "",
        "Notes about the inputs below:",
        "- The existing planned costs/quantities are NOT ground truth; treat them as placeholders and use them to guide what to research.",
        "- Prefer Israel-focused purchasing options when possible; currency: ILS.",
        "- Provide purchase links where available; if a price cannot be found, say so and provide a best-effort estimate with clear confidence.",
        "",
        "Requested report structure (use Hebrew headings):",
        "1. Executive Summary",
        "2. Assumptions & Unknowns (explicit)",
        "3. Per accounting line item (repeat for each item):",
        "   - Item title (Group + Name)",
        "   - Detailed process / steps",
        "   - Materials table (name, spec, quantity, unit, estimated unit cost, estimated total cost, purchase links)",
        "   - Labor table (role, hours, ILS/hr, cost, notes)",
        "   - Direct cost subtotal (materials + labor)",
        "   - Inline citations via footnotes",
        "4. Risk notes (market volatility, lead times, availability)",
        "5. Sources (footnotes section at the end)",
        "",
        `Project: ${args.project.name} (${args.project.clientName})`,
        "",
        "Approved Plan Markdown:",
        args.planMarkdown,
        "",
        "Distilled Cost Planning (Summary from DB; NOT ground truth):",
        args.accountingSummaryMarkdown,
        "",
        "Materials Detailed Planning (from DB; NOT ground truth):",
        args.materialsPlanningMarkdown,
        "",
        "Labor Detailed Planning (from DB; NOT ground truth):",
        args.laborPlanningMarkdown,
        "",
        "Accounting Items (line items):",
        args.sections
            .map((s) => {
                const group = escapeTableCell(s.group);
                const name = escapeTableCell(s.name);
                const description = s.description ? ` — ${escapeTableCell(s.description)}` : "";
                return `- [${group}] ${name}${description}`;
            })
            .join("\n"),
    ].join("\n");
}

export const getContext: ReturnType<typeof internalQuery> = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");

        const activePlan = await ctx.db
            .query("plans")
            .withIndex("by_project_phase", (q) => q.eq("projectId", args.projectId).eq("phase", "planning"))
            .filter((q) => q.eq(q.field("isActive"), true))
            .first();

        if (!activePlan) throw new Error("No approved plan found. Approve a plan in the Planning tab first.");

        const sections = await ctx.db
            .query("sections")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();
        sections.sort((a, b) => (a.group !== b.group ? a.group.localeCompare(b.group) : a.sortOrder - b.sortOrder));

        const allMaterials = await ctx.db
            .query("materialLines")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();
        const allWork = await ctx.db
            .query("workLines")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const materialsBySection = new Map<string, Doc<"materialLines">[]>();
        const workBySection = new Map<string, Doc<"workLines">[]>();

        for (const material of allMaterials) {
            const sectionId = material.sectionId;
            if (!materialsBySection.has(sectionId)) materialsBySection.set(sectionId, []);
            materialsBySection.get(sectionId)!.push(material);
        }
        for (const workLine of allWork) {
            const sectionId = workLine.sectionId;
            if (!workBySection.has(sectionId)) workBySection.set(sectionId, []);
            workBySection.get(sectionId)!.push(workLine);
        }

        const defaults = getProjectPricingDefaults(project);
        const sectionData = sections.map((section) => {
            const materials = materialsBySection.get(section._id) ?? [];
            const work = workBySection.get(section._id) ?? [];
            const snapshot = calculateSectionSnapshot(section, materials, work, defaults);
            return { section, materials, work, snapshot };
        });

        const totals = sectionData.reduce(
            (acc, curr) => ({
                plannedDirect: acc.plannedDirect + curr.snapshot.plannedDirectCost,
                plannedClientPrice: acc.plannedClientPrice + curr.snapshot.plannedClientPrice,
                actualDirect: acc.actualDirect + curr.snapshot.actualDirectCost,
            }),
            { plannedDirect: 0, plannedClientPrice: 0, actualDirect: 0 },
        );

        return { project, activePlan, sectionData, totals };
    },
});

export const createRun = internalMutation({
    args: {
        projectId: v.id("projects"),
        planId: v.id("plans"),
        interactionId: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("deepResearchRuns", {
            projectId: args.projectId,
            planId: args.planId,
            createdAt: Date.now(),
            createdBy: "user",
            status: "in_progress",
            interactionId: args.interactionId,
            lastPolledAt: Date.now(),
        });
    },
});

export const updateRun = internalMutation({
    args: {
        runId: v.id("deepResearchRuns"),
        patch: v.object({
            status: v.optional(v.union(v.literal("in_progress"), v.literal("completed"), v.literal("failed"))),
            lastPolledAt: v.optional(v.number()),
            reportMarkdown: v.optional(v.string()),
            reportJson: v.optional(v.string()),
            error: v.optional(v.string()),
        }),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.runId, args.patch);
    },
});

export const getRun = query({
    args: { runId: v.id("deepResearchRuns") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.runId);
    },
});

export const startProject: ReturnType<typeof action> = action({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const { project, activePlan, sectionData, totals } = await ctx.runQuery(internal.agents.deepResearch.getContext, {
            projectId: args.projectId,
        });

        const currency = project.currency ?? "ILS";

        const accountingSummaryMarkdown = [
            `- Currency: ${currency}`,
            `- Planned direct total (DB): ${Math.round(totals.plannedDirect).toLocaleString("en-US")} ${currency}`,
            `- Planned client price total (DB): ${Math.round(totals.plannedClientPrice).toLocaleString("en-US")} ${currency}`,
            "",
            "| Group | Item | Planned materials | Planned labor | Planned direct | Planned client price |",
            "|---|---|---:|---:|---:|---:|",
            ...sectionData.map((s) => {
                const group = escapeTableCell(s.section.group);
                const name = escapeTableCell(s.section.name);
                return `| ${group} | ${name} | ${Math.round(s.snapshot.plannedMaterialsCostE).toLocaleString("en-US")} ${currency} | ${Math.round(s.snapshot.plannedWorkCostS).toLocaleString("en-US")} ${currency} | ${Math.round(s.snapshot.plannedDirectCost).toLocaleString("en-US")} ${currency} | ${Math.round(s.snapshot.plannedClientPrice).toLocaleString("en-US")} ${currency} |`;
            }),
        ].join("\n");

        const materialsPlanningMarkdown = [
            "| Group | Item | Category | Label | Specs/Description | Qty | Unit | Planned unit cost | Planned total |",
            "|---|---|---|---|---|---:|---|---:|---:|",
            ...sectionData.flatMap((s) => {
                const group = escapeTableCell(s.section.group);
                const item = escapeTableCell(s.section.name);
                return s.materials.map((m) => {
                    const plannedTotal = m.plannedQuantity * m.plannedUnitCost;
                    return `| ${group} | ${item} | ${escapeTableCell(m.category)} | ${escapeTableCell(m.label)} | ${escapeTableCell(m.description ?? "")} | ${m.plannedQuantity} | ${escapeTableCell(m.unit)} | ${Math.round(m.plannedUnitCost).toLocaleString("en-US")} ${currency} | ${Math.round(plannedTotal).toLocaleString("en-US")} ${currency} |`;
                });
            }),
        ].join("\n");

        const laborPlanningMarkdown = [
            "| Group | Item | Work type | Role | Rate type | Qty | Planned unit cost | Planned total | Description |",
            "|---|---|---|---|---|---:|---:|---:|---|",
            ...sectionData.flatMap((s) => {
                const group = escapeTableCell(s.section.group);
                const item = escapeTableCell(s.section.name);
                return s.work.map((w) => {
                    const plannedTotal = w.rateType === "flat" ? w.plannedUnitCost : w.plannedQuantity * w.plannedUnitCost;
                    return `| ${group} | ${item} | ${escapeTableCell(w.workType)} | ${escapeTableCell(w.role)} | ${escapeTableCell(w.rateType)} | ${w.plannedQuantity} | ${Math.round(w.plannedUnitCost).toLocaleString("en-US")} ${currency} | ${Math.round(plannedTotal).toLocaleString("en-US")} ${currency} | ${escapeTableCell(w.description ?? "")} |`;
                });
            }),
        ].join("\n");

        const prompt = buildPromptHebrewMarkdown({
            project,
            planMarkdown: activePlan.contentMarkdown,
            accountingSummaryMarkdown,
            materialsPlanningMarkdown,
            laborPlanningMarkdown,
            sections: sectionData.map((s) => ({
                group: s.section.group,
                name: s.section.name,
                description: s.section.description ?? null,
            })),
        });

        const interaction = await createDeepResearchInteraction({
            input: prompt,
            agent: "deep-research-pro-preview-12-2025",
        });

        const interactionId = interaction.id;
        if (!interactionId) throw new Error("Deep research did not return an interaction id");

        const runId = await ctx.runMutation(internal.agents.deepResearch.createRun, {
            projectId: args.projectId,
            planId: activePlan._id,
            interactionId,
        });

        return { runId, interactionId };
    },
});

export const pollRun: ReturnType<typeof action> = action({
    args: { runId: v.id("deepResearchRuns") },
    handler: async (ctx, args) => {
        const run = await ctx.runQuery(internal.agents.deepResearch.getRun, { runId: args.runId });
        if (!run) throw new Error("Run not found");
        if (!run.interactionId) throw new Error("Run has no interactionId");

        const interaction = await getInteraction({ id: run.interactionId });
        const status = interaction.status ?? "in_progress";
        const lastText = interaction.outputs?.[interaction.outputs.length - 1]?.text ?? "";

        if (status === "completed") {
            await ctx.runMutation(internal.agents.deepResearch.updateRun, {
                runId: args.runId,
                patch: {
                    status: "completed",
                    lastPolledAt: Date.now(),
                    reportMarkdown: lastText,
                    reportJson: JSON.stringify(interaction),
                },
            });
        } else if (status === "failed") {
            await ctx.runMutation(internal.agents.deepResearch.updateRun, {
                runId: args.runId,
                patch: {
                    status: "failed",
                    lastPolledAt: Date.now(),
                    error: interaction.error ?? "Deep research failed",
                    reportJson: JSON.stringify(interaction),
                },
            });
        } else {
            await ctx.runMutation(internal.agents.deepResearch.updateRun, {
                runId: args.runId,
                patch: {
                    status: "in_progress",
                    lastPolledAt: Date.now(),
                    reportJson: JSON.stringify(interaction),
                },
            });
        }

        return { status };
    },
});
