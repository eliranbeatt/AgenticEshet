import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ChangeSetSchema } from "./lib/zodSchemas";
import { ChangeSetSchema } from "./lib/zodSchemas";
import { recomputeRollups } from "./lib/itemRollups";
import { buildBaseItemSpec } from "./lib/itemHelpers";

function serializePayload(value: unknown) {
    return JSON.stringify(value ?? null);
}

function buildSearchText(args: { name?: string; description?: string; category?: string }) {
    const name = args.name ?? "";
    const description = args.description ?? "";
    const category = args.category ? `\n${args.category}` : "";
    return `${name}\n${description}${category}`.trim();
}

function resolveItemRef(
    ref: { itemId?: string | null; itemTempId?: string | null } | undefined,
    tempItemMap: Map<string, Id<"projectItems">>,
) {
    if (!ref) return undefined;
    if (ref.itemId) return ref.itemId as Id<"projectItems">;
    if (ref.itemTempId) {
        const resolved = tempItemMap.get(ref.itemTempId);
        // if (!resolved) throw new Error(`Missing item for tempId ${ref.itemTempId}`); 
        // Allow returning undefined if not found? No, should be strict if ref provided.
        if (!resolved) throw new Error(`Missing item for tempId ${ref.itemTempId}`);
        return resolved;
    }
    return undefined;
}

function resolveTaskRef(
    ref: { taskId?: string | null; taskTempId?: string | null } | undefined,
    tempTaskMap: Map<string, Id<"tasks">>,
) {
    if (!ref) return undefined;
    if (ref.taskId) return ref.taskId as Id<"tasks">;
    if (ref.taskTempId) {
        const resolved = tempTaskMap.get(ref.taskTempId);
        if (!resolved) throw new Error(`Missing task for tempId ${ref.taskTempId}`);
        return resolved;
    }
    return undefined;
}

export const listByProject = query({
    args: {
        projectId: v.id("projects"),
        phase: v.optional(v.union(
            v.literal("planning"),
            v.literal("solutioning"),
            v.literal("accounting"),
            v.literal("tasks"),
            v.literal("item_edit"),
            v.literal("convert"),
            v.literal("element_edit"),
            v.literal("procurement"),
            v.literal("runbook"),
            v.literal("closeout")
        )),
        status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"))),
    },
    handler: async (ctx, args) => {
        if (args.phase && args.status) {
            return await ctx.db
                .query("itemChangeSets")
                .withIndex("by_project_phase_status", (q) =>
                    q.eq("projectId", args.projectId).eq("phase", args.phase!).eq("status", args.status!)
                )
                .collect();
        }

        if (args.phase) {
            return await ctx.db
                .query("itemChangeSets")
                .withIndex("by_project_phase", (q) =>
                    q.eq("projectId", args.projectId).eq("phase", args.phase!)
                )
                .filter((q) => args.status ? q.eq(q.field("status"), args.status) : true)
                .collect();
        }

        return await ctx.db
            .query("itemChangeSets")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .filter((q) => {
                const phaseMatch = args.phase ? q.eq(q.field("phase"), args.phase) : true;
                const statusMatch = args.status ? q.eq(q.field("status"), args.status) : true;
                return q.and(phaseMatch, statusMatch);
            })
            .collect();
    },
});

export const getWithOps = query({
    args: { changeSetId: v.id("itemChangeSets") },
    handler: async (ctx, args) => {
        const changeSet = await ctx.db.get(args.changeSetId);
        if (!changeSet) return null;

        const ops = await ctx.db
            .query("itemChangeSetOps")
            .withIndex("by_changeSet", (q) => q.eq("changeSetId", args.changeSetId))
            .collect();

        return { changeSet, ops };
    },
});

export const create = mutation({
    args: { changeSet: v.any() },
    handler: async (ctx, args) => {
        const parsed = ChangeSetSchema.safeParse(args.changeSet);
        if (!parsed.success) {
            console.error("Invalid ChangeSet", parsed.error.flatten());
            throw new Error("Invalid ChangeSet");
        }

        const changeSet = parsed.data;
        const now = Date.now();

        const itemOps = changeSet.items.create.length + changeSet.items.patch.length + changeSet.items.deleteRequest.length;
        const taskOps = changeSet.tasks.create.length + changeSet.tasks.patch.length;
        const accountingOps = changeSet.accountingLines.create.length + changeSet.accountingLines.patch.length;
        const dependencyOps = changeSet.tasks.dependencies.length;
        const materialOps = (changeSet.materialLines?.create.length ?? 0) + (changeSet.materialLines?.patch.length ?? 0) + (changeSet.materialLines?.deleteRequest.length ?? 0);

        const changeSetId = await ctx.db.insert("itemChangeSets", {
            projectId: changeSet.projectId as Id<"projects">,
            phase: changeSet.phase,
            agentName: changeSet.agentName,
            runId: undefined,
            ideaSelectionId: undefined,
            status: "pending",
            createdAt: now,
            title: changeSet.summary,
            warnings: changeSet.warnings,
            assumptions: changeSet.assumptions,
            openQuestions: changeSet.openQuestions,
            counts: {
                items: itemOps,
                tasks: taskOps,
                accountingLines: accountingOps,
                dependencies: dependencyOps,
                materialLines: materialOps,
            },
        });

        for (const payload of changeSet.items.create) {
            await ctx.db.insert("itemChangeSetOps", {
                projectId: changeSet.projectId as Id<"projects">,
                changeSetId,
                entityType: "item",
                opType: "create",
                tempId: payload.tempId,
                payloadJson: serializePayload(payload),
                createdAt: now,
            });
        }

        for (const payload of changeSet.items.patch) {
            await ctx.db.insert("itemChangeSetOps", {
                projectId: changeSet.projectId as Id<"projects">,
                changeSetId,
                entityType: "item",
                opType: "patch",
                targetId: payload.itemId,
                payloadJson: serializePayload(payload),
                createdAt: now,
            });
        }

        for (const payload of changeSet.items.deleteRequest) {
            await ctx.db.insert("itemChangeSetOps", {
                projectId: changeSet.projectId as Id<"projects">,
                changeSetId,
                entityType: "item",
                opType: "delete",
                targetId: payload.itemId,
                payloadJson: serializePayload(payload),
                createdAt: now,
            });
        }

        for (const payload of changeSet.tasks.create) {
            await ctx.db.insert("itemChangeSetOps", {
                projectId: changeSet.projectId as Id<"projects">,
                changeSetId,
                entityType: "task",
                opType: "create",
                tempId: payload.tempId,
                payloadJson: serializePayload(payload),
                createdAt: now,
            });
        }

        for (const payload of changeSet.tasks.patch) {
            await ctx.db.insert("itemChangeSetOps", {
                projectId: changeSet.projectId as Id<"projects">,
                changeSetId,
                entityType: "task",
                opType: "patch",
                targetId: payload.taskId,
                payloadJson: serializePayload(payload),
                createdAt: now,
            });
        }

        for (const payload of changeSet.tasks.dependencies) {
            await ctx.db.insert("itemChangeSetOps", {
                projectId: changeSet.projectId as Id<"projects">,
                changeSetId,
                entityType: "dependency",
                opType: "create",
                payloadJson: serializePayload(payload),
                createdAt: now,
            });
        }

        for (const payload of changeSet.accountingLines.create) {
            await ctx.db.insert("itemChangeSetOps", {
                projectId: changeSet.projectId as Id<"projects">,
                changeSetId,
                entityType: "accountingLine",
                opType: "create",
                tempId: payload.tempId,
                payloadJson: serializePayload(payload),
                createdAt: now,
            });
        }

        for (const payload of changeSet.accountingLines.patch) {
            await ctx.db.insert("itemChangeSetOps", {
                projectId: changeSet.projectId as Id<"projects">,
                changeSetId,
                entityType: "accountingLine",
                opType: "patch",
                targetId: payload.lineId,
                payloadJson: serializePayload(payload),
                createdAt: now,
            });
        }

        if (changeSet.materialLines) {
            for (const payload of changeSet.materialLines.create) {
                await ctx.db.insert("itemChangeSetOps", {
                    projectId: changeSet.projectId as Id<"projects">,
                    changeSetId,
                    entityType: "materialLine",
                    opType: "create",
                    tempId: payload.tempId,
                    payloadJson: serializePayload(payload),
                    createdAt: now,
                });
            }
            for (const payload of changeSet.materialLines.patch) {
                await ctx.db.insert("itemChangeSetOps", {
                    projectId: changeSet.projectId as Id<"projects">,
                    changeSetId,
                    entityType: "materialLine",
                    opType: "patch",
                    targetId: payload.lineId,
                    payloadJson: serializePayload(payload),
                    createdAt: now,
                });
            }
            for (const payload of changeSet.materialLines.deleteRequest) {
                await ctx.db.insert("itemChangeSetOps", {
                    projectId: changeSet.projectId as Id<"projects">,
                    changeSetId,
                    entityType: "materialLine",
                    opType: "delete",
                    targetId: payload.lineId,
                    payloadJson: serializePayload(payload),
                    createdAt: now,
                });
            }
        }

        return { changeSetId };
    },
});

export const setIdeaSelection = mutation({
    args: {
        changeSetId: v.id("itemChangeSets"),
        ideaSelectionId: v.id("ideaSelections"),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.changeSetId, {
            ideaSelectionId: args.ideaSelectionId,
        });
    },
});

export const createFromAgentOutput = action({
    args: { agentOutput: v.any() },
    handler: async (ctx, args) => {
        const parsed = ChangeSetSchema.safeParse(args.agentOutput);
        if (!parsed.success) {
            console.error("Invalid ChangeSet", parsed.error.flatten());
            throw new Error("Invalid ChangeSet");
        }

        return await ctx.runMutation(api.changeSets.create, { changeSet: parsed.data });
    },
});

export const apply = mutation({
    args: { changeSetId: v.id("itemChangeSets"), decidedBy: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const changeSet = await ctx.db.get(args.changeSetId);
        if (!changeSet) throw new Error("ChangeSet not found");
        if (changeSet.status !== "pending") throw new Error("ChangeSet already decided");

        const ops = await ctx.db
            .query("itemChangeSetOps")
            .withIndex("by_changeSet", (q) => q.eq("changeSetId", args.changeSetId))
            .collect();

        const tempItemMap = new Map<string, Id<"projectItems">>();
        const tempTaskMap = new Map<string, Id<"tasks">>();

        const now = Date.now();

        const itemCreateOps = ops.filter((op) => op.entityType === "item" && op.opType === "create");
        for (const op of itemCreateOps) {
            const payload = JSON.parse(op.payloadJson) as {
                tempId: string;
                parentTempId?: string | null;
                parentItemId?: string | null;
                sortKey: string;
                kind: string;
                category: string;
                name: string;
                description?: string;
                flags?: Record<string, unknown>;
                scope?: Record<string, unknown>;
                quoteDefaults?: Record<string, unknown>;
                templateId?: string;
                templateVersion?: number;
            };

            const parentItemId = payload.parentItemId
                ? (payload.parentItemId as Id<"projectItems">)
                : payload.parentTempId
                    ? tempItemMap.get(payload.parentTempId) ?? null
                    : null;

            // Fetch template Early if needed
            let template: any = null;
            if (payload.templateId) {
                if (payload.templateVersion) {
                    template = await ctx.db.query("templateDefinitions")
                        .withIndex("by_templateId_version", q => q.eq("templateId", payload.templateId!).eq("version", payload.templateVersion!))
                        .first();
                } else {
                    const templates = await ctx.db.query("templateDefinitions")
                        .withIndex("by_templateId_version", q => q.eq("templateId", payload.templateId!))
                        .collect();
                    template = templates.sort((a: any, b: any) => b.version - a.version)[0];
                }
            }

            const itemId = await ctx.db.insert("projectItems", {
                projectId: changeSet.projectId,
                parentItemId,
                sortKey: payload.sortKey,
                kind: payload.kind,
                category: payload.category,
                name: payload.name,
                title: payload.name,
                typeKey: payload.category,
                description: payload.description || (template?.quotePattern || undefined),
                flags: payload.flags,
                scope: payload.scope,
                quoteDefaults: payload.quoteDefaults,
                searchText: buildSearchText({
                    name: payload.name,
                    description: payload.description,
                    category: payload.category,
                }),
                status: "approved",
                createdFrom: payload.templateId ? { source: "template", sourceId: payload.templateId } : { source: "agent", sourceId: changeSet._id },
                latestRevisionNumber: 1,
                createdAt: now,
                updatedAt: now,
            });

            // Initialize Spec
            const spec = buildBaseItemSpec(payload.name, payload.category, payload.description || template?.quotePattern);

            // Expand Template Tasks
            if (template && template.tasks) {
                for (const t of template.tasks) {
                    const taskId = await ctx.db.insert("tasks", {
                        projectId: changeSet.projectId,
                        itemId,
                        title: t.title,
                        category: t.category as any,
                        durationHours: t.effortDays ? t.effortDays * 8 : undefined,
                        status: "todo",
                        priority: "Medium",
                        tags: ["template"],
                        source: "user",
                        description: `Role: ${t.role}, Effort: ${t.effortDays}d`,
                        origin: {
                            source: "template",
                            templateId: template.templateId,
                            version: template.version,
                        },
                        createdAt: now,
                        updatedAt: now,
                    });

                    // Add to spec
                    spec.breakdown.subtasks.push({
                        id: String(taskId),
                        title: t.title,
                        description: `Role: ${t.role}`,
                        estMinutes: t.effortDays ? t.effortDays * 8 * 60 : undefined,
                        status: "todo",
                    });

                    if (t.role) {
                        spec.breakdown.labor.push({
                            id: `labor_${taskId}`,
                            workType: t.category || "Studio",
                            role: t.role,
                            rateType: "day",
                            quantity: t.effortDays || 0,
                            description: `Linked to task: ${t.title}`
                        });
                    }
                }
            }

            // Expand Template Materials
            if (template && template.materials) {
                let section = await ctx.db.query("sections").withIndex("by_project", q => q.eq("projectId", changeSet.projectId)).first();
                if (!section) {
                    const sectionId = await ctx.db.insert("sections", {
                        projectId: changeSet.projectId,
                        group: "Logistics",
                        name: "General",
                        sortOrder: 0,
                        pricingMode: "estimated"
                    });
                    section = await ctx.db.get(sectionId);
                }

                if (section) {
                    for (const m of template.materials) {
                        const materialId = await ctx.db.insert("materialLines", {
                            projectId: changeSet.projectId,
                            sectionId: section._id,
                            itemId,
                            category: "Materials",
                            label: m.name,
                            unit: m.unit || "unit",
                            plannedQuantity: m.qty || 1,
                            plannedUnitCost: 0,
                            status: "planned",
                            origin: {
                                source: "template",
                                templateId: template.templateId,
                                version: template.version
                            }
                        });

                        // Add to spec
                        spec.breakdown.materials.push({
                            id: String(materialId),
                            label: m.name,
                            qty: m.qty || 1,
                            unit: m.unit || "unit",
                            category: "Materials",
                        });
                    }
                }
            }

            await ctx.db.insert("itemRevisions", {
                projectId: changeSet.projectId,
                itemId,
                tabScope: "planning",
                phase: changeSet.phase,
                source: "agent",
                agentName: changeSet.agentName,
                runId: changeSet.runId ?? undefined,
                revisionType: "snapshot",
                snapshotJson: serializePayload(spec),
                changeSetId: changeSet._id,
                revisionNumber: 1,
                state: "approved",
                data: spec,
                createdBy: { kind: "agent" },
                createdAt: now,
            });

            tempItemMap.set(payload.tempId, itemId);
        }

        const itemPatchOps = ops.filter((op) => op.entityType === "item" && op.opType === "patch");
        for (const op of itemPatchOps) {
            const payload = JSON.parse(op.payloadJson) as { itemId: string; patch: Record<string, unknown> };
            const itemId = payload.itemId as Id<"projectItems">;
            const item = await ctx.db.get(itemId);
            if (!item) continue;

            const name = (payload.patch.name as string | undefined) ?? item.name ?? item.title;
            const description = (payload.patch.description as string | undefined) ?? item.description;
            const category = (payload.patch.category as string | undefined) ?? item.category ?? item.typeKey;

            await ctx.db.patch(itemId, {
                ...payload.patch,
                title: payload.patch.name ?? item.title,
                typeKey: payload.patch.category ?? item.typeKey,
                searchText: buildSearchText({ name, description, category }),
                updatedAt: now,
            });

            await ctx.db.insert("itemRevisions", {
                projectId: changeSet.projectId,
                itemId,
                tabScope: "planning",
                phase: changeSet.phase,
                source: "agent",
                agentName: changeSet.agentName,
                runId: changeSet.runId ?? undefined,
                revisionType: "patch",
                patchJson: op.payloadJson,
                changeSetId: changeSet._id,
                revisionNumber: (item.latestRevisionNumber ?? 0) + 1,
                state: "approved",
                data: payload,
                createdBy: { kind: "agent" },
                createdAt: now,
            });

            await ctx.db.patch(itemId, {
                latestRevisionNumber: (item.latestRevisionNumber ?? 0) + 1,
                updatedAt: now,
            });
        }

        const itemDeleteOps = ops.filter((op) => op.entityType === "item" && op.opType === "delete");
        for (const op of itemDeleteOps) {
            const payload = JSON.parse(op.payloadJson) as { itemId: string };
            await ctx.db.patch(payload.itemId as Id<"projectItems">, {
                deleteRequestedAt: now,
                deleteRequestedBy: changeSet.agentName,
                deletedAt: undefined,
                updatedAt: now,
            });
        }

        const taskCreateOps = ops.filter((op) => op.entityType === "task" && op.opType === "create");
        for (const op of taskCreateOps) {
            const payload = JSON.parse(op.payloadJson) as {
                tempId: string;
                itemRef: { itemId?: string | null; itemTempId?: string | null };
                parentTaskTempId?: string | null;
                title: string;
                description?: string;
                workstream?: string;
                isManagement?: boolean;
                durationHours: number;
                status: Doc<"tasks">["status"];
                category?: string;
                priority?: string;
                tags: string[];
                plannedStart?: string | null;
                plannedEnd?: string | null;
            };

            const itemId = resolveItemRef(payload.itemRef, tempItemMap);
            const parentTaskId = payload.parentTaskTempId
                ? tempTaskMap.get(payload.parentTaskTempId)
                : null;

            const taskId = await ctx.db.insert("tasks", {
                projectId: changeSet.projectId,
                itemId,
                parentTaskId: parentTaskId ?? undefined,
                title: payload.title,
                description: payload.description,
                workstream: payload.workstream,
                isManagement: payload.isManagement,
                status: payload.status ?? "todo",
                category: (payload.category as any) ?? "Studio",
                priority: (payload.priority as any) ?? "Medium",
                durationHours: payload.durationHours,
                plannedStart: payload.plannedStart === null ? undefined : payload.plannedStart,
                plannedEnd: payload.plannedEnd === null ? undefined : payload.plannedEnd,
                tags: payload.tags,
                source: "agent",
                origin: { source: "ai" },
                createdAt: now,
                updatedAt: now,
            });

            tempTaskMap.set(payload.tempId, taskId);
        }

        const taskPatchOps = ops.filter((op) => op.entityType === "task" && op.opType === "patch");
        for (const op of taskPatchOps) {
            const payload = JSON.parse(op.payloadJson) as { taskId: string; patch: Record<string, unknown> };
            await ctx.db.patch(payload.taskId as Id<"tasks">, {
                ...payload.patch,
                updatedAt: now,
            });
        }

        const accountingCreateOps = ops.filter((op) => op.entityType === "accountingLine" && op.opType === "create");
        for (const op of accountingCreateOps) {
            const payload = JSON.parse(op.payloadJson) as {
                tempId: string;
                itemRef: { itemId?: string | null; itemTempId?: string | null };
                taskRef: { taskId?: string | null; taskTempId?: string | null };
                lineType: string;
                title: string;
                notes?: string;
                workstream?: string;
                isManagement?: boolean;
                quoteVisibility?: string;
                quantity?: number;
                unit?: string;
                unitCost?: number;
                currency: string;
                taxable: boolean;
                vatRate: number;
                vendorNameFreeText?: string;
                leadTimeDays?: number;
                purchaseStatus?: string;
            };

            const itemId = resolveItemRef(payload.itemRef, tempItemMap);
            const taskId = payload.taskRef ? resolveTaskRef(payload.taskRef, tempTaskMap) : undefined;

            await ctx.db.insert("accountingLines", {
                projectId: changeSet.projectId,
                itemId: itemId as Id<"projectItems">, // Force cast as itemId is mandatory for accountingLines? Schema says v.id("projectItems")
                taskId,
                lineType: payload.lineType as Doc<"accountingLines">["lineType"],
                title: payload.title,
                notes: payload.notes,
                workstream: payload.workstream,
                isManagement: payload.isManagement,
                quoteVisibility: payload.quoteVisibility as Doc<"accountingLines">["quoteVisibility"],
                quantity: payload.quantity,
                unit: payload.unit,
                unitCost: payload.unitCost,
                currency: payload.currency,
                taxable: payload.taxable,
                vatRate: payload.vatRate,
                vendorNameFreeText: payload.vendorNameFreeText,
                leadTimeDays: payload.leadTimeDays,
                purchaseStatus: payload.purchaseStatus as Doc<"accountingLines">["purchaseStatus"],
                createdAt: now,
                updatedAt: now,
            });
        }

        const accountingPatchOps = ops.filter((op) => op.entityType === "accountingLine" && op.opType === "patch");
        for (const op of accountingPatchOps) {
            const payload = JSON.parse(op.payloadJson) as { lineId: string; patch: Record<string, unknown> };
            await ctx.db.patch(payload.lineId as Id<"accountingLines">, {
                ...payload.patch,
                updatedAt: now,
            });
        }

        // Material Lines Logic
        const materialCreateOps = ops.filter((op) => op.entityType === "materialLine" && op.opType === "create");
        let defaultSectionId: Id<"sections"> | undefined;

        if (materialCreateOps.length > 0) {
            // Check for existing section or create one
            const firstSection = await ctx.db.query("sections")
                .withIndex("by_project", q => q.eq("projectId", changeSet.projectId))
                .first();

            if (firstSection) {
                defaultSectionId = firstSection._id;
            } else {
                defaultSectionId = await ctx.db.insert("sections", {
                    projectId: changeSet.projectId,
                    group: "Logistics",
                    name: "General",
                    sortOrder: 0,
                    pricingMode: "estimated"
                });
            }
        }

        for (const op of materialCreateOps) {
            const payload = JSON.parse(op.payloadJson) as {
                tempId: string;
                itemRef?: { itemId?: string | null; itemTempId?: string | null };
                taskRef?: { taskId?: string | null; taskTempId?: string | null };
                category: string;
                label: string;
                description?: string;
                unit: string;
                plannedQuantity: number;
                plannedUnitCost: number;
                procurement?: string;
                supplierName?: string;
            };

            const itemId = resolveItemRef(payload.itemRef, tempItemMap);
            const taskId = resolveTaskRef(payload.taskRef, tempTaskMap);

            await ctx.db.insert("materialLines", {
                projectId: changeSet.projectId,
                sectionId: defaultSectionId!, // Guaranteed by block above
                itemId,
                taskId,
                category: payload.category,
                label: payload.label,
                description: payload.description,
                unit: payload.unit,
                plannedQuantity: payload.plannedQuantity,
                plannedUnitCost: payload.plannedUnitCost,
                status: "planned",
                vendorName: payload.supplierName,
                procurement: payload.procurement as any,
                origin: { source: "ai" },
            });
        }

        const materialPatchOps = ops.filter((op) => op.entityType === "materialLine" && op.opType === "patch");
        for (const op of materialPatchOps) {
            const payload = JSON.parse(op.payloadJson) as { lineId: string; patch: Record<string, unknown> };
            await ctx.db.patch(payload.lineId as Id<"materialLines">, {
                ...payload.patch,
                // updatedAt: now, // field not in materialLines schema? It is optional.
            });
        }

        const materialDeleteOps = ops.filter((op) => op.entityType === "materialLine" && op.opType === "delete");
        for (const op of materialDeleteOps) {
            const payload = JSON.parse(op.payloadJson) as { lineId: string };
            await ctx.db.delete(payload.lineId as Id<"materialLines">);
        }

        const dependencyOps = ops.filter((op) => op.entityType === "dependency");
        for (const op of dependencyOps) {
            const payload = JSON.parse(op.payloadJson) as {
                fromTaskRef: { taskId?: string | null; taskTempId?: string | null };
                toTaskRef: { taskId?: string | null; taskTempId?: string | null };
                type: string;
                lagHours: number;
            };
            const fromTaskId = resolveTaskRef(payload.fromTaskRef, tempTaskMap);
            const toTaskId = resolveTaskRef(payload.toTaskRef, tempTaskMap);

            const targetTask = await ctx.db.get(toTaskId!); // resolveTaskRef returns undefined if null? 
            if (!targetTask) continue;
            const dependencies = targetTask.dependencies ?? [];
            if (fromTaskId && !dependencies.includes(fromTaskId)) {
                await ctx.db.patch(toTaskId!, {
                    dependencies: [...dependencies, fromTaskId],
                    updatedAt: now,
                });
            }
        }

        await ctx.db.patch(changeSet._id, {
            status: "approved",
            decidedAt: now,
            decidedBy: args.decidedBy,
        });

        await recomputeRollups(ctx, { projectId: changeSet.projectId });

        return { applied: true };
    },
});

export const reject = mutation({
    args: { changeSetId: v.id("itemChangeSets"), decidedBy: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const changeSet = await ctx.db.get(args.changeSetId);
        if (!changeSet) throw new Error("ChangeSet not found");
        if (changeSet.status !== "pending") throw new Error("ChangeSet already decided");

        await ctx.db.patch(changeSet._id, {
            status: "rejected",
            decidedAt: Date.now(),
            decidedBy: args.decidedBy,
        });

        return { rejected: true };
    },
});
