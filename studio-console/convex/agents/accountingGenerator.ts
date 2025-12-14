import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { z } from "zod";
import { generateJsonWithGemini } from "../lib/gemini";
import { Doc, Id } from "../_generated/dataModel";

const AccountingFromPlanSchema = z.object({
    sections: z.array(
        z.object({
            group: z.string(),
            name: z.string(),
            description: z.string().optional(),
            materials: z
                .array(
                    z.object({
                        category: z.string(),
                        label: z.string(),
                        unit: z.string(),
                        quantity: z.number().nonnegative(),
                        unitCost: z.number().nonnegative(),
                        vendorName: z.string().optional(),
                        description: z.string().optional(),
                    }),
                )
                .optional(),
            work: z
                .array(
                    z.object({
                        workType: z.string(),
                        role: z.enum(["Art worker", "Art manager"]),
                        rateType: z.enum(["hour", "day", "flat"]),
                        quantity: z.number().nonnegative(),
                        unitCost: z.number().nonnegative(),
                        description: z.string().optional(),
                    }),
                )
                .optional(),
        }),
    ),
});

type AccountingFromPlan = z.infer<typeof AccountingFromPlanSchema>;

function buildPrompt(args: {
    project: Doc<"projects">;
    planMarkdown: string;
}) {
    return [
        "You are an operations planner for a creative studio.",
        "Goal: convert the approved project plan (Markdown) into accounting sections + line items.",
        "",
        "Return STRICT JSON only (no markdown, no prose).",
        "Rules:",
        "- Create a concise list of accounting SECTIONS (group + name). Each section must be a customer-facing deliverable item.",
        "- For each section, include estimated MATERIALS lines (optional) and LABOR lines (optional).",
        "- Use currency: ILS. All costs are COSTS (not sell price).",
        "- Roles allowed: Art worker (100 ILS/hour), Art manager (200 ILS/hour). Map all labor into these roles.",
        "- rateType: hour/day/flat. If day is used, assume quantity in days and unitCost is ILS/day (derive from hourly when needed).",
        "- Keep section names short; keep groups like: General, Studio Elements, Logistics, Printing, Installation, etc.",
        "",
        "Approved Plan Markdown:",
        args.planMarkdown,
        "",
        "Output JSON schema:",
        JSON.stringify(
            {
                sections: [
                    {
                        group: "string",
                        name: "string",
                        description: "string",
                        materials: [
                            {
                                category: "string",
                                label: "string",
                                unit: "string",
                                quantity: 0,
                                unitCost: 0,
                                vendorName: "string",
                                description: "string",
                            },
                        ],
                        work: [
                            {
                                workType: "studio|field|management",
                                role: "Art worker|Art manager",
                                rateType: "hour|day|flat",
                                quantity: 0,
                                unitCost: 0,
                                description: "string",
                            },
                        ],
                    },
                ],
            },
            null,
            2,
        ),
    ].join("\n");
}

export const getContext = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");

        const activePlan = await ctx.db
            .query("plans")
            .withIndex("by_project_phase", (q) => q.eq("projectId", args.projectId).eq("phase", "planning"))
            .filter((q) => q.eq(q.field("isActive"), true))
            .first();

        if (!activePlan) {
            throw new Error("No approved plan found. Approve a plan in the Planning tab first.");
        }

        return { project, activePlan };
    },
});

export const applyGeneratedAccounting = internalMutation({
    args: {
        projectId: v.id("projects"),
        payload: v.any(),
        replaceExisting: v.boolean(),
    },
    handler: async (ctx, args) => {
        const payload = args.payload as AccountingFromPlan;

        if (args.replaceExisting) {
            const materials = await ctx.db
                .query("materialLines")
                .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
                .collect();
            for (const material of materials) await ctx.db.delete(material._id);

            const work = await ctx.db
                .query("workLines")
                .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
                .collect();
            for (const workLine of work) await ctx.db.delete(workLine._id);

            const sections = await ctx.db
                .query("sections")
                .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
                .collect();
            for (const section of sections) await ctx.db.delete(section._id);
        }

        let sortOrder = 1;
        const createdSectionIds: Array<Id<"sections">> = [];

        for (const section of payload.sections) {
            const sectionId = await ctx.db.insert("sections", {
                projectId: args.projectId,
                group: section.group,
                name: section.name,
                description: section.description,
                sortOrder,
                pricingMode: "estimated",
            });
            createdSectionIds.push(sectionId);
            sortOrder += 1;

            for (const material of section.materials ?? []) {
                await ctx.db.insert("materialLines", {
                    projectId: args.projectId,
                    sectionId,
                    category: material.category,
                    label: material.label,
                    description: material.description,
                    vendorName: material.vendorName,
                    unit: material.unit,
                    plannedQuantity: material.quantity,
                    plannedUnitCost: material.unitCost,
                    status: "planned",
                });
            }

            for (const workLine of section.work ?? []) {
                await ctx.db.insert("workLines", {
                    projectId: args.projectId,
                    sectionId,
                    workType: workLine.workType,
                    role: workLine.role,
                    rateType: workLine.rateType,
                    plannedQuantity: workLine.rateType === "flat" ? 1 : workLine.quantity,
                    plannedUnitCost: workLine.unitCost,
                    status: "planned",
                    description: workLine.description,
                });
            }
        }

        return { sectionsCreated: createdSectionIds.length };
    },
});

export const run: ReturnType<typeof action> = action({
    args: {
        projectId: v.id("projects"),
        replaceExisting: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const { project, activePlan } = await ctx.runQuery(internal.agents.accountingGenerator.getContext, {
            projectId: args.projectId,
        });

        const prompt = buildPrompt({ project, planMarkdown: activePlan.contentMarkdown });
        const payload = await generateJsonWithGemini({
            schema: AccountingFromPlanSchema,
            prompt,
            model: "gemini-pro",
            useGoogleSearch: false,
        });

        await ctx.runMutation(internal.agents.accountingGenerator.applyGeneratedAccounting, {
            projectId: args.projectId,
            payload,
            replaceExisting: args.replaceExisting ?? true,
        });

        return { sections: payload.sections.length };
    },
});

