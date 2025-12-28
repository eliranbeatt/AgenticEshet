
import { query } from "./_generated/server";
import { v } from "convex/values";

export const checkTemplate = query({
    args: { templateId: v.string() },
    handler: async (ctx, args) => {
        const template = await ctx.db
            .query("templateDefinitions")
            .withIndex("by_templateId_version", (q) =>
                q.eq("templateId", args.templateId)
            )
            .first();
        return template;
    },
});
