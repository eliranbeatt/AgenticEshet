import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { z } from "zod";
import { callChatWithSchema } from "../lib/openai";
import { Doc, Id } from "../_generated/dataModel";
import { ItemSpecV2Schema } from "../lib/zodSchemas";
import { syncItemProjections } from "../lib/itemProjections";

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
        "- All user-facing labels (group, name, category, label, unit, description, vendorName, workType) must be in Hebrew.",
        "- Output costs only (not sell price). Currency: ILS.",
        "- Create accounting sections (group + name). Each section should be a customer-facing deliverable item.",
        "- You MUST always include all keys required by the schema.",
        "- If a section has no materials, set materials to an empty array [].",
        "- If a section has no work, set work to an empty array [].",
        "- If a description is unknown/empty, set description to null.",
        "- Labor roles allowed: Art worker and Art manager only.",
        "- Do NOT include studio management, producer, project management, budgeting, coordination, account management, meetings, reporting, or admin labor lines. Those are covered by profit/overhead and must not be double-counted.",
        "- Only include Art manager labor if the plan explicitly requests billing manager labor for a specific task; otherwise omit manager labor lines even if such tasks appear in the plan.",
        "- Role cost rates (hourly cost): Art worker=100 ILS/hour, Art manager=200 ILS/hour.",
        "- Use rateType hour/day/flat; for 'day' unitCost is ILS/day; for 'hour' unitCost is ILS/hour.",
        "- Keep counts realistic and detailed enough for budgeting.",
        "",
        "Approved Plan Markdown:",
        args.planMarkdown,
    ].join("\n");
}

function buildItemSpec(section: AccountingFromPlan["sections"][number]) {
    return ItemSpecV2Schema.parse({
        version: "ItemSpecV2",
        identity: {
            title: section.name,
            typeKey: section.group,
            description: section.description ?? undefined,
            accountingGroup: section.group,
        },
        breakdown: {
            subtasks: [],
            materials: section.materials.map((material, index) => ({
                id: `mat:${material.label}:${index + 1}`,
                category: material.category,
                label: material.label,
                description: material.description ?? undefined,
                qty: material.quantity,
                unit: material.unit,
                unitCostEstimate: material.unitCost,
                vendorName: material.vendorName ?? undefined,
            })),
            labor: section.work.map((workLine, index) => ({
                id: `labor:${workLine.role}:${index + 1}`,
                workType: workLine.workType,
                role: workLine.role,
                rateType: workLine.rateType,
                quantity: workLine.quantity,
                unitCost: workLine.unitCost,
                description: workLine.description ?? undefined,
            })),
        },
        state: {
            openQuestions: [],
            assumptions: [],
            decisions: [],
        },
        quote: {
            includeInQuote: true,
        },
    });
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
            const items: Doc<"projectItems">[] = [];
            for (const status of ["draft", "approved", "archived"] as const) {
                const batch = await ctx.db
                    .query("projectItems")
                    .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", status))
                    .collect();
                items.push(...batch);
            }

            for (const item of items) {
                if (item.status !== "archived") {
                    await ctx.db.patch(item._id, { status: "archived", archivedAt: Date.now(), updatedAt: Date.now() });
                }
            }

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
        for (const section of payload.sections) {
            const spec = buildItemSpec(section);
            const now = Date.now();

            const itemId = await ctx.db.insert("projectItems", {
                projectId: args.projectId,
                parentItemId: null,
                sortKey: String(sortOrder),
                title: spec.identity.title,
                typeKey: spec.identity.typeKey,
                name: spec.identity.title,
                category: spec.identity.typeKey,
                kind: "deliverable",
                description: spec.identity.description,
                searchText: `${spec.identity.title}\n${spec.identity.description ?? ""}\n${spec.identity.typeKey}`.trim(),
                status: "approved",
                sortOrder,
                createdFrom: { source: "accountingBackfill" },
                latestRevisionNumber: 1,
                createdAt: now,
                updatedAt: now,
            });
            sortOrder += 1;

            const revisionId = await ctx.db.insert("itemRevisions", {
                projectId: args.projectId,
                itemId,
                tabScope: "accounting",
                state: "approved",
                revisionNumber: 1,
                data: spec,
                summaryMarkdown: "Generated from approved plan.",
                createdBy: { kind: "agent" },
                createdAt: now,
            });

            await ctx.db.patch(itemId, {
                approvedRevisionId: revisionId,
                status: "approved",
                updatedAt: now,
            });

            const item = await ctx.db.get(itemId);
            const revision = await ctx.db.get(revisionId);
            if (item && revision) {
                await syncItemProjections(ctx, { item, revision, spec, force: true });
            }
        }

        return { itemsCreated: payload.sections.length };
    },
});

export const runInBackground: ReturnType<typeof internalAction> = internalAction({
    args: {
        projectId: v.id("projects"),
        replaceExisting: v.optional(v.boolean()),
        agentRunId: v.optional(v.id("agentRuns")),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const agentRunId = args.agentRunId;

        if (agentRunId) {
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId: agentRunId,
                status: "running",
                stage: "loading_context",
            });
            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId: agentRunId,
                level: "info",
                message: "Loading approved plan for accounting generation.",
                stage: "loading_context",
            });
        }

        try {
            const { project, activePlan } = await ctx.runQuery(internal.agents.accountingGenerator.getContext, {
                projectId: args.projectId,
            });

            const systemPrompt =
                "You are an expert cost estimator and production accountant for a creative studio. " +
                "Return structured JSON only that matches the required schema.";

            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: agentRunId,
                    level: "info",
                    message: "Calling model to convert plan into accounting sections and lines.",
                    stage: "llm_call",
                });
            }

            const payload = await callChatWithSchema(AccountingFromPlanSchema, {
                systemPrompt,
                userPrompt: buildPrompt({ project, planMarkdown: activePlan.contentMarkdown }),
                temperature: 0.2,
                thinkingMode: args.thinkingMode,
            });

            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: agentRunId,
                    level: "info",
                    message: `Persisting ${payload.sections.length} accounting sections.`,
                    stage: "persisting",
                });
            }

            await ctx.runMutation(internal.agents.accountingGenerator.applyGeneratedAccounting, {
                projectId: args.projectId,
                payload,
                replaceExisting: args.replaceExisting ?? true,
            });

            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.setStatus, {
                    runId: agentRunId,
                    status: "succeeded",
                    stage: "done",
                });
            }

            return { sections: payload.sections.length };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: agentRunId,
                    level: "error",
                    message,
                    stage: "failed",
                });
                await ctx.runMutation(internal.agentRuns.setStatus, {
                    runId: agentRunId,
                    status: "failed",
                    stage: "failed",
                    error: message,
                });
            }
            throw error;
        }
    },
});

export const run: ReturnType<typeof action> = action({
    args: {
        projectId: v.id("projects"),
        replaceExisting: v.optional(v.boolean()),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        await ctx.runQuery(internal.agents.accountingGenerator.getContext, { projectId: args.projectId });

        const agentRunId = await ctx.runMutation(internal.agentRuns.createRun, {
            projectId: args.projectId,
            agent: "accountingGenerator",
            stage: "queued",
            initialMessage: "Queued accounting generation from approved plan.",
        });

        await ctx.scheduler.runAfter(0, internal.agents.accountingGenerator.runInBackground, {
            projectId: args.projectId,
            replaceExisting: args.replaceExisting,
            agentRunId,
            thinkingMode: args.thinkingMode,
        });

        return { queued: true, runId: agentRunId };
    },
});
