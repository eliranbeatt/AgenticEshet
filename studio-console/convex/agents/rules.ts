import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { api } from "../_generated/api";
import { ChangeSetSchema } from "../lib/zodSchemas";
import { Doc, Id } from "../_generated/dataModel";

export const run = mutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");

        // 1. Fetch all active items
        const items = await ctx.db.query("projectItems")
            .withIndex("by_project_status", q => q.eq("projectId", args.projectId))
            .collect();

        const activeItems = items.filter(i =>
            i.status !== "archived" && i.status !== "cancelled"
        );

        // 2. Fetch all templates
        const templates = await ctx.db.query("templateDefinitions")
            .withIndex("by_status", q => q.eq("status", "published"))
            .collect();

        // 3. Evaluate rules
        const ops: any[] = [];
        const warnings: string[] = [];

        // Helper to check if item of type exists
        const hasItemOfType = (typeKey: string) => {
            return activeItems.some(i => i.typeKey === typeKey || i._id === typeKey); // Check typeKey mostly
        };

        // Helper to check condition
        const checkCondition = (when: string) => {
            if (when === "always") return true;
            if (when.startsWith("projectFlag:")) {
                const flag = when.split(":")[1];
                // @ts-ignore
                return !!project.projectFlags?.[flag];
            }
            return false; // Unknown condition
        };

        for (const item of activeItems) {
            // Find template for this item
            // Check createdFrom first, then typeKey
            let templateId = item.typeKey;

            if (item.createdFrom?.source === "manual" && item.createdFrom.sourceId) {
                templateId = item.createdFrom.sourceId;
            }
            // projectItems does NOT have origin field, relies on typeKey or createdFrom

            if (!templateId) continue;

            const template = templates.find(t => t.templateId === templateId);
            // We might have multiple versions, take the latest or the one matching origin if needed.
            // For companion rules, using the logic from the ITEM's template definition is safest.
            // But simplification: find any published template with this ID.
            if (!template) continue;

            if (!template.companionRules) continue;

            for (const rule of template.companionRules) {
                if (!checkCondition(rule.when)) continue;

                if (rule.type === "suggestItem" || rule.type === "autoAddItem") {
                    const targetTemplateId = rule.templateId;

                    // Check if already exists
                    if (hasItemOfType(targetTemplateId)) continue;

                    // Avoid suggesting duplicates in the same run
                    const alreadySuggested = ops.some(op =>
                        op.entityType === "item" &&
                        op.payload.typeKey === targetTemplateId
                    );
                    if (alreadySuggested) continue;

                    // Find the target template to get its name
                    const targetTemplate = templates.find(t => t.templateId === targetTemplateId);
                    const title = targetTemplate?.name ?? targetTemplateId;

                    ops.push({
                        entityType: "item",
                        opType: "create",
                        tempId: `temp_${Date.now()}_${ops.length}`,
                        payload: {
                            title: title,
                            typeKey: targetTemplateId,
                            category: "suggested",
                            description: `Suggested by companion rule from ${item.title}`
                        }
                    });
                }
            }
        }

        if (ops.length === 0) {
            return { message: "No rules triggered" };
        }

        // 4. Create ChangeSet
        const changeSet = {
            projectId: args.projectId,
            title: "Companion Suggestions",
            description: "Items suggested by companion rules based on current project scope.",
            phase: "planning",
            agentName: "rules_engine",
            status: "open",
            ops,
            warnings,
            createdAt: Date.now(),
            counts: {
                items: ops.length,
                tasks: 0,
                accountingLines: 0,
                dependencies: 0,
                materialLines: 0
            }
        };

        // Validate with Zod? We are constructing it manually so it should be fine if we match schema.
        // But api.changeSets.create expects specific args.
        // It expects `changeSet` object.

        const changeSetId = await ctx.db.insert("itemChangeSets", changeSet as any);

        // Also insert ops
        for (const op of ops) {
            await ctx.db.insert("itemChangeSetOps", {
                projectId: args.projectId,
                changeSetId,
                entityType: op.entityType,
                opType: op.opType,
                tempId: op.tempId,
                payloadJson: JSON.stringify(op.payload),
                createdAt: Date.now()
            });
        }

        return { changeSetId, count: ops.length };
    }
});
