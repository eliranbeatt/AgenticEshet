import { mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

function stableHash(input: unknown) {
    const text = JSON.stringify(input ?? "");
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
        hash = (hash * 33) ^ text.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
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
