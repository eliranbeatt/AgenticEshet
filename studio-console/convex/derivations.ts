import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

type TaskOp =
    | { op: "add"; task: Record<string, unknown> }
    | { op: "update"; taskId: Id<"tasks">; patch: Record<string, unknown> }
    | { op: "delete_all_generated_for_element" };

type MaterialOp =
    | { op: "add"; line: Record<string, unknown> }
    | { op: "update"; lineId: Id<"materialLines">; patch: Record<string, unknown> }
    | { op: "delete_all_generated_for_element" };

type AccountingOp =
    | { op: "recompute_element_rollup"; elementId: Id<"projectItems"> }
    | { op: "delete_all_generated_for_element" };

type ChangeSet = {
    elementId?: Id<"projectItems">;
    elementVersionId?: Id<"elementVersions">;
    projectVersionId?: Id<"projectVersions">;
    ops?: {
        tasks?: TaskOp[];
        materials?: MaterialOp[];
        accounting?: AccountingOp[];
    };
};

function isUnlockedGenerated(row: { generation?: "generated" | "manual"; lock?: boolean }) {
    return row.generation === "generated" && row.lock !== true;
}

function computeAccountingSum(lines: Doc<"accountingLines">[]) {
    return lines.reduce((sum, line) => {
        if (line.isManagement) return sum;
        if (line.quantity !== undefined && line.unitCost !== undefined) {
            return sum + line.quantity * line.unitCost;
        }
        if (line.unitCost !== undefined) return sum + line.unitCost;
        return sum;
    }, 0);
}

function computeMaterialSum(lines: Doc<"materialLines">[]) {
    return lines.reduce((sum, line) => {
        if (line.isManagement) return sum;
        return sum + line.plannedQuantity * line.plannedUnitCost;
    }, 0);
}

function computeWorkSum(lines: Doc<"workLines">[]) {
    return lines.reduce((sum, line) => {
        if (line.isManagement) return sum;
        const cost = line.rateType === "flat" ? line.plannedUnitCost : line.plannedQuantity * line.plannedUnitCost;
        return sum + cost;
    }, 0);
}

async function recomputeElementRollup(ctx: MutationCtx, args: { projectId: Id<"projects">; elementId: Id<"projectItems"> }) {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");
    const element = await ctx.db.get(args.elementId);
    if (!element) throw new Error("Element not found");

    const [accountingLines, materialLines, workLines] = await Promise.all([
        ctx.db.query("accountingLines")
            .withIndex("by_project_item", (q) => q.eq("projectId", args.projectId).eq("itemId", args.elementId))
            .collect(),
        ctx.db.query("materialLines")
            .withIndex("by_project_item", (q) => q.eq("projectId", args.projectId).eq("itemId", args.elementId))
            .collect(),
        ctx.db.query("workLines")
            .withIndex("by_project_item", (q) => q.eq("projectId", args.projectId).eq("itemId", args.elementId))
            .collect(),
    ]);

    const baseCost = accountingLines.length > 0
        ? computeAccountingSum(accountingLines)
        : computeMaterialSum(materialLines) + computeWorkSum(workLines);

    const overheadPct = project.overheadPercent ?? 0.15;
    const riskPct = project.riskPercent ?? 0.10;
    const profitPct = project.profitPercent ?? 0.30;
    const overhead = baseCost * overheadPct;
    const risk = baseCost * riskPct;
    const profit = baseCost * profitPct;
    const sellPrice = baseCost + overhead + risk + profit;

    await ctx.db.patch(args.elementId, {
        rollups: {
            ...(element.rollups ?? {}),
            cost: {
                material: materialLines.length > 0 ? computeMaterialSum(materialLines) : undefined,
                labor: workLines.length > 0 ? computeWorkSum(workLines) : undefined,
                totalCost: baseCost,
                sellPrice,
                margin: sellPrice - baseCost,
                currency: project.currency ?? "ILS",
            },
        },
        updatedAt: Date.now(),
    });
}

async function ensureDefaultSection(ctx: MutationCtx, projectId: Id<"projects">) {
    const existing = await ctx.db.query("sections")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .first();
    if (existing) return existing._id;

    return await ctx.db.insert("sections", {
        projectId,
        group: "General",
        name: "General",
        sortOrder: 0,
        pricingMode: "estimated",
    });
}

export const listDerivationRuns = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const runs = await ctx.db
            .query("derivationRuns")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .collect();
        return runs.sort((a, b) => b.createdAt - a.createdAt);
    },
});

export const applyDerivationRun = mutation({
    args: {
        projectId: v.id("projects"),
        triggerType: v.union(v.literal("elementVersion"), v.literal("projectVersion")),
        triggerId: v.union(v.id("elementVersions"), v.id("projectVersions")),
        mode: v.union(v.literal("patch"), v.literal("replace")),
        elementId: v.optional(v.id("projectItems")),
        changeSet: v.any(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const runId = await ctx.db.insert("derivationRuns", {
            projectId: args.projectId,
            triggerType: args.triggerType,
            triggerId: args.triggerId,
            mode: args.mode,
            status: "proposed",
            changeSet: args.changeSet,
            createdAt: now,
            updatedAt: now,
        });

        try {
            const changeSet = args.changeSet as ChangeSet;
            const elementId = args.elementId ?? changeSet.elementId;
            if (!elementId) throw new Error("elementId is required for derivation run");

            const derivedFrom = {
                elementVersionId: args.triggerType === "elementVersion" ? args.triggerId : changeSet.elementVersionId,
                projectVersionId: args.triggerType === "projectVersion" ? args.triggerId : changeSet.projectVersionId,
                derivationRunId: runId,
            };

            const ops = changeSet.ops ?? {};

            if (args.mode === "replace") {
                if (ops.tasks?.some((op: any) => op.op === "delete_all_generated_for_element")) {
                    const tasks = await ctx.db.query("tasks")
                        .withIndex("by_project_item", (q) => q.eq("projectId", args.projectId).eq("itemId", elementId))
                        .collect();
                    for (const task of tasks) {
                        if (isUnlockedGenerated(task)) {
                            await ctx.db.delete(task._id);
                        }
                    }
                }

                if (ops.materials?.some((op: any) => op.op === "delete_all_generated_for_element")) {
                    const materials = await ctx.db.query("materialLines")
                        .withIndex("by_project_item", (q) => q.eq("projectId", args.projectId).eq("itemId", elementId))
                        .collect();
                    for (const line of materials) {
                        if (isUnlockedGenerated(line)) {
                            await ctx.db.delete(line._id);
                        }
                    }
                }

                if (ops.accounting?.some((op: any) => op.op === "delete_all_generated_for_element")) {
                    const lines = await ctx.db.query("accountingLines")
                        .withIndex("by_project_item", (q) => q.eq("projectId", args.projectId).eq("itemId", elementId))
                        .collect();
                    for (const line of lines) {
                        if (isUnlockedGenerated(line)) {
                            await ctx.db.delete(line._id);
                        }
                    }
                }
            }

            if (Array.isArray(ops.tasks)) {
                for (const op of ops.tasks) {
                    if (op.op === "add" && op.task) {
                        await ctx.db.insert("tasks", {
                            projectId: args.projectId,
                            itemId: elementId,
                            title: (op.task.titleHe as string) ?? (op.task.title as string) ?? "Task",
                            description: (op.task.detailsHe as string) ?? (op.task.description as string),
                            status: "todo",
                            category: "Execution",
                            priority: "Medium",
                            estimatedMinutes: op.task.estimateMinutes as number | undefined,
                            source: "agent",
                            generation: "generated",
                            lock: false,
                            derivedFrom,
                            createdAt: now,
                            updatedAt: now,
                        });
                    }
                    if (op.op === "update" && op.taskId && op.patch) {
                        await ctx.db.patch(op.taskId, {
                            ...op.patch,
                            updatedAt: now,
                        });
                    }
                }
            }

            if (Array.isArray(ops.materials)) {
                for (const op of ops.materials) {
                    if (op.op === "add" && op.line) {
                        const sectionId = op.line.sectionId ?? await ensureDefaultSection(ctx, args.projectId);
                        await ctx.db.insert("materialLines", {
                            projectId: args.projectId,
                            sectionId,
                            itemId: elementId,
                            category: (op.line.categoryHe as string) ?? "Materials",
                            label: (op.line.descriptionHe as string) ?? (op.line.label as string) ?? "Material",
                            unit: (op.line.unit as string) ?? "unit",
                            plannedQuantity: (op.line.qty as number) ?? 1,
                            plannedUnitCost: (op.line.unitCostNis as number) ?? 0,
                            status: "planned",
                            generation: "generated",
                            lock: false,
                            derivedFrom,
                        });
                    }
                    if (op.op === "update" && op.lineId && op.patch) {
                        await ctx.db.patch(op.lineId, {
                            ...op.patch,
                            updatedAt: now,
                        });
                    }
                }
            }

            if (Array.isArray(ops.accounting)) {
                for (const op of ops.accounting) {
                    if (op.op === "recompute_element_rollup") {
                        await recomputeElementRollup(ctx, { projectId: args.projectId, elementId });
                    }
                }
            }

            await ctx.db.patch(runId, { status: "applied", updatedAt: Date.now() });
            return { runId };
        } catch (error: any) {
            await ctx.db.patch(runId, {
                status: "error",
                error: error?.message ?? "Unknown derivation error",
                updatedAt: Date.now(),
            });
            throw error;
        }
    },
});
