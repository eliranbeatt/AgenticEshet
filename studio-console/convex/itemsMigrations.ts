import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { ItemSpecV2Schema, type ItemSpecV2 } from "./lib/zodSchemas";
import type { Doc, Id } from "./_generated/dataModel";
import { recomputeRollups } from "./lib/itemRollups";

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

function mapTypeKeyToCategory(typeKey: string) {
    const normalized = typeKey.trim().toLowerCase();
    const mapping: Record<string, string> = {
        build: "set_piece",
        carpentry: "set_piece",
        scenic: "set_piece",
        print: "print",
        graphics: "print",
        floor: "floor",
        prop: "prop",
        rental: "rental",
        purchase: "purchase",
        transport: "transport",
        moving: "transport",
        install: "installation",
        studio: "studio_production",
        management: "management",
        producer: "management",
    };
    return mapping[normalized] ?? "other";
}

function buildSearchText(name?: string, description?: string, typeKey?: string) {
    return `${name ?? ""}\n${description ?? ""}${typeKey ? `\n${typeKey}` : ""}`.trim();
}

function mapSpecToItemFields(spec: ItemSpecV2) {
    const flags = {
        requiresPurchase: spec.procurement?.required ?? undefined,
        purchaseMode: spec.procurement?.channel ?? undefined,
        requiresStudio: spec.studioWork?.required ?? undefined,
        requiresMoving: spec.logistics?.transportRequired ?? undefined,
        requiresInstallation: spec.onsite?.installDays ? spec.onsite.installDays > 0 : undefined,
        requiresDismantle: spec.onsite?.teardownDays ? spec.onsite.teardownDays > 0 : undefined,
    };

    const scope = {
        assumptions: spec.state?.assumptions,
        constraints: spec.state?.openQuestions,
    };

    const quoteDefaults = {
        includeByDefault: spec.quote?.includeInQuote,
        displayName: spec.quote?.clientTextOverride,
    };

    return { flags, scope, quoteDefaults };
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
                parentItemId: null,
                sortKey: String(section.sortOrder ?? now),
                title: section.name,
                typeKey: section.group,
                name: section.name,
                category: section.group,
                kind: "deliverable",
                description: section.description,
                searchText: `${section.name}\n${section.description ?? ""}\n${section.group}`.trim(),
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

export const proposeFromConceptCardsForProject = internalMutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const cards = await ctx.db
            .query("ideationConceptCards")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .collect();

        if (cards.length === 0) {
            return { projectId: args.projectId, created: 0, skipped: 0 };
        }

        const existingItems: Doc<"projectItems">[] = [];
        for (const status of ["draft", "approved", "archived"] as const) {
            const batch = await ctx.db
                .query("projectItems")
                .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", status))
                .collect();
            existingItems.push(...batch);
        }

        const usedCardIds = new Set(
            existingItems
                .filter((item) => item.createdFrom.source === "ideationCard" && item.createdFrom.sourceId)
                .map((item) => item.createdFrom.sourceId as string),
        );

        let created = 0;
        let skipped = 0;
        const now = Date.now();

        for (const card of cards) {
            if (usedCardIds.has(card._id)) {
                skipped += 1;
                continue;
            }

            const spec = ItemSpecV2Schema.parse({
                version: "ItemSpecV2",
                identity: {
                    title: card.title,
                    typeKey: "concept",
                    description: card.detailsMarkdown,
                },
                breakdown: { subtasks: [], materials: [], labor: [] },
                state: { openQuestions: [], assumptions: [], decisions: [] },
                quote: { includeInQuote: true },
            });

            const itemId = await ctx.db.insert("projectItems", {
                projectId: args.projectId,
                parentItemId: null,
                sortKey: String(now),
                title: card.title,
                typeKey: "concept",
                name: card.title,
                category: "concept",
                kind: "deliverable",
                description: card.detailsMarkdown,
                searchText: `${card.title}\n${card.detailsMarkdown}\nconcept`.trim(),
                status: "draft",
                createdFrom: { source: "ideationCard", sourceId: card._id },
                latestRevisionNumber: 1,
                createdAt: now,
                updatedAt: now,
            });

            await ctx.db.insert("itemRevisions", {
                projectId: args.projectId,
                itemId,
                tabScope: "ideation",
                state: "proposed",
                revisionNumber: 1,
                data: spec,
                summaryMarkdown: "Proposed from ideation concept card.",
                createdBy: { kind: "agent" },
                createdAt: now,
            });

            created += 1;
        }

        return { projectId: args.projectId, created, skipped };
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

export const proposeFromConceptCards = action({
    args: { projectId: v.optional(v.id("projects")) },
    handler: async (ctx, args) => {
        const projectIds = args.projectId
            ? [args.projectId]
            : await ctx.runQuery(internal.itemsMigrations.listProjectIds, {});

        const results = [];
        for (const projectId of projectIds) {
            const result = await ctx.runMutation(
                internal.itemsMigrations.proposeFromConceptCardsForProject,
                { projectId },
            );
            results.push(result);
        }

        return results;
    },
});

export const backfillProjectOverview = internalMutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");

        if (project.overview) {
            return { projectId: args.projectId, updated: false };
        }

        const overview = {
            projectType: project.projectTypes?.[0] ?? "other",
            properties: {
                requiresStudioProduction: false,
                requiresPurchases: [],
                requiresRentals: false,
                requiresMoving: false,
                requiresInstallation: false,
                requiresDismantle: false,
                includesShootDay: false,
                includesManagementFee: false,
            },
            constraints: {
                budgetRange: {
                    max: project.details?.budgetCap,
                    currency: project.currency ?? "ILS",
                },
                dates: {
                    install: project.details?.eventDate,
                },
                location: project.details?.location,
                qualityTier: project.budgetTier ?? undefined,
            },
        };

        await ctx.db.patch(args.projectId, { overview });
        return { projectId: args.projectId, updated: true };
    },
});

export const ensureRoots = internalMutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");

        if (project.rootItemId) {
            return { projectId: args.projectId, rootItemId: project.rootItemId, created: false };
        }

        const now = Date.now();
        const rootItemId = await ctx.db.insert("projectItems", {
            projectId: args.projectId,
            parentItemId: null,
            sortKey: String(now),
            kind: "group",
            category: "other",
            name: "Project Scope",
            title: "Project Scope",
            typeKey: "scope",
            description: "Root scope group.",
            searchText: buildSearchText("Project Scope", "Root scope group.", "scope"),
            status: "approved",
            createdFrom: { source: "manual" },
            latestRevisionNumber: 1,
            createdAt: now,
            updatedAt: now,
        });

        await ctx.db.patch(args.projectId, { rootItemId });
        return { projectId: args.projectId, rootItemId, created: true };
    },
});

export const buildTree = internalMutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const rootResult = await ctx.db.get(args.projectId);
        if (!rootResult) throw new Error("Project not found");

        const project = rootResult;
        let rootItemId = project.rootItemId;
        if (!rootItemId) {
            const created = await ctx.runMutation(internal.itemsMigrations.ensureRoots, { projectId: args.projectId });
            rootItemId = created.rootItemId;
        }

        const items: Doc<"projectItems">[] = [];
        for (const status of ["draft", "proposed", "approved", "in_progress", "done", "blocked", "cancelled", "archived"] as const) {
            const batch = await ctx.db
                .query("projectItems")
                .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", status))
                .collect();
            items.push(...batch);
        }

        let patched = 0;
        for (const item of items) {
            if (item._id === rootItemId) continue;
            if (item.parentItemId) continue;

            await ctx.db.patch(item._id, {
                parentItemId: rootItemId,
                sortKey: item.sortKey ?? String(item.sortOrder ?? item.createdAt ?? Date.now()),
                updatedAt: Date.now(),
            });
            patched += 1;
        }

        return { projectId: args.projectId, rootItemId, patched };
    },
});

export const mapLegacySpecs = internalMutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const items: Doc<"projectItems">[] = [];
        for (const status of ["draft", "proposed", "approved", "in_progress", "done", "blocked", "cancelled", "archived"] as const) {
            const batch = await ctx.db
                .query("projectItems")
                .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", status))
                .collect();
            items.push(...batch);
        }

        let patched = 0;
        for (const item of items) {
            if (!item.approvedRevisionId) continue;
            const revision = await ctx.db.get(item.approvedRevisionId);
            if (!revision) continue;

            const parsed = ItemSpecV2Schema.safeParse(revision.data);
            if (!parsed.success) continue;

            const spec = parsed.data;
            const mapped = mapSpecToItemFields(spec);
            const name = item.name ?? spec.identity.title ?? item.title;
            const category = item.category ?? mapTypeKeyToCategory(spec.identity.typeKey ?? item.typeKey);
            const description = item.description ?? spec.identity.description;

            await ctx.db.patch(item._id, {
                name,
                category,
                kind: item.kind ?? "deliverable",
                description,
                flags: mapped.flags,
                scope: mapped.scope,
                quoteDefaults: mapped.quoteDefaults,
                searchText: buildSearchText(name, description, item.typeKey),
                updatedAt: Date.now(),
            });
            patched += 1;
        }

        return { projectId: args.projectId, patched };
    },
});

export const linkAccounting = internalMutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const sections = await ctx.db
            .query("sections")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const sectionItemMap = new Map<Id<"sections">, Id<"projectItems">>();
        for (const section of sections) {
            if (section.itemId) sectionItemMap.set(section._id, section.itemId);
        }

        const materials = await ctx.db
            .query("materialLines")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const workLines = await ctx.db
            .query("workLines")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        let materialLinked = 0;
        for (const line of materials) {
            if (line.itemId) continue;
            const itemId = sectionItemMap.get(line.sectionId);
            if (!itemId) continue;
            await ctx.db.patch(line._id, { itemId });
            materialLinked += 1;
        }

        let workLinked = 0;
        for (const line of workLines) {
            if (line.itemId) continue;
            const itemId = sectionItemMap.get(line.sectionId);
            if (!itemId) continue;
            await ctx.db.patch(line._id, { itemId });
            workLinked += 1;
        }

        return { projectId: args.projectId, materialLinked, workLinked };
    },
});

export const createAccountingLines = internalMutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const [materials, workLines] = await Promise.all([
            ctx.db
                .query("materialLines")
                .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
                .collect(),
            ctx.db
                .query("workLines")
                .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
                .collect(),
        ]);

        let created = 0;
        const now = Date.now();

        for (const line of materials) {
            if (!line.itemId) continue;
            await ctx.db.insert("accountingLines", {
                projectId: args.projectId,
                itemId: line.itemId,
                taskId: line.taskId,
                lineType: "material",
                title: line.label,
                notes: line.description,
                quantity: line.plannedQuantity,
                unit: line.unit,
                unitCost: line.plannedUnitCost,
                currency: "ILS",
                taxable: false,
                vatRate: line.taxRate ?? 0,
                vendorNameFreeText: line.vendorName,
                purchaseStatus: line.status as Doc<"accountingLines">["purchaseStatus"],
                createdAt: now,
                updatedAt: now,
            });
            created += 1;
        }

        for (const line of workLines) {
            if (!line.itemId) continue;
            await ctx.db.insert("accountingLines", {
                projectId: args.projectId,
                itemId: line.itemId,
                taskId: line.taskId,
                lineType: "labor",
                title: line.role,
                notes: line.description,
                quantity: line.plannedQuantity,
                unit: line.rateType,
                unitCost: line.plannedUnitCost,
                currency: "ILS",
                taxable: false,
                vatRate: 0,
                createdAt: now,
                updatedAt: now,
            });
            created += 1;
        }

        return { projectId: args.projectId, created };
    },
});

export const recomputeRollupsForProject = internalMutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        await recomputeRollups(ctx, { projectId: args.projectId });
        return { projectId: args.projectId, recomputed: true };
    },
});

export const verifyProject = internalMutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const items: Doc<"projectItems">[] = [];
        for (const status of ["draft", "proposed", "approved", "in_progress", "done", "blocked", "cancelled", "archived"] as const) {
            const batch = await ctx.db
                .query("projectItems")
                .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", status))
                .collect();
            items.push(...batch);
        }

        const roots = items.filter((item) => item.parentItemId === null);
        const tasks = await ctx.db
            .query("tasks")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const tasksWithoutItem = tasks.filter((task) => !task.itemId).length;
        const itemsWithoutParent = items.filter((item) => item.parentItemId === undefined).length;

        return {
            projectId: args.projectId,
            rootCount: roots.length,
            tasksWithoutItem,
            itemsWithoutParent,
        };
    },
});

export const runItemsV3Migrations = action({
    args: { projectId: v.optional(v.id("projects")) },
    handler: async (ctx, args) => {
        const projectIds = args.projectId
            ? [args.projectId]
            : await ctx.runQuery(internal.itemsMigrations.listProjectIds, {});

        const results = [];
        for (const projectId of projectIds) {
            const overview = await ctx.runMutation(internal.itemsMigrations.backfillProjectOverview, { projectId });
            const root = await ctx.runMutation(internal.itemsMigrations.ensureRoots, { projectId });
            const tree = await ctx.runMutation(internal.itemsMigrations.buildTree, { projectId });
            const mapped = await ctx.runMutation(internal.itemsMigrations.mapLegacySpecs, { projectId });
            const linked = await ctx.runMutation(internal.itemsMigrations.linkTasksForProject, { projectId });
            const accountingLinked = await ctx.runMutation(internal.itemsMigrations.linkAccounting, { projectId });
            const accountingLines = await ctx.runMutation(internal.itemsMigrations.createAccountingLines, { projectId });
            const rollups = await ctx.runMutation(internal.itemsMigrations.recomputeRollupsForProject, { projectId });
            const verify = await ctx.runMutation(internal.itemsMigrations.verifyProject, { projectId });
            results.push({
                projectId,
                overview,
                root,
                tree,
                mapped,
                linked,
                accountingLinked,
                accountingLines,
                rollups,
                verify,
            });
        }

        return results;
    },
});
