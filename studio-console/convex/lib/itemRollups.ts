import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { 
    getProjectPricingPolicy, 
    getEffectiveRoleRates, 
    calculateClientPrice 
} from "./pricing";

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

    // 1. Fetch Policy & Rates
    const [policy, roleRates] = await Promise.all([
        getProjectPricingPolicy(ctx, args.projectId),
        getEffectiveRoleRates(ctx, args.projectId)
    ]);

    // 2. Fetch all relevant data
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

    const materialLines = await ctx.db
        .query("materialLines")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();

    const accountingLines = await ctx.db
        .query("accountingLines")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();

    // 3. Index data by Item ID
    const tasksByItem = new Map<Id<"projectItems">, Doc<"tasks">[]>();
    for (const task of tasks) {
        if (!task.itemId) continue;
        const list = tasksByItem.get(task.itemId) ?? [];
        list.push(task);
        tasksByItem.set(task.itemId, list);
    }

    const materialsByItem = new Map<Id<"projectItems">, Doc<"materialLines">[]>();
    for (const line of materialLines) {
        if (!line.itemId) continue;
        const list = materialsByItem.get(line.itemId) ?? [];
        list.push(line);
        materialsByItem.set(line.itemId, list);
    }

    const legacyLinesByItem = new Map<Id<"projectItems">, Doc<"accountingLines">[]>();
    for (const line of accountingLines) {
        const list = legacyLinesByItem.get(line.itemId) ?? [];
        list.push(line);
        legacyLinesByItem.set(line.itemId, list);
    }

    const childrenByParent = new Map<Id<"projectItems"> | null, Doc<"projectItems">[]>();
    for (const item of items) {
        const parentId = item.parentItemId ?? null;
        const list = childrenByParent.get(parentId) ?? [];
        list.push(item);
        childrenByParent.set(parentId, list);
    }

    const rollups = new Map<Id<"projectItems">, NonNullable<Doc<"projectItems">["rollups"]>>();

    // 4. Compute Rollups (Recursive)
    function computeForItem(item: Doc<"projectItems">): NonNullable<Doc<"projectItems">["rollups"]> {
        if (rollups.has(item._id)) return rollups.get(item._id)!;

        // Children
        const childItems = childrenByParent.get(item._id) ?? [];
        const childRollups = childItems.map(computeForItem);

        // Own Data
        const itemTasks = tasksByItem.get(item._id) ?? [];
        const itemMaterials = materialsByItem.get(item._id) ?? [];
        const itemLegacy = legacyLinesByItem.get(item._id) ?? [];

        // Costs
        let materialCost = 0;
        let laborCost = 0;
        let miscCost = 0; // Legacy lines + others

        // A. Materials
        for (const line of itemMaterials) {
            const qty = line.actualQuantity ?? line.plannedQuantity ?? 0;
            const unitCost = line.actualUnitCost ?? line.plannedUnitCost ?? 0;
            materialCost += qty * unitCost;
        }

        // B. Labor (Tasks)
        for (const task of itemTasks) {
            // Default to true if undefined
            const include = task.costingPolicy?.includeInAccounting ?? true;
            if (!include) continue;

            // Determine effort in days
            let days = 0;
            // TODO: schema for task should have 'effortDays' explicitly per plan?
            // Currently using durationHours.
            if (typeof task.durationHours === "number") {
                days = task.durationHours / 8; // Assuming 8h day
            } else if (typeof task.estimatedDuration === "number") {
                days = task.estimatedDuration / 3600000 / 8;
            } else if (typeof task.estimatedMinutes === "number") {
                days = task.estimatedMinutes / 60 / 8;
            }

            // Determine Rate
            // Task schema has 'role' field now.
            const roleName = task.role ?? "איש ארט"; // Default role if missing
            const rate = roleRates.get(roleName) ?? 800; // Look up rate, fallback to 800

            laborCost += days * rate;
        }

        // C. Legacy
        for (const line of itemLegacy) {
            const qty = line.quantity ?? 1;
            const cost = line.unitCost ?? 0;
            const amount = qty * cost;
            if (line.lineType === "material") materialCost += amount;
            else if (line.lineType === "labor") laborCost += amount;
            else miscCost += amount;
        }

        // Children Costs
        for (const child of childRollups) {
            const c = child.cost ?? {};
            materialCost += safeNumber(c.material);
            laborCost += safeNumber(c.labor);
            miscCost += safeNumber(c.misc) + safeNumber(c.rentals) + safeNumber(c.purchases) + safeNumber(c.shipping);
        }

        const baseCost = materialCost + laborCost + miscCost;
        const sellPrice = calculateClientPrice(baseCost, policy);

        // Schedule
        let durationHours = 0;
        let earliestStart: number | null = null;
        let latestEnd: number | null = null;
        let totalTasks = 0;
        let doneTasks = 0;
        let blockedTasks = 0;

        for (const task of itemTasks) {
            totalTasks++;
            if (task.status === "done") doneTasks++;
            if (task.status === "blocked") blockedTasks++;

            if (typeof task.durationHours === "number") durationHours += task.durationHours;
            
            const start = parseTime(task.plannedStart ?? task.startDate ?? null);
            const end = parseTime(task.plannedEnd ?? task.endDate ?? null);
            if (start !== null) earliestStart = earliestStart === null ? start : Math.min(earliestStart, start);
            if (end !== null) latestEnd = latestEnd === null ? end : Math.max(latestEnd, end);
        }

        for (const child of childRollups) {
            durationHours += safeNumber(child.schedule?.durationHours);
            totalTasks += safeNumber(child.tasks?.total);
            doneTasks += safeNumber(child.tasks?.done);
            blockedTasks += safeNumber(child.tasks?.blocked);
        }

        const progressPct = totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0;

        const rollup: NonNullable<Doc<"projectItems">["rollups"]> = {
            cost: {
                material: materialCost,
                labor: laborCost,
                misc: miscCost,
                totalCost: baseCost,
                sellPrice: sellPrice,
                margin: sellPrice - baseCost,
                currency: policy.currency,
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

    // 5. Save updates
    for (const item of items) {
        if (itemIdsFilter && !itemIdsFilter.has(item._id)) continue;
        const rollup = computeForItem(item);
        await ctx.db.patch(item._id, { rollups: rollup, updatedAt: Date.now() });
    }
}