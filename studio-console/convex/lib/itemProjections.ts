import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ItemSpecV2 } from "./zodSchemas";

type ProjectionArgs = {
    item: Doc<"projectItems">;
    revision: Doc<"itemRevisions">;
    spec: ItemSpecV2;
    force?: boolean;
};

type ProjectionResult = {
    skipped: boolean;
    sectionId?: Id<"sections">;
    materialsSynced?: number;
    laborSynced?: number;
    tasksSynced?: number;
};

type TaskStatus = Doc<"tasks">["status"];

function normalizeKey(value: string) {
    return value.trim().toLowerCase();
}

function toTaskStatus(value?: string): TaskStatus | undefined {
    if (!value) return undefined;
    if (value === "todo" || value === "in_progress" || value === "blocked" || value === "done") {
        return value;
    }
    return undefined;
}

function flattenSubtasks(
    subtasks: ItemSpecV2["breakdown"]["subtasks"],
    results: Array<ItemSpecV2["breakdown"]["subtasks"][number]> = [],
) {
    for (const subtask of subtasks) {
        results.push(subtask);
        if (subtask.children && subtask.children.length > 0) {
            flattenSubtasks(subtask.children, results);
        }
    }
    return results;
}

async function ensureSectionForItem(ctx: MutationCtx, args: ProjectionArgs): Promise<Id<"sections">> {
    const sections = await ctx.db
        .query("sections")
        .withIndex("by_project", (q) => q.eq("projectId", args.item.projectId))
        .collect();

    const existing = sections.find((section) => section.itemId === args.item._id) ?? null;
    const group = args.spec.identity.accountingGroup ?? args.item.typeKey;
    const name = args.spec.identity.title;
    const description = args.spec.identity.description;

    if (existing) {
        await ctx.db.patch(existing._id, {
            itemId: args.item._id,
            group,
            name,
            description: description ?? existing.description,
        });
        return existing._id;
    }

    const maxSortOrder = sections.reduce((max, section) => Math.max(max, section.sortOrder), 0);
    const sortOrder = args.item.sortOrder ?? maxSortOrder + 1;

    return await ctx.db.insert("sections", {
        projectId: args.item.projectId,
        itemId: args.item._id,
        group,
        name,
        description,
        sortOrder,
        pricingMode: "estimated",
    });
}

async function syncMaterialsToMaterialLines(
    ctx: MutationCtx,
    args: ProjectionArgs,
    sectionId: Id<"sections">,
): Promise<number> {
    const allLines = await ctx.db
        .query("materialLines")
        .withIndex("by_project", (q) => q.eq("projectId", args.item.projectId))
        .collect();

    const candidates = allLines.filter(
        (line) => line.sectionId === sectionId || line.itemId === args.item._id,
    );

    const byMaterialId = new Map<string, Doc<"materialLines">>();
    const byLabel = new Map<string, Doc<"materialLines">>();

    for (const line of candidates) {
        if (line.itemMaterialId) {
            byMaterialId.set(line.itemMaterialId, line);
        }
        if (line.itemId === args.item._id) {
            byLabel.set(normalizeKey(line.label), line);
        }
    }

    let synced = 0;
    for (const material of args.spec.breakdown.materials) {
        const itemMaterialId = material.id;
        const existing =
            byMaterialId.get(itemMaterialId) ??
            byLabel.get(normalizeKey(material.label));

        const patch: Partial<Doc<"materialLines">> = {
            itemId: args.item._id,
            itemMaterialId,
            sectionId,
        };

        if (material.category !== undefined) patch.category = material.category || "General";
        if (material.label !== undefined) patch.label = material.label;
        if (material.description !== undefined) patch.description = material.description;
        if (material.procurement !== undefined) patch.procurement = material.procurement;
        if (material.vendorName !== undefined) patch.vendorName = material.vendorName;
        if (material.unit !== undefined) patch.unit = material.unit || "unit";
        if (material.qty !== undefined) patch.plannedQuantity = material.qty;
        if (material.unitCostEstimate !== undefined) patch.plannedUnitCost = material.unitCostEstimate;
        if (material.status !== undefined) patch.status = material.status;
        if (material.note !== undefined) patch.note = material.note;
        patch.updatedAt = Date.now();

        if (existing) {
            await ctx.db.patch(existing._id, patch);
        } else {
            await ctx.db.insert("materialLines", {
                projectId: args.item.projectId,
                sectionId,
                itemId: args.item._id,
                itemMaterialId,
                category: material.category ?? "General",
                label: material.label,
                description: material.description,
                procurement: material.procurement ?? "either",
                vendorName: material.vendorName,
                unit: material.unit ?? "unit",
                plannedQuantity: material.qty ?? 1,
                plannedUnitCost: material.unitCostEstimate ?? 0,
                status: material.status ?? "planned",
                note: material.note,
                updatedAt: Date.now(),
            });
        }
        synced += 1;
    }

    return synced;
}

async function syncLaborToWorkLines(
    ctx: MutationCtx,
    args: ProjectionArgs,
    sectionId: Id<"sections">,
): Promise<number> {
    const allLines = await ctx.db
        .query("workLines")
        .withIndex("by_project", (q) => q.eq("projectId", args.item.projectId))
        .collect();

    const candidates = allLines.filter(
        (line) => line.sectionId === sectionId || line.itemId === args.item._id,
    );

    const byLaborId = new Map<string, Doc<"workLines">>();
    const byRole = new Map<string, Doc<"workLines">>();

    for (const line of candidates) {
        if (line.itemLaborId) {
            byLaborId.set(line.itemLaborId, line);
        }
        if (line.itemId === args.item._id) {
            const key = normalizeKey(`${line.workType}:${line.role}`);
            byRole.set(key, line);
        }
    }

    let synced = 0;
    for (const labor of args.spec.breakdown.labor) {
        const itemLaborId = labor.id;
        const roleKey = normalizeKey(`${labor.workType}:${labor.role}`);
        const existing = byLaborId.get(itemLaborId) ?? byRole.get(roleKey);

        const patch: Partial<Doc<"workLines">> = {
            itemId: args.item._id,
            itemLaborId,
            sectionId,
        };

        if (labor.workType !== undefined) patch.workType = labor.workType;
        if (labor.role !== undefined) patch.role = labor.role;
        if (labor.rateType !== undefined) patch.rateType = labor.rateType;
        if (labor.quantity !== undefined) patch.plannedQuantity = labor.quantity;
        if (labor.unitCost !== undefined) patch.plannedUnitCost = labor.unitCost;
        if (labor.description !== undefined) patch.description = labor.description;

        if (existing) {
            await ctx.db.patch(existing._id, patch);
        } else {
            await ctx.db.insert("workLines", {
                projectId: args.item.projectId,
                sectionId,
                itemId: args.item._id,
                itemLaborId,
                workType: labor.workType,
                role: labor.role,
                rateType: labor.rateType,
                plannedQuantity: labor.quantity ?? 1,
                plannedUnitCost: labor.unitCost ?? 0,
                status: "planned",
                description: labor.description,
            });
        }
        synced += 1;
    }

    return synced;
}

async function syncSubtasksToTasks(
    ctx: MutationCtx,
    args: ProjectionArgs,
): Promise<number> {
    const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", args.item.projectId))
        .collect();

    const bySubtaskId = new Map<string, Doc<"tasks">>();
    for (const task of tasks) {
        if (task.itemId === args.item._id && task.itemSubtaskId) {
            bySubtaskId.set(task.itemSubtaskId, task);
        }
    }

    let synced = 0;
    const flatSubtasks = flattenSubtasks(args.spec.breakdown.subtasks);
    for (const subtask of flatSubtasks) {
        const shouldCreate = subtask.taskProjection?.createTask ?? true;
        if (!shouldCreate) continue;

        const title = subtask.taskProjection?.titleOverride ?? subtask.title;
        const status = toTaskStatus(subtask.status);
        const existing = bySubtaskId.get(subtask.id) ?? null;

        if (existing) {
            const patch: Partial<Doc<"tasks">> = {
                itemId: args.item._id,
                itemSubtaskId: subtask.id,
                title,
                description: subtask.description ?? existing.description,
                estimatedMinutes: subtask.estMinutes ?? existing.estimatedMinutes,
            };

            if (status) {
                patch.status = status;
            }

            await ctx.db.patch(existing._id, {
                ...patch,
                updatedAt: Date.now(),
            });
        } else {
            await ctx.db.insert("tasks", {
                projectId: args.item.projectId,
                title,
                description: subtask.description,
                status: status ?? "todo",
                category: "Studio",
                priority: "Medium",
                itemId: args.item._id,
                itemSubtaskId: subtask.id,
                estimatedMinutes: subtask.estMinutes ?? undefined,
                source: "agent",
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        }
        synced += 1;
    }

    return synced;
}

export async function syncItemProjections(
    ctx: MutationCtx,
    args: ProjectionArgs,
): Promise<ProjectionResult> {
    const lock = await ctx.db
        .query("itemProjectionLocks")
        .withIndex("by_project_item", (q) => q.eq("projectId", args.item.projectId).eq("itemId", args.item._id))
        .unique();

    if (lock && lock.lastSyncedRevisionId === args.revision._id && !args.force) {
        return { skipped: true, sectionId: undefined };
    }

    const sectionId = await ensureSectionForItem(ctx, args);
    const materialsSynced = await syncMaterialsToMaterialLines(ctx, args, sectionId);
    const laborSynced = await syncLaborToWorkLines(ctx, args, sectionId);
    const tasksSynced = await syncSubtasksToTasks(ctx, args);

    const now = Date.now();
    if (lock) {
        await ctx.db.patch(lock._id, { lastSyncedRevisionId: args.revision._id, lastSyncedAt: now });
    } else {
        await ctx.db.insert("itemProjectionLocks", {
            projectId: args.item.projectId,
            itemId: args.item._id,
            lastSyncedRevisionId: args.revision._id,
            lastSyncedAt: now,
        });
    }

    return { skipped: false, sectionId, materialsSynced, laborSynced, tasksSynced };
}
