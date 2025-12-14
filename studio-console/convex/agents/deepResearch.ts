import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { z } from "zod";
import { generateJsonWithGemini } from "../lib/gemini";
import { Doc } from "../_generated/dataModel";

const DeepResearchReportSchema = z.object({
    summary: z.string(),
    reportMarkdown: z.string(),
    items: z.array(
        z.object({
            group: z.string(),
            section: z.string(),
            process: z.string(),
            materials: z.array(
                z.object({
                    label: z.string(),
                    spec: z.string().optional(),
                    quantity: z.number().nonnegative().optional(),
                    unit: z.string().optional(),
                    estimatedUnitCost: z.number().nonnegative().optional(),
                    estimatedTotalCost: z.number().nonnegative().optional(),
                    buyLinks: z
                        .array(
                            z.object({
                                vendorName: z.string(),
                                url: z.string().url().optional(),
                                priceNote: z.string().optional(),
                            }),
                        )
                        .optional(),
                }),
            ),
            labor: z.array(
                z.object({
                    role: z.enum(["Art worker", "Art manager"]),
                    hours: z.number().nonnegative(),
                    hourlyCost: z.number().nonnegative(),
                    cost: z.number().nonnegative(),
                    notes: z.string().optional(),
                }),
            ),
            totals: z.object({
                materialsCost: z.number().nonnegative(),
                laborCost: z.number().nonnegative(),
                directCost: z.number().nonnegative(),
            }),
            citations: z
                .array(
                    z.object({
                        title: z.string(),
                        url: z.string().url(),
                        snippet: z.string(),
                    }),
                )
                .optional(),
        }),
    ),
});

function buildDeepResearchPrompt(args: {
    project: Doc<"projects">;
    planMarkdown: string;
    accountingSections: Array<{ group: string; name: string; description?: string | null }>;
    currency: string;
}) {
    return [
        "You are a deep research cost estimator for a creative studio in Israel.",
        "You MUST use web research (Google Search) to ground pricing and purchasing options when possible.",
        "",
        "Return STRICT JSON only (no markdown fences, no prose).",
        "Currency: ILS.",
        "Labor roles and COST rates (not sell):",
        "- Art worker: 100 ILS/hour",
        "- Art manager: 200 ILS/hour",
        "",
        "Input includes an APPROVED plan (Markdown) and current accounting section titles.",
        "Task:",
        "- For EACH accounting section, produce: detailed process, materials list with realistic Israeli prices, and labor hours/costs.",
        "- Include buy links when available (vendor pages, marketplaces, etc).",
        "- Provide citations (title/url/snippet) for key price claims when possible.",
        "- Be explicit about assumptions and what needs confirmation.",
        "",
        "Approved Plan Markdown:",
        args.planMarkdown,
        "",
        "Accounting Sections:",
        args.accountingSections.map((s) => `- [${s.group}] ${s.name}${s.description ? ` — ${s.description}` : ""}`).join("\n"),
        "",
        "Output JSON schema:",
        JSON.stringify(
            {
                summary: "string",
                reportMarkdown: "string (human-friendly markdown with links)",
                items: [
                    {
                        group: "string",
                        section: "string",
                        process: "string (detailed steps)",
                        materials: [
                            {
                                label: "string",
                                spec: "string",
                                quantity: 0,
                                unit: "string",
                                estimatedUnitCost: 0,
                                estimatedTotalCost: 0,
                                buyLinks: [{ vendorName: "string", url: "https://...", priceNote: "string" }],
                            },
                        ],
                        labor: [
                            {
                                role: "Art worker|Art manager",
                                hours: 0,
                                hourlyCost: 0,
                                cost: 0,
                                notes: "string",
                            },
                        ],
                        totals: { materialsCost: 0, laborCost: 0, directCost: 0 },
                        citations: [{ title: "string", url: "https://...", snippet: "string" }],
                    },
                ],
            },
            null,
            2,
        ),
    ].join("\n");
}

export const runProject: ReturnType<typeof action> = action({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const accounting = await ctx.runQuery(api.accounting.getProjectAccounting, { projectId: args.projectId });
        const project = accounting.project;

        const activePlan = await ctx.db
            .query("plans")
            .withIndex("by_project_phase", (q) => q.eq("projectId", args.projectId).eq("phase", "planning"))
            .filter((q) => q.eq(q.field("isActive"), true))
            .first();

        if (!activePlan) {
            throw new Error("No approved plan found. Approve a plan in the Planning tab first.");
        }

        const prompt = buildDeepResearchPrompt({
            project,
            planMarkdown: activePlan.contentMarkdown,
            accountingSections: accounting.sections.map((sectionData) => ({
                group: sectionData.section.group,
                name: sectionData.section.name,
                description: sectionData.section.description ?? null,
            })),
            currency: project.currency ?? "ILS",
        });

        try {
            let report: z.infer<typeof DeepResearchReportSchema>;
            try {
                report = await generateJsonWithGemini({
                    schema: DeepResearchReportSchema,
                    prompt,
                    model: "gemini-2.0-flash",
                    useGoogleSearch: true,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : "Deep research failed";
                report = await generateJsonWithGemini({
                    schema: DeepResearchReportSchema,
                    prompt: `${prompt}\n\nNOTE: Google Search tool may be unavailable in this environment. Provide best-effort estimates and cite sources only when you are confident.`,
                    model: "gemini-pro",
                    useGoogleSearch: false,
                });
                report = {
                    ...report,
                    reportMarkdown: `> Warning: Deep research tool failed (${message}). Report is best-effort without live search.\n\n${report.reportMarkdown}`,
                };
            }

            await ctx.db.insert("deepResearchRuns", {
                projectId: args.projectId,
                planId: activePlan._id,
                createdAt: Date.now(),
                createdBy: "user",
                status: "completed",
                reportMarkdown: report.reportMarkdown,
                reportJson: JSON.stringify(report),
            });

            return { items: report.items.length };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Deep research failed";
            await ctx.db.insert("deepResearchRuns", {
                projectId: args.projectId,
                planId: activePlan._id,
                createdAt: Date.now(),
                createdBy: "user",
                status: "failed",
                error: message,
            });
            throw error;
        }
    },
});
