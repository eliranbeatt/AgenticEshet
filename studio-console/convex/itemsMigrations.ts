import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { ItemSpecV2Schema, type ItemSpecV2 } from "./lib/zodSchemas";
import type { Doc, Id } from "./_generated/dataModel";

function normalizeRateType(rateType: string): "hour" | "day" | "flat" {
    if (rateType === "hour" || rateType === "day" || rateType === "flat") {
        return rateType;
    }
    return "hour";
}

function normalizeTitle(value: string) {
    return value.trim().toLowerCase();
}

function ensureMaterialId(line: Doc<"materialLines">) {
    return line.itemMaterialId ?? line._id;
}

function ensureLaborId(line: Doc<"workLines">) {
    return line.itemLaborId ?? line._id;
}

function buildMaterialSpec(line: Doc<"materialLines">) {
    return {
        id: ensureMaterialId(line),
        category: line.category,
        label: line.label,
        description: line.description,
        qty: line.plannedQuantity,
        unit: line.unit,
        unitCostEstimate: line.plannedUnitCost,
        vendorName: line.vendorName,
        procurement: line.procurement,
        status: line.status,
        note: line.note,
    };
}

function buildLaborSpec(line: Doc<"workLines">) {
    return {
        id: ensureLaborId(line),
        workType: line.workType,
        role: line.role,
        rateType: normalizeRateType(line.rateType),
        quantity: line.plannedQuantity,
        unitCost: line.plannedUnitCost,
        description: line.description,
    };
}

function collectSubtaskTitles(
    subtasks: ItemSpecV2["breakdown"]["subtasks"],
    titleMap: Map<string, string>
) {
    for (const subtask of subtasks) {
        const key = normalizeTitle(subtask.title);
        if (key && !titleMap.has(key)) {
            titleMap.set(key, subtask.id);
        }
        if (Array.isArray(subtask.children) && subtask.children.length > 0) {
            collectSubtaskTitles(subtask.children, titleMap);
        }
    }
}

function buildSubtaskTitleMap(spec: ItemSpecV2) {
    const titleMap = new Map<string, string>();
    collectSubtaskTitles(spec.breakdown.subtasks, titleMap);
    return titleMap;
}

export const listProjectIds = internalQuery({
    args: {},
    handler: async (ctx) => {
        const projects = await ctx.db.query("projects").collect();
        return projects.map((project) => project._id);
    },
});

export const backfillProjectFromAccounting = internalMutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const [sections, materials, workLines] = await Promise.all([
            ctx.db
                .query("sections")
                .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
                .collect(),
            ctx.db
                .query("materialLines")
                .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
                .collect(),
            ctx.db
                .query("workLines")
                .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
                .collect(),
        ]);

        const materialsBySection = new Map<Id<"sections">, Doc<"materialLines">[]>();
        const workBySection = new Map<Id<"sections">, Doc<"workLines">[]>();

        for (const material of materials) {
            const list = materialsBySection.get(material.sectionId) ?? [];
            list.push(material);
            materialsBySection.set(material.sectionId, list);
        }

        for (const workLine of workLines) {
            const list = workBySection.get(workLine.sectionId) ?? [];
            list.push(workLine);
            workBySection.set(workLine.sectionId, list);
        }

        let itemsCreated = 0;
        let sectionsSkipped = 0;
        let materialLinks = 0;
        let workLinks = 0;
        const now = Date.now();

        for (const section of sections) {
            if (section.itemId) {
                sectionsSkipped += 1;
                continue;
            }

            const sectionMaterials = materialsBySection.get(section._id) ?? [];
            const sectionWork = workBySection.get(section._id) ?? [];

            const spec = ItemSpecV2Schema.parse({
                version: "ItemSpecV2",
                identity: {
                    title: section.name,
                    typeKey: section.group,
                    description: section.description,
                    accountingGroup: section.group,
                },
                breakdown: {
                    subtasks: [],
                    materials: sectionMaterials.map((line) => buildMaterialSpec(line)),
                    labor: sectionWork.map((line) => buildLaborSpec(line)),
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

            const itemId = await ctx.db.insert("projectItems", {
                projectId: args.projectId,
                title: section.name,
                typeKey: section.group,
                status: "approved",
                sortOrder: section.sortOrder,
                createdFrom: { source: "accountingBackfill", sourceId: String(section._id) },
                latestRevisionNumber: 1,
                createdAt: now,
                updatedAt: now,
            });

            const revisionId = await ctx.db.insert("itemRevisions", {
                projectId: args.projectId,
                itemId,
                tabScope: "accounting",
                state: "approved",
                revisionNumber: 1,
                data: spec,
                summaryMarkdown: "Backfilled from accounting section.",
                createdBy: { kind: "agent" },
                createdAt: now,
            });

            await ctx.db.patch(itemId, {
                approvedRevisionId: revisionId,
                status: "approved",
                updatedAt: now,
            });

            await ctx.db.patch(section._id, { itemId });

            for (const material of sectionMaterials) {
                const itemMaterialId = ensureMaterialId(material);
                if (material.itemId !== itemId || material.itemMaterialId !== itemMaterialId) {
                    await ctx.db.patch(material._id, {
                        itemId,
                        itemMaterialId,
                    });
                    materialLinks += 1;
                }
            }

            for (const workLine of sectionWork) {
                const itemLaborId = ensureLaborId(workLine);
                if (workLine.itemId !== itemId || workLine.itemLaborId !== itemLaborId) {
                    await ctx.db.patch(workLine._id, {
                        itemId,
                        itemLaborId,
                    });
                    workLinks += 1;
                }
            }

            itemsCreated += 1;
        }

        return {
            projectId: args.projectId,
            sectionsProcessed: sections.length,
            itemsCreated,
            sectionsSkipped,
            materialLinks,
            workLinks,
        };
    },
});

export const linkTasksForProject = internalMutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const [sections, materials, workLines, tasks] = await Promise.all([
            ctx.db
                .query("sections")
                .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
                .collect(),
            ctx.db
                .query("materialLines")
                .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
                .collect(),
            ctx.db
                .query("workLines")
                .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
                .collect(),
            ctx.db
                .query("tasks")
                .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
                .collect(),
        ]);

        const sectionItemMap = new Map<Id<"sections">, Id<"projectItems">>();
        for (const section of sections) {
            if (section.itemId) {
                sectionItemMap.set(section._id, section.itemId);
            }
        }

        const lineItemMap = new Map<string, Id<"projectItems">>();
        for (const material of materials) {
            const itemId = material.itemId ?? sectionItemMap.get(material.sectionId);
            if (itemId) {
                lineItemMap.set(material._id, itemId);
            }
        }
        for (const workLine of workLines) {
            const itemId = workLine.itemId ?? sectionItemMap.get(workLine.sectionId);
            if (itemId) {
                lineItemMap.set(workLine._id, itemId);
            }
        }

        const itemIds = new Set<Id<"projectItems">>();
        for (const itemId of sectionItemMap.values()) itemIds.add(itemId);
        for (const itemId of lineItemMap.values()) itemIds.add(itemId);
        for (const task of tasks) {
            if (task.itemId) itemIds.add(task.itemId);
        }

        const subtaskMaps = new Map<Id<"projectItems">, Map<string, string>>();
        for (const itemId of itemIds) {
            const item = await ctx.db.get(itemId);
            if (!item?.approvedRevisionId) continue;

            const revision = await ctx.db.get(item.approvedRevisionId);
            if (!revision) continue;

            const parsed = ItemSpecV2Schema.safeParse(revision.data);
            if (!parsed.success) continue;

            const titleMap = buildSubtaskTitleMap(parsed.data);
            if (titleMap.size > 0) {
                subtaskMaps.set(itemId, titleMap);
            }
        }

        let tasksUpdated = 0;
        let itemsLinked = 0;
        let subtasksLinked = 0;
        let tasksSkipped = 0;
        let tasksAlreadyLinked = 0;

        for (const task of tasks) {
            let itemId = task.itemId ?? null;

            if (!itemId && task.accountingLineId) {
                const linkedItemId = lineItemMap.get(task.accountingLineId);
                if (linkedItemId) {
                    itemId = linkedItemId;
                }
            }

            if (!itemId && task.accountingSectionId) {
                const sectionItemId = sectionItemMap.get(task.accountingSectionId);
                if (sectionItemId) {
                    itemId = sectionItemId;
                }
            }

            if (!itemId) {
                tasksSkipped += 1;
                continue;
            }

            const patch: Partial<Doc<"tasks">> = {};

            if (!task.itemId) {
                patch.itemId = itemId;
            }

            if (!task.itemSubtaskId) {
                const titleMap = subtaskMaps.get(itemId);
                const match = titleMap?.get(normalizeTitle(task.title));
                if (match) {
                    patch.itemSubtaskId = match;
                }
            }

            if (Object.keys(patch).length > 0) {
                patch.updatedAt = Date.now();
                await ctx.db.patch(task._id, patch);
                tasksUpdated += 1;
                if (patch.itemId) itemsLinked += 1;
                if (patch.itemSubtaskId) subtasksLinked += 1;
            } else {
                tasksAlreadyLinked += 1;
            }
        }

        return {
            projectId: args.projectId,
            tasksUpdated,
            itemsLinked,
            subtasksLinked,
            tasksSkipped,
            tasksAlreadyLinked,
        };
    },
});

export const backfillFromAccounting = action({
    args: { projectId: v.optional(v.id("projects")) },
    handler: async (ctx, args) => {
        const projectIds = args.projectId
            ? [args.projectId]
            : await ctx.runQuery(internal.itemsMigrations.listProjectIds, {});

        const results = [];
        for (const projectId of projectIds) {
            const result = await ctx.runMutation(
                internal.itemsMigrations.backfillProjectFromAccounting,
                { projectId }
            );
            results.push(result);
        }

        return results;
    },
});

export const linkTasksToItems = action({
    args: { projectId: v.optional(v.id("projects")) },
    handler: async (ctx, args) => {
        const projectIds = args.projectId
            ? [args.projectId]
            : await ctx.runQuery(internal.itemsMigrations.listProjectIds, {});

        const results = [];
        for (const projectId of projectIds) {
            const result = await ctx.runMutation(internal.itemsMigrations.linkTasksForProject, {
                projectId,
            });
            results.push(result);
        }

        return results;
    },
});
