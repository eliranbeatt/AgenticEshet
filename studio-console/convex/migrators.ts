import { action, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const migrateProjects = mutation({
    args: { projectId: v.optional(v.id("projects")) },
    handler: async (ctx, args) => {
        const projects = args.projectId
            ? [await ctx.db.get(args.projectId)]
            : await ctx.db.query("projects").collect();

        const templates = await ctx.db.query("templateDefinitions")
            .withIndex("by_status", q => q.eq("status", "published"))
            .collect();

        let stats = { items: 0, tasks: 0, materials: 0 };

        for (const project of projects) {
            if (!project) continue;

            // 1. Migrate Items
            const items = await ctx.db.query("projectItems")
                .withIndex("by_project_status", q => q.eq("projectId", project._id))
                .collect();

            for (const item of items) {
                // Try to find matching template
                const match = templates.find(t => t.name === item.title || t.name === item.name);
                if (match) {
                    // Update item origin if not already set
                    if (!item.createdFrom || item.createdFrom.source === "manual") {
                        await ctx.db.patch(item._id, {
                            createdFrom: { source: "manual", sourceId: match.templateId },
                            typeKey: match.templateId, // retroactive type assignment
                            category: "template"
                        });
                        stats.items++;
                    }

                    // 2. Migrate Tasks for this item
                    const tasks = await ctx.db.query("tasks")
                        .withIndex("by_project_item", q => q.eq("projectId", project._id).eq("itemId", item._id))
                        .collect();

                    for (const task of tasks) {
                        if (!task.origin) {
                            // Try match task title
                            const taskMatch = match.tasks.find(t => t.title === task.title);
                            if (taskMatch) {
                                await ctx.db.patch(task._id, {
                                    origin: {
                                        source: "template",
                                        templateId: match.templateId,
                                        version: match.version
                                    },
                                    description: task.description || `Role: ${taskMatch.role}, Effort: ${taskMatch.effortDays}d`
                                });
                                stats.tasks++;
                            }
                        }
                    }

                    // 3. Migrate Material Lines
                    const materials = await ctx.db.query("materialLines")
                        .withIndex("by_project_item", q => q.eq("projectId", project._id).eq("itemId", item._id))
                        .collect();

                    for (const mat of materials) {
                        if (!mat.origin) {
                            const matMatch = match.materials.find(m => m.name === mat.label);
                            if (matMatch) {
                                await ctx.db.patch(mat._id, {
                                    origin: {
                                        source: "template",
                                        templateId: match.templateId,
                                        version: match.version
                                    }
                                });
                                stats.materials++;
                            }
                        }
                    }
                }
            }
        }
        return stats;
    }
});
