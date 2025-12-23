import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const tabValidator = v.union(v.literal("ideation"), v.literal("planning"), v.literal("solutioning"));
const scopeTypeValidator = v.union(v.literal("allProject"), v.literal("singleItem"), v.literal("multiItem"));

export function buildScopeKey(args: {
    scopeType: "allProject" | "singleItem" | "multiItem";
    scopeItemIds?: string[] | null;
}) {
    if (args.scopeType === "allProject") return "allProject";
    const ids = (args.scopeItemIds ?? []).map(String).filter(Boolean).sort();
    if (args.scopeType === "singleItem") {
        if (ids.length !== 1) throw new Error("singleItem scope requires exactly 1 itemId");
        return `singleItem:${ids[0]}`;
    }
    if (!ids.length) throw new Error("multiItem scope requires at least 1 itemId");
    return `multiItem:${ids.join(",")}`;
}

export const get = query({
    args: {
        projectId: v.id("projects"),
        tab: tabValidator,
        scopeKey: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("flowWorkspaces")
            .withIndex("by_project_tab_scopeKey", (q) =>
                q.eq("projectId", args.projectId).eq("tab", args.tab).eq("scopeKey", args.scopeKey)
            )
            .unique();
    },
});

export const ensure = mutation({
    args: {
        projectId: v.id("projects"),
        tab: tabValidator,
        scopeType: scopeTypeValidator,
        scopeItemIds: v.optional(v.array(v.id("projectItems"))),
        initialText: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const scopeKey = buildScopeKey({
            scopeType: args.scopeType,
            scopeItemIds: args.scopeItemIds?.map(String) ?? null,
        });

        const existing = await ctx.db
            .query("flowWorkspaces")
            .withIndex("by_project_tab_scopeKey", (q) =>
                q.eq("projectId", args.projectId).eq("tab", args.tab).eq("scopeKey", scopeKey)
            )
            .unique();

        if (existing) return { workspaceId: existing._id, scopeKey };

        const now = Date.now();
        const workspaceId = await ctx.db.insert("flowWorkspaces", {
            projectId: args.projectId,
            tab: args.tab,
            scopeType: args.scopeType,
            scopeKey,
            scopeItemIds: args.scopeItemIds,
            text: args.initialText ?? "",
            updatedBy: "system",
            revision: 1,
            createdAt: now,
            updatedAt: now,
        });

        return { workspaceId, scopeKey };
    },
});

export const saveText = mutation({
    args: {
        workspaceId: v.id("flowWorkspaces"),
        text: v.string(),
        source: v.union(v.literal("user"), v.literal("system")),
        lastAgentRunId: v.optional(v.id("agentRuns")),
        manualEditedAt: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.get(args.workspaceId);
        if (!existing) throw new Error("Workspace not found");

        const now = Date.now();
        await ctx.db.patch(args.workspaceId, {
            text: args.text,
            updatedBy: args.source,
            lastAgentRunId: args.lastAgentRunId,
            manualEditedAt: args.manualEditedAt ?? (args.source === "user" ? now : existing.manualEditedAt),
            revision: (existing.revision ?? 0) + 1,
            updatedAt: now,
        });

        return { ok: true as const };
    },
});
