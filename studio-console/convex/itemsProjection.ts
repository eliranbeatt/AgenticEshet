import { query } from "./_generated/server";
import { v } from "convex/values";

export const getItemProjection = query({
  args: { itemId: v.id("projectItems") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;
    const project = await ctx.db.get(item.projectId);
    if (project?.features?.factsEnabled === false) return null;

    const facts = await ctx.db
      .query("facts")
      .withIndex("by_scope_key", (q) => 
        q.eq("projectId", item.projectId)
         .eq("scopeType", "item")
         .eq("itemId", item._id)
      )
      .filter(q => q.eq(q.field("status"), "accepted"))
      .collect();

    const projection: Record<string, any> = {};

    for (const fact of facts) {
        const keyParts = fact.key.split(".");
        const fieldName = keyParts[keyParts.length - 1];
        const groupName = keyParts[keyParts.length - 2];
        
        if (!projection[groupName]) projection[groupName] = {};
        projection[groupName][fieldName] = {
            value: fact.value,
            factId: fact._id,
            source: "fact"
        };
    }

    if (item.manualOverrides) {
        // Merge overrides logic here
        // For now, we assume overrides are applied on top
        // TODO: Implement deep merge
    }

    return projection;
  },
});
