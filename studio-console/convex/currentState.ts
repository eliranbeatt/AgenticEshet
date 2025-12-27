import { v } from "convex/values";
import { query } from "./_generated/server";
import { buildDerivedCurrentState } from "./lib/currentState";

const scopeTypeValidator = v.optional(
    v.union(v.literal("allProject"), v.literal("singleItem"), v.literal("multiItem"))
);

export const getDerived = query({
    args: {
        projectId: v.id("projects"),
        scopeType: scopeTypeValidator,
        scopeItemIds: v.optional(v.array(v.id("projectItems"))),
    },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        const scoped = args.scopeType && args.scopeType !== "allProject";
        const scopeItemIds = scoped ? (args.scopeItemIds ?? []) : [];

        const items = scopeItemIds.length > 0
            ? await Promise.all(scopeItemIds.map((id) => ctx.db.get(id)))
            : await ctx.db
                .query("projectItems")
                .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId))
                .collect();

        const filteredItems = items.filter(Boolean).map((item) => ({
            id: item!._id,
            title: item!.title,
            name: item!.name,
            typeKey: item!.typeKey,
            status: item!.status,
            scope: item!.scope,
        }));

        const knowledgeBlocks = await ctx.db
            .query("knowledgeBlocks")
            .withIndex("by_scope_block", (q) => q.eq("projectId", args.projectId))
            .collect();

        const scopeItemIdSet = scopeItemIds.length
            ? new Set(scopeItemIds.map(String))
            : null;

        const filteredBlocks = knowledgeBlocks.filter((block) => {
            if (block.scopeType === "project") return true;
            if (!scopeItemIdSet) return true;
            return block.itemId && scopeItemIdSet.has(String(block.itemId));
        });

        const markdown = buildDerivedCurrentState({
            projectName: project?.name ?? null,
            items: filteredItems,
            knowledgeBlocks: filteredBlocks.map((block) => ({
                scopeType: block.scopeType,
                itemId: block.itemId,
                blockKey: block.blockKey,
                renderedMarkdown: block.renderedMarkdown,
                json: block.json,
            })),
        });

        return { markdown };
    },
});
