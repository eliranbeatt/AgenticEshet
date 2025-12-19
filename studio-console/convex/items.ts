import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { ItemSpecV2Schema, ItemUpdateOutputSchema } from "./lib/zodSchemas";

const tabScopeValidator = v.union(
    v.literal("ideation"),
    v.literal("clarification"),
    v.literal("planning"),
    v.literal("solutioning"),
    v.literal("accounting"),
    v.literal("tasks"),
    v.literal("quote")
);

function parseItemSpec(data: unknown) {
    const parsed = ItemSpecV2Schema.safeParse(data);
    if (!parsed.success) {
        console.error("Invalid ItemSpecV2", parsed.error.flatten());
        throw new Error("Invalid ItemSpecV2");
    }
    return parsed.data;
}

function buildBaseItemSpec(title: string, typeKey: string, description?: string) {
    return parseItemSpec({
        version: "ItemSpecV2",
        identity: {
            title,
            typeKey,
            description,
        },
    });
}

// --------------------------------------------------------------------------
// Queries
// --------------------------------------------------------------------------

export const listApproved = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const items = await ctx.db
            .query("projectItems")
            .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", "approved"))
            .collect();

        items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        return items;
    },
});

export const listSidebarTree = query({
    args: {
        projectId: v.id("projects"),
        includeTab: v.optional(tabScopeValidator),
        includeDrafts: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const statuses: Array<"draft" | "approved"> = args.includeDrafts
            ? ["approved", "draft"]
            : ["approved"];

        const items = [];
        for (const status of statuses) {
            const batch = await ctx.db
                .query("projectItems")
                .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", status))
                .collect();
            items.push(...batch);
        }

        items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        return { items };
    },
});

export const getItem = query({
    args: {
        itemId: v.id("projectItems"),
        includeTab: v.optional(tabScopeValidator),
    },
    handler: async (ctx, args) => {
        const item = await ctx.db.get(args.itemId);
        if (!item) return null;

        const revisions = await ctx.db
            .query("itemRevisions")
            .withIndex("by_item_revision", (q) => q.eq("itemId", args.itemId))
            .collect();

        const filtered = args.includeTab
            ? revisions.filter((rev) => rev.tabScope === args.includeTab)
            : revisions;

        return { item, revisions: filtered };
    },
});

export const listRevisions = query({
    args: { itemId: v.id("projectItems") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("itemRevisions")
            .withIndex("by_item_revision", (q) => q.eq("itemId", args.itemId))
            .collect();
    },
});

export const listTemplates = query({
    args: {},
    handler: async (ctx) => {
        const templates = await ctx.db.query("itemTemplates").collect();
        templates.sort((a, b) => a.sortOrder - b.sortOrder);
        return templates;
    },
});

// --------------------------------------------------------------------------
// Mutations
// --------------------------------------------------------------------------

export const createManual = mutation({
    args: {
        projectId: v.id("projects"),
        title: v.string(),
        typeKey: v.string(),
        description: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const spec = buildBaseItemSpec(args.title, args.typeKey, args.description);

        const itemId = await ctx.db.insert("projectItems", {
            projectId: args.projectId,
            title: args.title,
            typeKey: args.typeKey,
            status: "draft",
            createdFrom: { source: "manual" },
            latestRevisionNumber: 1,
            createdAt: now,
            updatedAt: now,
        });

        const revisionId = await ctx.db.insert("itemRevisions", {
            projectId: args.projectId,
            itemId,
            tabScope: "ideation",
            state: "proposed",
            revisionNumber: 1,
            data: spec,
            createdBy: { kind: "user" },
            createdAt: now,
        });

        await ctx.db.patch(itemId, { updatedAt: now });
        return { itemId, revisionId };
    },
});

export const createFromTemplate = mutation({
    args: { projectId: v.id("projects"), templateKey: v.string() },
    handler: async (ctx, args) => {
        const template = await ctx.db
            .query("itemTemplates")
            .filter((q) => q.eq(q.field("key"), args.templateKey))
            .unique();

        if (!template) throw new Error("Template not found");

        const now = Date.now();
        const spec = parseItemSpec(template.defaultData);

        const itemId = await ctx.db.insert("projectItems", {
            projectId: args.projectId,
            title: spec.identity.title,
            typeKey: template.typeKey,
            status: "draft",
            createdFrom: { source: "manual", sourceId: template.key },
            latestRevisionNumber: 1,
            createdAt: now,
            updatedAt: now,
        });

        const revisionId = await ctx.db.insert("itemRevisions", {
            projectId: args.projectId,
            itemId,
            tabScope: "ideation",
            state: "proposed",
            revisionNumber: 1,
            data: spec,
            createdBy: { kind: "user" },
            createdAt: now,
        });

        return { itemId, revisionId };
    },
});

export const createFromConceptCard = mutation({
    args: { projectId: v.id("projects"), conceptCardId: v.id("ideationConceptCards") },
    handler: async (ctx, args) => {
        const card = await ctx.db.get(args.conceptCardId);
        if (!card) throw new Error("Concept card not found");

        const now = Date.now();
        const spec = buildBaseItemSpec(card.title, "concept", card.detailsMarkdown);

        const itemId = await ctx.db.insert("projectItems", {
            projectId: args.projectId,
            title: card.title,
            typeKey: "concept",
            status: "draft",
            createdFrom: { source: "ideationCard", sourceId: card._id },
            latestRevisionNumber: 1,
            createdAt: now,
            updatedAt: now,
        });

        const revisionId = await ctx.db.insert("itemRevisions", {
            projectId: args.projectId,
            itemId,
            tabScope: "ideation",
            state: "proposed",
            revisionNumber: 1,
            data: spec,
            createdBy: { kind: "user" },
            createdAt: now,
        });

        return { itemId, revisionId };
    },
});

export const renameItem = mutation({
    args: { itemId: v.id("projectItems"), newTitle: v.string() },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.itemId, {
            title: args.newTitle,
            updatedAt: Date.now(),
        });
    },
});

export const upsertRevision = mutation({
    args: {
        itemId: v.id("projectItems"),
        tabScope: tabScopeValidator,
        dataOrPatch: v.any(),
        changeReason: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const item = await ctx.db.get(args.itemId);
        if (!item) throw new Error("Item not found");

        const now = Date.now();
        const spec = parseItemSpec(args.dataOrPatch);
        const revisionNumber = item.latestRevisionNumber + 1;

        const revisionId = await ctx.db.insert("itemRevisions", {
            projectId: item.projectId,
            itemId: args.itemId,
            tabScope: args.tabScope,
            state: "proposed",
            revisionNumber,
            baseApprovedRevisionId: item.approvedRevisionId,
            data: spec,
            summaryMarkdown: args.changeReason,
            createdBy: { kind: "user" },
            createdAt: now,
        });

        await ctx.db.patch(args.itemId, {
            latestRevisionNumber: revisionNumber,
            updatedAt: now,
        });

        return { revisionId };
    },
});

export const approveRevision = mutation({
    args: { itemId: v.id("projectItems"), revisionId: v.id("itemRevisions") },
    handler: async (ctx, args) => {
        const item = await ctx.db.get(args.itemId);
        const revision = await ctx.db.get(args.revisionId);

        if (!item) throw new Error("Item not found");
        if (!revision) throw new Error("Revision not found");
        if (revision.itemId !== args.itemId) throw new Error("Revision does not belong to item");

        const now = Date.now();
        if (item.approvedRevisionId) {
            await ctx.db.patch(item.approvedRevisionId, { state: "superseded" });
        }

        await ctx.db.patch(args.revisionId, { state: "approved" });
        await ctx.db.patch(args.itemId, {
            approvedRevisionId: args.revisionId,
            status: "approved",
            updatedAt: now,
        });

        return { approvedRevisionId: args.revisionId };
    },
});

export const rejectRevision = mutation({
    args: { itemId: v.id("projectItems"), revisionId: v.id("itemRevisions") },
    handler: async (ctx, args) => {
        const revision = await ctx.db.get(args.revisionId);
        if (!revision) throw new Error("Revision not found");
        if (revision.itemId !== args.itemId) throw new Error("Revision does not belong to item");

        await ctx.db.patch(args.revisionId, { state: "rejected" });
    },
});

export const archiveItem = mutation({
    args: { itemId: v.id("projectItems") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.itemId, {
            status: "archived",
            archivedAt: Date.now(),
            updatedAt: Date.now(),
        });
    },
});

export const restoreItem = mutation({
    args: { itemId: v.id("projectItems") },
    handler: async (ctx, args) => {
        const item = await ctx.db.get(args.itemId);
        if (!item) throw new Error("Item not found");

        await ctx.db.patch(args.itemId, {
            status: item.approvedRevisionId ? "approved" : "draft",
            archivedAt: undefined,
            updatedAt: Date.now(),
        });
    },
});

export const requestDelete = mutation({
    args: { itemId: v.id("projectItems") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.itemId, {
            deleteRequestedAt: Date.now(),
            updatedAt: Date.now(),
        });
    },
});

export const confirmDelete = mutation({
    args: { itemId: v.id("projectItems") },
    handler: async (ctx, args) => {
        const item = await ctx.db.get(args.itemId);
        if (!item) return;

        const revisions = await ctx.db
            .query("itemRevisions")
            .withIndex("by_item_revision", (q) => q.eq("itemId", args.itemId))
            .collect();

        for (const revision of revisions) {
            await ctx.db.delete(revision._id);
        }

        const lock = await ctx.db
            .query("itemProjectionLocks")
            .withIndex("by_project_item", (q) => q.eq("projectId", item.projectId).eq("itemId", item._id))
            .unique();

        if (lock) {
            await ctx.db.delete(lock._id);
        }

        await ctx.db.delete(args.itemId);
    },
});

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------

export const generateRevisionDiff = action({
    args: {
        baseApprovedRevisionId: v.id("itemRevisions"),
        proposedData: v.any(),
    },
    handler: async (_ctx, args) => {
        const spec = parseItemSpec(args.proposedData);
        return {
            baseApprovedRevisionId: args.baseApprovedRevisionId,
            proposedData: spec,
        };
    },
});

export const agentProposeItemUpdate = action({
    args: {
        itemId: v.id("projectItems"),
        tabScope: tabScopeValidator,
        agentOutput: v.any(),
    },
    handler: async (ctx, args) => {
        const parsed = ItemUpdateOutputSchema.safeParse(args.agentOutput);
        if (!parsed.success) {
            console.error("Invalid ItemUpdateOutput", parsed.error.flatten());
            throw new Error("Invalid ItemUpdateOutput");
        }

        if (parsed.data.itemId !== String(args.itemId)) {
            throw new Error("Item ID mismatch");
        }

        const result = await ctx.runMutation(api.items.upsertRevision, {
            itemId: args.itemId,
            tabScope: args.tabScope,
            dataOrPatch: parsed.data.proposedData,
            changeReason: parsed.data.changeReason,
        });

        return { revisionId: result.revisionId };
    },
});
