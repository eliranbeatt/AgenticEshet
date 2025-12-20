import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ChangeSetSchema } from "./lib/zodSchemas";
import { recomputeRollups } from "./lib/itemRollups";

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
    ref: { itemId?: string | null; itemTempId?: string | null },
    tempItemMap: Map<string, Id<"projectItems">>,
) {
    if (ref.itemId) return ref.itemId as Id<"projectItems">;
    if (ref.itemTempId) {
        const resolved = tempItemMap.get(ref.itemTempId);
        if (!resolved) throw new Error(`Missing item for tempId ${ref.itemTempId}`);
        return resolved;
    }
    throw new Error("Invalid itemRef");
}

function resolveTaskRef(
    ref: { taskId?: string | null; taskTempId?: string | null },
    tempTaskMap: Map<string, Id<"tasks">>,
) {
    if (ref.taskId) return ref.taskId as Id<"tasks">;
    if (ref.taskTempId) {
        const resolved = tempTaskMap.get(ref.taskTempId);
        if (!resolved) throw new Error(`Missing task for tempId ${ref.taskTempId}`);
        return resolved;
    }
    throw new Error("Invalid taskRef");
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
            v.literal("convert")
        )),
        status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"))),
    },
    handler: async (ctx, args) => {
        if (args.phase && args.status) {
            return await ctx.db
                .query("itemChangeSets")
                .withIndex("by_project_phase_status", (q) =>
                    q.eq("projectId", args.projectId).eq("phase", args.phase).eq("status", args.status)
                )
                .collect();
        }

        const changeSets = await ctx.db
            .query("itemChangeSets")
            .withIndex("by_project_phase_status", (q) =>
                q.eq("projectId", args.projectId).eq("phase", args.phase ?? "planning").eq("status", args.status ?? "pending")
            )
            .collect();

        return changeSets;
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

        const changeSetId = await ctx.db.insert("itemChangeSets", {
            projectId: changeSet.projectId as Id<"projects">,
            phase: changeSet.phase,
            agentName: changeSet.agentName,
            runId: undefined,
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

        return { changeSetId };
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
            };

            const parentItemId = payload.parentItemId
                ? (payload.parentItemId as Id<"projectItems">)
                : payload.parentTempId
                    ? tempItemMap.get(payload.parentTempId) ?? null
                    : null;

            const itemId = await ctx.db.insert("projectItems", {
                projectId: changeSet.projectId,
                parentItemId,
                sortKey: payload.sortKey,
                kind: payload.kind,
                category: payload.category,
                name: payload.name,
                title: payload.name,
                typeKey: payload.category,
                description: payload.description,
                flags: payload.flags,
                scope: payload.scope,
                quoteDefaults: payload.quoteDefaults,
                searchText: buildSearchText({
                    name: payload.name,
                    description: payload.description,
                    category: payload.category,
                }),
                status: "approved",
                createdFrom: { source: "agent", sourceId: changeSet._id },
                latestRevisionNumber: 1,
                createdAt: now,
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
                revisionType: "snapshot",
                snapshotJson: serializePayload(payload),
                changeSetId: changeSet._id,
                revisionNumber: 1,
                state: "approved",
                data: payload,
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
                durationHours: number;
                status: Doc<"tasks">["status"];
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
                status: payload.status ?? "todo",
                category: "Studio",
                priority: "Medium",
                durationHours: payload.durationHours,
                plannedStart: payload.plannedStart ?? null,
                plannedEnd: payload.plannedEnd ?? null,
                tags: payload.tags,
                source: "agent",
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
                itemId,
                taskId,
                lineType: payload.lineType as Doc<"accountingLines">["lineType"],
                title: payload.title,
                notes: payload.notes,
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

            const targetTask = await ctx.db.get(toTaskId);
            if (!targetTask) continue;
            const dependencies = targetTask.dependencies ?? [];
            if (!dependencies.includes(fromTaskId)) {
                await ctx.db.patch(toTaskId, {
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
