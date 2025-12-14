import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { Doc } from "../_generated/dataModel";
import { createDeepResearchInteraction, getInteraction } from "../lib/geminiInteractions";

function buildPrompt(args: {
    project: Doc<"projects">;
    planMarkdown: string;
    sections: Array<{ group: string; name: string; description?: string | null }>;
}) {
    return [
        "Run deep research to produce a highly detailed cost-estimation report for this project.",
        "",
        "Output format (Markdown):",
        "1. Executive Summary",
        "2. Assumptions & Unknowns (explicit)",
        "3. Per Line Item (repeat for each accounting item):",
        "   - Item title (Group + Name)",
        "   - Detailed process / steps",
        "   - Materials table (name, spec, quantity, unit, estimated unit cost, estimated total cost, purchase links)",
        "   - Labor table (role: Art worker 100 ILS/hr, Art manager 200 ILS/hr; hours; cost; notes)",
        "   - Direct cost subtotal (materials + labor)",
        "   - Citations (bullet list of links)",
        "4. Risk notes (market volatility, lead times, availability)",
        "",
        "Rules:",
        "- Currency: ILS.",
        "- Provide purchasing links when available.",
        "- If a price cannot be found, say so and give a best-effort estimate with clearly labeled confidence.",
        "",
        `Project: ${args.project.name} (${args.project.clientName})`,
        "",
        "Approved Plan Markdown:",
        args.planMarkdown,
        "",
        "Accounting Items (line items):",
        args.sections
            .map((s) => `- [${s.group}] ${s.name}${s.description ? ` — ${s.description}` : ""}`)
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

        return { project, activePlan, sections };
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
        const { project, activePlan, sections } = await ctx.runQuery(internal.agents.deepResearch.getContext, {
            projectId: args.projectId,
        });

        const prompt = buildPrompt({
            project,
            planMarkdown: activePlan.contentMarkdown,
            sections: sections.map((s) => ({ group: s.group, name: s.name, description: s.description ?? null })),
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
