import { mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { normalizeSnapshot } from "./lib/elementSnapshots";
import type { ElementSnapshot } from "./lib/zodSchemas";
import { parseItemSpec } from "./lib/itemHelpers";
import { api } from "./_generated/api";

function stableHash(input: unknown) {
    const text = JSON.stringify(input ?? "");
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
        hash = (hash * 33) ^ text.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
}

function buildEmptySnapshot(): ElementSnapshot {
    return {
        schemaVersion: "element-snapshot/v1",
        descriptions: { short: "", long: "" },
        freeText: {
            preferences: "",
            risks: "",
            openQuestions: "",
            installation: "",
            building: "",
            constraints: "",
            notes: "",
        },
        materials: [],
        labor: [],
        tasks: [],
        tombstones: { taskKeys: [], materialKeys: [], laborKeys: [] },
    };
}

function makeKey(prefix: "tsk" | "mat" | "lab", seed: string, used: Set<string>) {
    let counter = 0;
    while (true) {
        const hash = stableHash(counter === 0 ? seed : `${seed}:${counter}`).slice(0, 8);
        const key = `${prefix}_${hash}`;
        if (!used.has(key)) {
            used.add(key);
            return key;
        }
        counter += 1;
    }
}

function flattenSubtasks(
    subtasks: Array<{
        id: string;
        title: string;
        description?: string;
        estMinutes?: number | null;
        children?: unknown[];
    }>,
): Array<{
    id: string;
    title: string;
    description?: string;
    estMinutes?: number | null;
}> {
    const out: Array<{
        id: string;
        title: string;
        description?: string;
        estMinutes?: number | null;
    }> = [];
    for (const task of subtasks) {
        out.push({
            id: task.id,
            title: task.title,
            description: task.description,
            estMinutes: task.estMinutes,
        });
        const children = Array.isArray(task.children) ? task.children : [];
        for (const child of children) {
            if (!child || typeof child !== "object") continue;
            const cast = child as {
                id: string;
                title: string;
                description?: string;
                estMinutes?: number | null;
                children?: unknown[];
            };
            out.push(...flattenSubtasks([cast]));
        }
    }
    return out;
}

function toTaskType(task: Doc<"tasks">, hasMaterialLink: boolean) {
    if (task.accountingLineType === "material" || hasMaterialLink) {
        return "purchase_material";
    }
    if (task.category === "Logistics") return "transport";
    if (task.category === "Admin") return "admin";
    if (task.category === "Studio") return "build";
    return "normal";
}

function sumCosts(values: Array<{ qty?: number; unitCost?: number; totalCost?: number }>) {
    return values.reduce((total, entry) => {
        if (typeof entry.totalCost === "number") return total + entry.totalCost;
        const qty = entry.qty ?? 0;
        const unitCost = entry.unitCost ?? 0;
        return total + qty * unitCost;
    }, 0);
}

export const migrateToElementPipeline = mutation({
    args: { projectId: v.optional(v.id("projects")) },
    handler: async (ctx, args) => {
        const projects = args.projectId
            ? [await ctx.db.get(args.projectId)]
            : await ctx.db.query("projects").collect();

        const stats = {
            elements: 0,
            elementVersions: 0,
            projectVersions: 0,
            tasksUpdated: 0,
            materialsUpdated: 0,
            workUpdated: 0,
            accountingUpdated: 0,
        };

        for (const project of projects) {
            if (!project) continue;
            const items = await ctx.db
                .query("projectItems")
                .withIndex("by_project_status", (q) => q.eq("projectId", project._id))
                .collect();

            const publishedIds: Id<"elementVersions">[] = [];

            for (const item of items) {
                if (!item.elementStatus) {
                    const elementStatus = item.status === "approved" || item.status === "in_progress" || item.status === "done"
                        ? "active"
                        : "suggested";
                    await ctx.db.patch(item._id, { elementStatus, updatedAt: Date.now() });
                    stats.elements += 1;
                }

                if (!item.publishedVersionId) {
                    const data = {
                        meta: {
                            title: item.title,
                            typeKey: item.typeKey,
                        },
                    };
                    const freeText = {};
                    const versionId = await ctx.db.insert("elementVersions", {
                        projectId: project._id,
                        elementId: item._id,
                        createdAt: Date.now(),
                        createdBy: "migration",
                        basedOnVersionId: undefined,
                        appliedFactIds: [],
                        data,
                        freeText,
                        hashes: {
                            dataHash: stableHash(data),
                            freeTextHashByBucket: {},
                        },
                        diffSummaryHe: "???? ????",
                    });
                    await ctx.db.patch(item._id, { publishedVersionId: versionId, updatedAt: Date.now() });
                    publishedIds.push(versionId);
                    stats.elementVersions += 1;
                } else {
                    publishedIds.push(item.publishedVersionId);
                }
            }

            if (publishedIds.length > 0) {
                await ctx.db.insert("projectVersions", {
                    projectId: project._id,
                    createdAt: Date.now(),
                    createdBy: "migration",
                    publishedElementVersionIds: publishedIds,
                    noteHe: "???? ????",
                    hash: stableHash(publishedIds),
                });
                stats.projectVersions += 1;
            }

            const tasks = await ctx.db
                .query("tasks")
                .withIndex("by_project", (q) => q.eq("projectId", project._id))
                .collect();
            for (const task of tasks) {
                if (!task.generation) {
                    await ctx.db.patch(task._id, { generation: "manual", lock: true });
                    stats.tasksUpdated += 1;
                }
            }

            const materials = await ctx.db
                .query("materialLines")
                .withIndex("by_project", (q) => q.eq("projectId", project._id))
                .collect();
            for (const line of materials) {
                if (!line.generation) {
                    await ctx.db.patch(line._id, { generation: "manual", lock: true });
                    stats.materialsUpdated += 1;
                }
            }

            const workLines = await ctx.db
                .query("workLines")
                .withIndex("by_project", (q) => q.eq("projectId", project._id))
                .collect();
            for (const line of workLines) {
                if (!line.generation) {
                    await ctx.db.patch(line._id, { generation: "manual", lock: true });
                    stats.workUpdated += 1;
                }
            }

            const accountingLines = await ctx.db
                .query("accountingLines")
                .withIndex("by_project", (q) => q.eq("projectId", project._id))
                .collect();
            for (const line of accountingLines) {
                if (!line.generation) {
                    await ctx.db.patch(line._id, { generation: "manual", lock: true });
                    stats.accountingUpdated += 1;
                }
            }
        }

        return stats;
    },
});

export const backfillElementSnapshots = mutation({
    args: {
        projectId: v.optional(v.id("projects")),
        dryRun: v.optional(v.boolean()),
        applyProjections: v.optional(v.boolean()),
        force: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const projects = args.projectId
            ? [await ctx.db.get(args.projectId)]
            : await ctx.db.query("projects").collect();

        const stats = {
            projects: 0,
            elementsVisited: 0,
            versionsCreated: 0,
            skippedExisting: 0,
            projectionsRebuilt: 0,
            reports: [] as Array<{
                projectId: Id<"projects">;
                elementId: Id<"projectItems">;
                title: string;
                legacyMaterialTotal: number;
                legacyLaborTotal: number;
                snapshotMaterialTotal: number;
                snapshotLaborTotal: number;
            }>,
        };

        const dryRun = args.dryRun ?? false;
        const applyProjections = args.applyProjections ?? false;
        const force = args.force ?? false;

        for (const project of projects) {
            if (!project) continue;
            stats.projects += 1;

            const items = await ctx.db
                .query("projectItems")
                .withIndex("by_project_status", (q) => q.eq("projectId", project._id))
                .collect();

            for (const item of items) {
                stats.elementsVisited += 1;
                const activeVersionId = item.activeVersionId ?? item.publishedVersionId;
                if (activeVersionId) {
                    const existingVersion = await ctx.db.get(activeVersionId);
                    if (existingVersion?.snapshot && !force) {
                        stats.skippedExisting += 1;
                        continue;
                    }
                }

                const [tasks, materialLines, workLines, revisions] = await Promise.all([
                    ctx.db
                        .query("tasks")
                        .withIndex("by_project_item", (q) => q.eq("projectId", item.projectId).eq("itemId", item._id))
                        .collect(),
                    ctx.db
                        .query("materialLines")
                        .withIndex("by_project_item", (q) => q.eq("projectId", item.projectId).eq("itemId", item._id))
                        .collect(),
                    ctx.db
                        .query("workLines")
                        .withIndex("by_project_item", (q) => q.eq("projectId", item.projectId).eq("itemId", item._id))
                        .collect(),
                    ctx.db
                        .query("itemRevisions")
                        .withIndex("by_item_revision", (q) => q.eq("itemId", item._id))
                        .collect(),
                ]);

                let snapshot = buildEmptySnapshot();
                snapshot.descriptions.short = item.description ?? "";
                snapshot.descriptions.long = "";

                const approvedRevision = item.approvedRevisionId
                    ? revisions.find((rev) => rev._id === item.approvedRevisionId)
                    : null;
                const latestRevision = revisions
                    .slice()
                    .sort((a, b) => b.revisionNumber - a.revisionNumber)[0];
                const baseSpec = approvedRevision?.data ?? latestRevision?.data ?? null;
                let spec = null;
                if (baseSpec) {
                    try {
                        spec = parseItemSpec(baseSpec);
                    } catch {
                        spec = null;
                    }
                }

                if (spec) {
                    snapshot.descriptions.short = spec.identity.description ?? snapshot.descriptions.short;
                    snapshot.descriptions.long = spec.studioWork?.buildPlanMarkdown ?? "";
                    snapshot.freeText.preferences = spec.quality?.notes ?? "";
                    snapshot.freeText.openQuestions = spec.state.openQuestions.join("\n");
                    snapshot.freeText.constraints = spec.state.assumptions.join("\n");
                    snapshot.freeText.risks = spec.state.decisions.join("\n");
                }

                const usedKeys = new Set<string>();
                const materialKeyByLineId = new Map<string, string>();
                const laborKeyByLineId = new Map<string, string>();

                const useMaterialLines = materialLines.length > 0;
                const useWorkLines = workLines.length > 0;
                const useTasks = tasks.length > 0;

                if (useMaterialLines) {
                    snapshot.materials = materialLines.map((line) => {
                        const key = makeKey("mat", String(line._id), usedKeys);
                        materialKeyByLineId.set(String(line._id), key);
                        return {
                            materialKey: key,
                            name: line.label ?? "Material",
                            spec: line.note ?? "",
                            qty: line.plannedQuantity ?? 0,
                            unit: line.unit ?? "unit",
                            unitCost: line.plannedUnitCost ?? undefined,
                            totalCost: undefined,
                            bucketKey: line.category ?? "general",
                            needPurchase: line.status ? line.status !== "in_stock" : true,
                            vendorRef: line.vendorName ?? undefined,
                            notes: line.note ?? undefined,
                        };
                    });
                } else if (spec?.breakdown?.materials?.length) {
                    snapshot.materials = spec.breakdown.materials.map((material) => {
                        const key = makeKey("mat", material.id, usedKeys);
                        return {
                            materialKey: key,
                            name: material.label,
                            spec: material.description ?? "",
                            qty: material.qty ?? 0,
                            unit: material.unit ?? "unit",
                            unitCost: material.unitCostEstimate ?? undefined,
                            totalCost: undefined,
                            bucketKey: material.category ?? "general",
                            needPurchase: material.procurement ? material.procurement !== "in_stock" : true,
                            vendorRef: material.vendorName ?? undefined,
                            notes: material.note ?? undefined,
                        };
                    });
                }

                if (useWorkLines) {
                    snapshot.labor = workLines.map((line) => {
                        const key = makeKey("lab", String(line._id), usedKeys);
                        laborKeyByLineId.set(String(line._id), key);
                        return {
                            laborKey: key,
                            role: line.role ?? "Labor",
                            qty: line.plannedQuantity ?? 0,
                            unit: line.rateType ?? "hour",
                            rate: line.plannedUnitCost ?? 0,
                            bucketKey: line.workType ?? "general",
                            notes: line.description ?? undefined,
                        };
                    });
                } else if (spec?.breakdown?.labor?.length) {
                    snapshot.labor = spec.breakdown.labor.map((labor) => {
                        const key = makeKey("lab", labor.id, usedKeys);
                        return {
                            laborKey: key,
                            role: labor.role,
                            qty: labor.quantity ?? 0,
                            unit: labor.rateType ?? "hour",
                            rate: labor.unitCost ?? 0,
                            bucketKey: labor.workType ?? "general",
                            notes: labor.description ?? undefined,
                        };
                    });
                }

                if (useTasks) {
                    const taskKeyById = new Map<string, string>();
                    for (const task of tasks) {
                        const key = makeKey("tsk", String(task._id), usedKeys);
                        taskKeyById.set(String(task._id), key);
                    }

                    snapshot.tasks = tasks.map((task) => {
                        const materialKey = task.accountingLineId
                            ? materialKeyByLineId.get(String(task.accountingLineId))
                            : undefined;
                        const laborKey = task.accountingLineId
                            ? laborKeyByLineId.get(String(task.accountingLineId))
                            : undefined;
                        const hasMaterialLink = Boolean(materialKey);
                        const taskType = toTaskType(task, hasMaterialLink);
                        const dependencies = (task.dependencies ?? [])
                            .map((depId) => taskKeyById.get(String(depId)))
                            .filter((dep): dep is string => Boolean(dep));
                        return {
                            taskKey: taskKeyById.get(String(task._id)) as string,
                            title: task.title,
                            details: task.description ?? "",
                            bucketKey: task.category ?? "general",
                            taskType,
                            estimate: task.estimatedMinutes
                                ? `${task.estimatedMinutes}m`
                                : task.durationHours
                                    ? `${task.durationHours}h`
                                    : undefined,
                            dependencies,
                            usesMaterialKeys: materialKey ? [materialKey] : [],
                            usesLaborKeys: laborKey ? [laborKey] : [],
                            materialKey: taskType === "purchase_material" ? materialKey : undefined,
                        };
                    });
                } else if (spec?.breakdown?.subtasks?.length) {
                    const flattened = flattenSubtasks(spec.breakdown.subtasks);
                    snapshot.tasks = flattened.map((task) => {
                        const key = makeKey("tsk", task.id, usedKeys);
                        return {
                            taskKey: key,
                            title: task.title,
                            details: task.description ?? "",
                            bucketKey: "general",
                            taskType: "normal",
                            estimate: task.estMinutes ? `${task.estMinutes}m` : undefined,
                            dependencies: [],
                            usesMaterialKeys: [],
                            usesLaborKeys: [],
                            materialKey: undefined,
                        };
                    });
                }

                snapshot = normalizeSnapshot(snapshot);

                const legacyMaterialTotal = materialLines.reduce((total, line) => {
                    const qty = line.plannedQuantity ?? 0;
                    const unitCost = line.plannedUnitCost ?? 0;
                    return total + qty * unitCost;
                }, 0);
                const legacyLaborTotal = workLines.reduce((total, line) => {
                    const qty = line.plannedQuantity ?? 0;
                    const unitCost = line.plannedUnitCost ?? 0;
                    return total + qty * unitCost;
                }, 0);
                const snapshotMaterialTotal = sumCosts(snapshot.materials.map((line) => ({
                    qty: line.qty,
                    unitCost: line.unitCost,
                    totalCost: line.totalCost,
                })));
                const snapshotLaborTotal = sumCosts(snapshot.labor.map((line) => ({
                    qty: line.qty,
                    unitCost: line.rate,
                    totalCost: undefined,
                })));

                stats.reports.push({
                    projectId: project._id,
                    elementId: item._id,
                    title: item.title,
                    legacyMaterialTotal,
                    legacyLaborTotal,
                    snapshotMaterialTotal,
                    snapshotLaborTotal,
                });

                if (dryRun) {
                    continue;
                }

                const now = Date.now();
                const versionId = await ctx.db.insert("elementVersions", {
                    projectId: project._id,
                    elementId: item._id,
                    createdAt: now,
                    createdBy: "migration",
                    basedOnVersionId: activeVersionId ?? undefined,
                    createdFrom: {
                        tab: "migration",
                        source: "backfill",
                    },
                    tags: ["migration", "backfill"],
                    summary: "Backfilled snapshot from legacy data",
                    snapshot,
                });

                await ctx.db.patch(item._id, {
                    activeVersionId: versionId,
                    publishedVersionId: item.publishedVersionId ?? versionId,
                    elementStatus: item.elementStatus ?? "active",
                    updatedAt: now,
                });

                stats.versionsCreated += 1;

                if (applyProjections) {
                    await ctx.runMutation(api.projections.rebuildElement, { elementId: item._id });
                    stats.projectionsRebuilt += 1;
                }
            }
        }

        return stats;
    },
});
