import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

function parseTime(value?: string | number | null) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return value;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

function safeNumber(value?: number | null) {
    return typeof value === "number" && !Number.isNaN(value) ? value : 0;
}

export async function recomputeRollups(
    ctx: MutationCtx,
    args: { projectId: Id<"projects">; itemIds?: Id<"projectItems">[] }
) {
    const statuses: Array<Doc<"projectItems">["status"]> = [
        "draft",
        "proposed",
        "approved",
        "in_progress",
        "done",
        "blocked",
        "cancelled",
        "archived",
    ];

    const items: Doc<"projectItems">[] = [];
    for (const status of statuses) {
        const batch = await ctx.db
            .query("projectItems")
            .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", status))
            .collect();
        items.push(...batch);
    }

    const itemIdsFilter = args.itemIds ? new Set(args.itemIds) : null;

    const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();

    const accountingLines = await ctx.db
        .query("accountingLines")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();

    const tasksByItem = new Map<Id<"projectItems">, Doc<"tasks">[]>();
    for (const task of tasks) {
        if (!task.itemId) continue;
        const list = tasksByItem.get(task.itemId) ?? [];
        list.push(task);
        tasksByItem.set(task.itemId, list);
    }

    const linesByItem = new Map<Id<"projectItems">, Doc<"accountingLines">[]>();
    for (const line of accountingLines) {
        const list = linesByItem.get(line.itemId) ?? [];
        list.push(line);
        linesByItem.set(line.itemId, list);
    }

    const childrenByParent = new Map<Id<"projectItems"> | null, Doc<"projectItems">[]>();
    for (const item of items) {
        const parentId = item.parentItemId ?? null;
        const list = childrenByParent.get(parentId) ?? [];
        list.push(item);
        childrenByParent.set(parentId, list);
    }

    const rollups = new Map<Id<"projectItems">, NonNullable<Doc<"projectItems">["rollups"]>>();

    function computeForItem(item: Doc<"projectItems">): NonNullable<Doc<"projectItems">["rollups"]> {
        const existing = rollups.get(item._id);
        if (existing) return existing;

        const childItems = childrenByParent.get(item._id) ?? [];
        const childRollups = childItems.map(computeForItem);

        const itemLines = linesByItem.get(item._id) ?? [];
        const costTotals = {
            material: 0,
            labor: 0,
            rentals: 0,
            purchases: 0,
            shipping: 0,
            misc: 0,
            totalCost: 0,
            currency: itemLines[0]?.currency,
        };

        for (const line of itemLines) {
            const quantity = safeNumber(line.quantity ?? 1);
            const unitCost = safeNumber(line.unitCost);
            const amount = quantity * unitCost;

            switch (line.lineType) {
                case "material":
                    costTotals.material += amount;
                    break;
                case "labor":
                    costTotals.labor += amount;
                    break;
                case "rental":
                    costTotals.rentals += amount;
                    break;
                case "purchase":
                    costTotals.purchases += amount;
                    break;
                case "shipping":
                    costTotals.shipping += amount;
                    break;
                case "misc":
                    costTotals.misc += amount;
                    break;
                default:
                    break;
            }
        }

        for (const child of childRollups) {
            const childCost = child.cost ?? {};
            costTotals.material += safeNumber(childCost.material ?? 0);
            costTotals.labor += safeNumber(childCost.labor ?? 0);
            costTotals.rentals += safeNumber(childCost.rentals ?? 0);
            costTotals.purchases += safeNumber(childCost.purchases ?? 0);
            costTotals.shipping += safeNumber(childCost.shipping ?? 0);
            costTotals.misc += safeNumber(childCost.misc ?? 0);
        }

        costTotals.totalCost =
            costTotals.material +
            costTotals.labor +
            costTotals.rentals +
            costTotals.purchases +
            costTotals.shipping +
            costTotals.misc;

        const itemTasks = tasksByItem.get(item._id) ?? [];
        let durationHours = 0;
        let earliestStart: number | null = null;
        let latestEnd: number | null = null;
        let totalTasks = 0;
        let doneTasks = 0;
        let blockedTasks = 0;

        for (const task of itemTasks) {
            totalTasks += 1;
            if (task.status === "done") doneTasks += 1;
            if (task.status === "blocked") blockedTasks += 1;

            if (typeof task.durationHours === "number") {
                durationHours += task.durationHours;
            } else if (typeof task.estimatedDuration === "number") {
                durationHours += task.estimatedDuration / 3600000;
            } else if (typeof task.estimatedMinutes === "number") {
                durationHours += task.estimatedMinutes / 60;
            }

            const start = parseTime(task.plannedStart ?? task.startDate ?? null);
            const end = parseTime(task.plannedEnd ?? task.endDate ?? null);

            if (start !== null) {
                earliestStart = earliestStart === null ? start : Math.min(earliestStart, start);
            }
            if (end !== null) {
                latestEnd = latestEnd === null ? end : Math.max(latestEnd, end);
            }
        }

        for (const child of childRollups) {
            durationHours += safeNumber(child.schedule?.durationHours ?? 0);
            totalTasks += safeNumber(child.tasks?.total ?? 0);
            doneTasks += safeNumber(child.tasks?.done ?? 0);
            blockedTasks += safeNumber(child.tasks?.blocked ?? 0);

            const childStart = parseTime(child.schedule?.plannedStart ?? null);
            const childEnd = parseTime(child.schedule?.plannedEnd ?? null);
            if (childStart !== null) {
                earliestStart = earliestStart === null ? childStart : Math.min(earliestStart, childStart);
            }
            if (childEnd !== null) {
                latestEnd = latestEnd === null ? childEnd : Math.max(latestEnd, childEnd);
            }
        }

        const progressPct = totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0;

        const rollup = {
            cost: {
                ...costTotals,
            },
            schedule: {
                durationHours,
                plannedStart: earliestStart ? new Date(earliestStart).toISOString() : undefined,
                plannedEnd: latestEnd ? new Date(latestEnd).toISOString() : undefined,
                progressPct,
                blocked: blockedTasks > 0,
            },
            tasks: {
                total: totalTasks,
                done: doneTasks,
                blocked: blockedTasks,
            },
        };

        rollups.set(item._id, rollup);
        return rollup;
    }

    for (const item of items) {
        if (itemIdsFilter && !itemIdsFilter.has(item._id)) {
            continue;
        }
        const rollup = computeForItem(item);
        await ctx.db.patch(item._id, { rollups: rollup, updatedAt: Date.now() });
    }
}
