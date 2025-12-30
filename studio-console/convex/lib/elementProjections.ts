import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ElementSnapshot } from "./zodSchemas";

type RebuildResult = {
    sectionId: Id<"sections">;
    tasks: number;
    materials: number;
    labor: number;
};

async function ensureSectionForElement(
    ctx: MutationCtx,
    element: Doc<"projectItems">,
    snapshot: ElementSnapshot,
): Promise<Id<"sections">> {
    const sections = await ctx.db
        .query("sections")
        .withIndex("by_project", (q) => q.eq("projectId", element.projectId))
        .collect();

    const existing = sections.find((section) => section.itemId === element._id) ?? null;
    const group = element.typeKey;
    const name = snapshot.descriptions.short || element.title;
    const description = snapshot.descriptions.long || element.description;

    if (existing) {
        await ctx.db.patch(existing._id, {
            itemId: element._id,
            group,
            name,
            description: description ?? existing.description,
        });
        return existing._id;
    }

    const maxSortOrder = sections.reduce((max, section) => Math.max(max, section.sortOrder), 0);
    const sortOrder = element.sortOrder ?? maxSortOrder + 1;

    return await ctx.db.insert("sections", {
        projectId: element.projectId,
        itemId: element._id,
        group,
        name,
        description,
        sortOrder,
        pricingMode: "estimated",
    });
}

async function clearGeneratedForElement(ctx: MutationCtx, element: Doc<"projectItems">) {
    const [tasks, materialLines, workLines] = await Promise.all([
        ctx.db.query("tasks").withIndex("by_project_item", (q) =>
            q.eq("projectId", element.projectId).eq("itemId", element._id)
        ).collect(),
        ctx.db.query("materialLines").withIndex("by_project_item", (q) =>
            q.eq("projectId", element.projectId).eq("itemId", element._id)
        ).collect(),
        ctx.db.query("workLines").withIndex("by_project_item", (q) =>
            q.eq("projectId", element.projectId).eq("itemId", element._id)
        ).collect(),
    ]);

    for (const task of tasks) {
        const isLocked = task.lock ?? false;
        const generation = task.generation ?? "generated";
        if (isLocked || generation === "manual") continue;
        await ctx.db.delete(task._id);
    }

    for (const line of materialLines) {
        const isLocked = line.lock ?? false;
        const generation = line.generation ?? "generated";
        if (isLocked || generation === "manual") continue;
        await ctx.db.delete(line._id);
    }

    for (const line of workLines) {
        const isLocked = line.lock ?? false;
        const generation = line.generation ?? "generated";
        if (isLocked || generation === "manual") continue;
        await ctx.db.delete(line._id);
    }
}

function parseEstimateToHours(estimate?: string) {
    if (!estimate) return undefined;
    const normalized = estimate.trim().toLowerCase();
    const value = Number.parseFloat(normalized);
    if (!Number.isFinite(value)) return undefined;
    if (normalized.includes("day") || normalized.endsWith("d")) return value * 8;
    return value;
}

export async function rebuildElementProjections(ctx: MutationCtx, args: {
    element: Doc<"projectItems">;
    snapshot: ElementSnapshot;
    elementVersionId: Id<"elementVersions">;
}): Promise<RebuildResult> {
    const { element, snapshot, elementVersionId } = args;
    const sectionId = await ensureSectionForElement(ctx, element, snapshot);

    await clearGeneratedForElement(ctx, element);

    const derivationRunId = await ctx.db.insert("derivationRuns", {
        projectId: element.projectId,
        triggerType: "elementVersion",
        triggerId: elementVersionId,
        mode: "replace",
        status: "applied",
        changeSet: { elementId: element._id },
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });

    const derivedFrom = { elementVersionId, derivationRunId };

    let materials = 0;
    const materialLineIdByKey = new Map<string, Id<"materialLines">>();
    for (const material of snapshot.materials) {
        const lineId = await ctx.db.insert("materialLines", {
            projectId: element.projectId,
            sectionId,
            itemId: element._id,
            itemMaterialId: material.materialKey,
            category: material.bucketKey,
            label: material.name,
            description: material.spec,
            procurement: material.needPurchase ? "local" : "in_stock",
            vendorName: material.vendorRef,
            unit: material.unit,
            plannedQuantity: material.qty,
            plannedUnitCost: material.unitCost ?? 0,
            status: "planned",
            note: material.notes,
            generation: "generated",
            lock: false,
            derivedFrom,
            updatedAt: Date.now(),
        });
        materialLineIdByKey.set(material.materialKey, lineId);
        materials += 1;
    }

    let labor = 0;
    for (const line of snapshot.labor) {
        await ctx.db.insert("workLines", {
            projectId: element.projectId,
            sectionId,
            itemId: element._id,
            itemLaborId: line.laborKey,
            workType: line.bucketKey,
            role: line.role,
            rateType: line.unit,
            plannedQuantity: line.qty,
            plannedUnitCost: line.rate,
            status: "planned",
            description: line.notes,
            generation: "generated",
            lock: false,
            derivedFrom,
        });
        labor += 1;
    }

    const taskIdByKey = new Map<string, Id<"tasks">>();
    for (const task of snapshot.tasks) {
        const durationHours = parseEstimateToHours(task.estimate);
        const taskId = await ctx.db.insert("tasks", {
            projectId: element.projectId,
            title: task.title,
            description: task.details,
            status: "todo",
            category: "Studio",
            priority: "Medium",
            itemId: element._id,
            itemSubtaskId: task.taskKey,
            durationHours,
            estimatedMinutes: durationHours ? Math.round(durationHours * 60) : undefined,
            source: "agent",
            generation: "generated",
            lock: false,
            derivedFrom,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        taskIdByKey.set(task.taskKey, taskId);
    }

    let tasks = 0;
    for (const task of snapshot.tasks) {
        const taskId = taskIdByKey.get(task.taskKey);
        if (!taskId) continue;
        const dependencies = task.dependencies
            .map((key) => taskIdByKey.get(key))
            .filter((id): id is Id<"tasks"> => Boolean(id));
        const materialLineId = task.materialKey ? materialLineIdByKey.get(task.materialKey) : undefined;
        await ctx.db.patch(taskId, {
            dependencies: dependencies.length ? dependencies : undefined,
            accountingLineType: materialLineId ? "material" : undefined,
            accountingLineId: materialLineId,
            updatedAt: Date.now(),
        });
        if (materialLineId) {
            await ctx.db.patch(materialLineId, { taskId });
        }
        tasks += 1;
    }

    return { sectionId, tasks, materials, labor };
}
