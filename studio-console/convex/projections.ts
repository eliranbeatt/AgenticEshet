import { mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { rebuildElementProjections } from "./lib/elementProjections";

async function getActiveElements(ctx: MutationCtx, projectId: Id<"projects">) {
  const elements = await ctx.db
    .query("projectItems")
    .withIndex("by_project_status", (q) => q.eq("projectId", projectId))
    .collect();
  return elements.filter((element) => element.activeVersionId && element.status !== "archived");
}

export const rebuild = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const elements = await getActiveElements(ctx, args.projectId);
    const results: Array<{ elementId: Doc<"projectItems">["_id"]; tasks: number; materials: number; labor: number }> = [];

    for (const element of elements) {
      const versionId = element.activeVersionId;
      if (!versionId) continue;
      const version = await ctx.db.get(versionId);
      if (!version?.snapshot) continue;
      const snapshot = version.snapshot;
      const stats = await rebuildElementProjections(ctx, {
        element,
        snapshot,
        elementVersionId: versionId,
      });
      results.push({ elementId: element._id, tasks: stats.tasks, materials: stats.materials, labor: stats.labor });
    }

    return { elements: results.length, results };
  },
});

export const rebuildProjectFromElements = rebuild;

export const rebuildElement = mutation({
  args: { elementId: v.id("projectItems") },
  handler: async (ctx, args) => {
    const element = await ctx.db.get(args.elementId);
    if (!element) {
      throw new Error("Element not found");
    }
    const versionId = element.activeVersionId;
    if (!versionId) return { skipped: true };
    const version = await ctx.db.get(versionId);
    if (!version?.snapshot) return { skipped: true };

    const stats = await rebuildElementProjections(ctx, {
      element,
      snapshot: version.snapshot,
      elementVersionId: versionId,
    });
    return { ...stats };
  },
});
