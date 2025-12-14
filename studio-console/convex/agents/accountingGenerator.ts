import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { z } from "zod";
import { callChatWithSchema } from "../lib/openai";
import { Doc, Id } from "../_generated/dataModel";

const AccountingFromPlanSchema = z.object({
    sections: z.array(
        z.object({
            group: z.string(),
            name: z.string(),
            description: z.string().nullable(),
            materials: z.array(
                z.object({
                    category: z.string(),
                    label: z.string(),
                    unit: z.string(),
                    quantity: z.number().nonnegative(),
                    unitCost: z.number().nonnegative(),
                    vendorName: z.string().nullable(),
                    description: z.string().nullable(),
                }),
            ),
            work: z.array(
                z.object({
                    workType: z.string(),
                    role: z.enum(["Art worker", "Art manager"]),
                    rateType: z.enum(["hour", "day", "flat"]),
                    quantity: z.number().nonnegative(),
                    unitCost: z.number().nonnegative(),
                    description: z.string().nullable(),
                }),
            ),
        }),
    ),
});

type AccountingFromPlan = z.infer<typeof AccountingFromPlanSchema>;

function buildPrompt(args: {
    project: Doc<"projects">;
    planMarkdown: string;
}) {
    return [
        `Project: ${args.project.name}`,
        `Customer: ${args.project.clientName}`,
        "",
        "Convert the APPROVED plan Markdown into accounting Sections + line items.",
        "",
        "Rules:",
        "- Output costs only (not sell price). Currency: ILS.",
        "- Create accounting sections (group + name). Each section should be a customer-facing deliverable item.",
        "- You MUST always include all keys required by the schema.",
        "- If a section has no materials, set materials to an empty array [].",
        "- If a section has no work, set work to an empty array [].",
        "- If a description is unknown/empty, set description to null.",
        "- Labor roles allowed: Art worker and Art manager only.",
        "- Role cost rates (hourly cost): Art worker=100 ILS/hour, Art manager=200 ILS/hour.",
        "- Use rateType hour/day/flat; for 'day' unitCost is ILS/day; for 'hour' unitCost is ILS/hour.",
        "- Keep counts realistic and detailed enough for budgeting.",
        "",
        "Approved Plan Markdown:",
        args.planMarkdown,
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
                description: section.description ?? undefined,
                sortOrder,
                pricingMode: "estimated",
            });
            createdSectionIds.push(sectionId);
            sortOrder += 1;

            for (const material of section.materials) {
                await ctx.db.insert("materialLines", {
                    projectId: args.projectId,
                    sectionId,
                    category: material.category,
                    label: material.label,
                    description: material.description ?? undefined,
                    vendorName: material.vendorName ?? undefined,
                    unit: material.unit,
                    plannedQuantity: material.quantity,
                    plannedUnitCost: material.unitCost,
                    status: "planned",
                });
            }

            for (const workLine of section.work) {
                await ctx.db.insert("workLines", {
                    projectId: args.projectId,
                    sectionId,
                    workType: workLine.workType,
                    role: workLine.role,
                    rateType: workLine.rateType,
                    plannedQuantity: workLine.rateType === "flat" ? 1 : workLine.quantity,
                    plannedUnitCost: workLine.unitCost,
                    status: "planned",
                    description: workLine.description ?? undefined,
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

        const systemPrompt =
            "You are an expert cost estimator and production accountant for a creative studio. " +
            "Return structured JSON only that matches the required schema.";

        const payload = await callChatWithSchema(AccountingFromPlanSchema, {
            systemPrompt,
            userPrompt: buildPrompt({ project, planMarkdown: activePlan.contentMarkdown }),
            temperature: 0.2,
        });

        await ctx.runMutation(internal.agents.accountingGenerator.applyGeneratedAccounting, {
            projectId: args.projectId,
            payload,
            replaceExisting: args.replaceExisting ?? true,
        });

        return { sections: payload.sections.length };
    },
});
