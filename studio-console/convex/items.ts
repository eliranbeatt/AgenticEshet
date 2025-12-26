import { v } from "convex/values";
import { action, mutation, query, internalQuery } from "./_generated/server";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { ItemSpecV2Schema, ItemUpdateOutputSchema, type ItemSpecV2 } from "./lib/zodSchemas";
import { syncItemProjections } from "./lib/itemProjections";
import {
    parseItemSpec,
    buildSearchText,
    buildBaseItemSpec,
    normalizeRateType,
    buildMaterialSpec,
    buildLaborSpec,
    buildSpecFromAccounting
} from "./lib/itemHelpers";

const tabScopeValidator = v.union(
    v.literal("ideation"),
    v.literal("clarification"),
    v.literal("planning"),
    v.literal("solutioning"),
    v.literal("accounting"),
    v.literal("tasks"),
    v.literal("quote")
);

export const getItemRefs = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const items = await ctx.db
            .query("projectItems")
            .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId))
            .collect();
        return items.map((item) => ({
            id: item._id,
            name: item.name ?? item.title ?? "Untitled item",
        }));
    },
});
















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

export const listApprovedWithSpecs = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const items = await ctx.db
            .query("projectItems")
            .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", "approved"))
            .collect();

        items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

        const results = [];
        for (const item of items) {
            let spec: ItemSpecV2;
            if (item.approvedRevisionId) {
                const revision = await ctx.db.get(item.approvedRevisionId);
                spec = revision ? parseItemSpec(revision.data) : buildBaseItemSpec(item.title, item.typeKey);
            } else {
                spec = buildBaseItemSpec(item.title, item.typeKey);
            }
            results.push({ item, spec });
        }
        return results;
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

        if (!args.includeTab) {
            return { items };
        }

        const drafts = await ctx.db
            .query("itemRevisions")
            .withIndex("by_project_tab_state", (q) =>
                q.eq("projectId", args.projectId).eq("tabScope", args.includeTab).eq("state", "proposed")
            )
            .collect();

        const draftByItemId = new Map<string, Doc<"itemRevisions">>();
        for (const draft of drafts) {
            const existing = draftByItemId.get(draft.itemId);
            if (!existing || existing.revisionNumber < draft.revisionNumber) {
                draftByItemId.set(draft.itemId, draft);
            }
        }

        return {
            items: items.map((item) => {
                const draft = draftByItemId.get(item._id);
                return {
                    ...item,
                    draftRevisionId: draft?._id ?? null,
                    draftRevisionNumber: draft?.revisionNumber ?? null,
                };
            }),
        };
    },
});

export const listTreeSidebar = query({
    args: {
        projectId: v.id("projects"),
        includeTab: v.optional(tabScopeValidator),
        includeDrafts: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const statuses: Array<"draft" | "approved"> = args.includeDrafts
            ? ["approved", "draft"]
            : ["approved"];

        const items = await ctx.db
            .query("projectItems")
            .withIndex("by_project_parent_sort", (q) => q.eq("projectId", args.projectId))
            .collect();

        const filtered = items.filter((item) => statuses.includes(item.status));
        filtered.sort((a, b) => (a.sortKey ?? "").localeCompare(b.sortKey ?? ""));

        if (!args.includeTab) {
            return { items: filtered };
        }

        const drafts = await ctx.db
            .query("itemRevisions")
            .withIndex("by_project_tab_state", (q) =>
                q.eq("projectId", args.projectId).eq("tabScope", args.includeTab).eq("state", "proposed")
            )
            .collect();

        const draftByItemId = new Map<string, Doc<"itemRevisions">>();
        for (const draft of drafts) {
            const existing = draftByItemId.get(draft.itemId);
            if (!existing || existing.revisionNumber < draft.revisionNumber) {
                draftByItemId.set(draft.itemId, draft);
            }
        }

        return {
            items: filtered.map((item) => {
                const draft = draftByItemId.get(item._id);
                return {
                    ...item,
                    draftRevisionId: draft?._id ?? null,
                    draftRevisionNumber: draft?.revisionNumber ?? null,
                };
            }),
        };
    },
});

export const listTree = query({
    args: {
        projectId: v.id("projects"),
        parentItemId: v.optional(v.union(v.id("projectItems"), v.null())),
    },
    handler: async (ctx, args) => {
        const parentItemId = args.parentItemId ?? null;
        const items = await ctx.db
            .query("projectItems")
            .withIndex("by_project_parent_sort", (q) =>
                q.eq("projectId", args.projectId).eq("parentItemId", parentItemId)
            )
            .collect();

        items.sort((a, b) => (a.sortKey ?? "").localeCompare(b.sortKey ?? ""));
        return items;
    },
});

export const listByIds = query({
    args: {
        itemIds: v.array(v.id("projectItems")),
    },
    handler: async (ctx, args) => {
        const items = await Promise.all(args.itemIds.map((id) => ctx.db.get(id)));
        return items.filter((i): i is Doc<"projectItems"> => Boolean(i));
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

export const getItemDetails = query({
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

        const [tasks, materialLines, workLines, accountingLines] = await Promise.all([
            ctx.db
                .query("tasks")
                .withIndex("by_project_item", (q) => q.eq("projectId", item.projectId).eq("itemId", item._id))
                .collect(),
            ctx.db
                .query("materialLines")
                .withIndex("by_project_item", (q) => q.eq("projectId", item.projectId).eq("itemId", item._id))
                .collect(),
            ctx.db
                .query("workLines")
                .withIndex("by_project_item", (q) => q.eq("projectId", item.projectId).eq("itemId", item._id))
                .collect(),
            ctx.db
                .query("accountingLines")
                .withIndex("by_project_item", (q) => q.eq("projectId", item.projectId).eq("itemId", item._id))
                .collect(),
        ]);

        return {
            item,
            revisions: filtered,
            tasks,
            materialLines,
            workLines,
            accountingLines,
        };
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
            parentItemId: null,
            sortKey: String(now),
            title: args.title,
            typeKey: args.typeKey,
            name: args.title,
            category: args.typeKey,
            kind: "deliverable",
            description: args.description,
            searchText: buildSearchText({ name: args.title, description: args.description, typeKey: args.typeKey }),
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
            parentItemId: null,
            sortKey: String(now),
            title: spec.identity.title,
            typeKey: template.typeKey,
            name: spec.identity.title,
            category: template.typeKey,
            kind: "deliverable",
            description: spec.identity.description,
            searchText: buildSearchText({
                name: spec.identity.title,
                description: spec.identity.description,
                typeKey: template.typeKey,
            }),
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
            parentItemId: null,
            sortKey: String(now),
            title: card.title,
            typeKey: "concept",
            name: card.title,
            category: "concept",
            kind: "deliverable",
            description: card.detailsMarkdown,
            searchText: buildSearchText({
                name: card.title,
                description: card.detailsMarkdown,
                typeKey: "concept",
            }),
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
            name: args.newTitle,
            searchText: buildSearchText({ name: args.newTitle }),
            updatedAt: Date.now(),
        });
    },
});

export const createItem = mutation({
    args: {
        projectId: v.id("projects"),
        parentItemId: v.optional(v.id("projectItems")),
        sortKey: v.string(),
        kind: v.string(),
        category: v.string(),
        name: v.string(),
        description: v.optional(v.string()),
        flags: v.optional(v.any()),
        scope: v.optional(v.any()),
        quoteDefaults: v.optional(v.any()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const itemId = await ctx.db.insert("projectItems", {
            projectId: args.projectId,
            parentItemId: args.parentItemId ?? null,
            sortKey: args.sortKey,
            kind: args.kind,
            category: args.category,
            name: args.name,
            title: args.name,
            typeKey: args.category,
            description: args.description,
            flags: args.flags,
            scope: args.scope,
            quoteDefaults: args.quoteDefaults,
            searchText: buildSearchText({ name: args.name, description: args.description, typeKey: args.category }),
            status: "draft",
            createdFrom: { source: "manual" },
            latestRevisionNumber: 1,
            createdAt: now,
            updatedAt: now,
        });

        return { itemId };
    },
});

export const patchItem = mutation({
    args: {
        itemId: v.id("projectItems"),
        patch: v.object({
            name: v.optional(v.string()),
            description: v.optional(v.string()),
            kind: v.optional(v.string()),
            category: v.optional(v.string()),
            flags: v.optional(v.any()),
            scope: v.optional(v.any()),
            quoteDefaults: v.optional(v.any()),
        }),
    },
    handler: async (ctx, args) => {
        const item = await ctx.db.get(args.itemId);
        if (!item) throw new Error("Item not found");

        const name = args.patch.name ?? item.name ?? item.title;
        const description = args.patch.description ?? item.description;
        const category = args.patch.category ?? item.category ?? item.typeKey;

        await ctx.db.patch(args.itemId, {
            ...args.patch,
            title: args.patch.name ?? item.title,
            typeKey: args.patch.category ?? item.typeKey,
            searchText: buildSearchText({
                name,
                description: description ?? undefined,
                typeKey: category ?? undefined,
            }),
            updatedAt: Date.now(),
        });
    },
});

export const moveItem = mutation({
    args: {
        itemId: v.id("projectItems"),
        parentItemId: v.optional(v.union(v.id("projectItems"), v.null())),
        sortKey: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.itemId, {
            parentItemId: args.parentItemId ?? null,
            sortKey: args.sortKey ?? undefined,
            updatedAt: Date.now(),
        });
    },
});

export const reorderSiblings = mutation({
    args: {
        projectId: v.id("projects"),
        parentItemId: v.optional(v.union(v.id("projectItems"), v.null())),
        orderedItems: v.array(v.object({ itemId: v.id("projectItems"), sortKey: v.string() })),
    },
    handler: async (ctx, args) => {
        const parentItemId = args.parentItemId ?? null;
        const itemIds = new Set(args.orderedItems.map((entry) => entry.itemId));

        const siblings = await ctx.db
            .query("projectItems")
            .withIndex("by_project_parent_sort", (q) =>
                q.eq("projectId", args.projectId).eq("parentItemId", parentItemId)
            )
            .collect();

        for (const entry of args.orderedItems) {
            if (!itemIds.has(entry.itemId)) continue;
            await ctx.db.patch(entry.itemId, { sortKey: entry.sortKey, updatedAt: Date.now() });
        }

        const untouched = siblings.filter((item) => !itemIds.has(item._id));
        for (const item of untouched) {
            await ctx.db.patch(item._id, { sortKey: item.sortKey ?? item._id, updatedAt: Date.now() });
        }
    },
});

export const upsertRevision = mutation({
    args: {
        itemId: v.id("projectItems"),
        tabScope: tabScopeValidator,
        dataOrPatch: v.any(),
        changeReason: v.optional(v.string()),
        createdByKind: v.optional(v.union(v.literal("user"), v.literal("agent"))),
        agentRunId: v.optional(v.id("agentRuns")),
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
            createdBy: {
                kind: args.createdByKind ?? "user",
                agentRunId: args.agentRunId,
            },
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
        const spec = parseItemSpec(revision.data);
        if (item.approvedRevisionId) {
            await ctx.db.patch(item.approvedRevisionId, { state: "superseded" });
        }

        await ctx.db.patch(args.revisionId, { state: "approved" });
        await ctx.db.patch(args.itemId, {
            approvedRevisionId: args.revisionId,
            status: "approved",
            title: spec.identity.title,
            typeKey: spec.identity.typeKey,
            name: spec.identity.title,
            category: spec.identity.typeKey,
            description: spec.identity.description,
            searchText: buildSearchText({
                name: spec.identity.title,
                description: spec.identity.description,
                typeKey: spec.identity.typeKey,
            }),
            tags: spec.identity.tags,
            updatedAt: now,
        });

        await syncItemProjections(ctx, {
            item: { ...item, title: spec.identity.title, typeKey: spec.identity.typeKey },
            revision,
            spec,
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
    args: { itemId: v.id("projectItems"), requestedBy: v.optional(v.string()) },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.itemId, {
            deleteRequestedAt: Date.now(),
            deleteRequestedBy: args.requestedBy,
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

export const syncApproved = mutation({
    args: { itemId: v.id("projectItems") },
    handler: async (ctx, args) => {
        const item = await ctx.db.get(args.itemId);
        if (!item) throw new Error("Item not found");
        if (!item.approvedRevisionId) throw new Error("Item has no approved revision");

        const revision = await ctx.db.get(item.approvedRevisionId);
        if (!revision) throw new Error("Revision not found");

        const spec = parseItemSpec(revision.data);
        return await syncItemProjections(ctx, {
            item,
            revision,
            spec,
            force: true,
        });
    },
});

export const syncFromAccountingSection = mutation({
    args: {
        itemId: v.id("projectItems"),
        sectionId: v.id("sections"),
    },
    handler: async (ctx, args) => {
        const item = await ctx.db.get(args.itemId);
        const section = await ctx.db.get(args.sectionId);

        if (!item) throw new Error("Item not found");
        if (!section) throw new Error("Section not found");
        if (item.projectId !== section.projectId) {
            throw new Error("Item and section belong to different projects");
        }

        const [materials, workLines] = await Promise.all([
            ctx.db
                .query("materialLines")
                .withIndex("by_section", (q) => q.eq("sectionId", args.sectionId))
                .collect(),
            ctx.db
                .query("workLines")
                .withIndex("by_section", (q) => q.eq("sectionId", args.sectionId))
                .collect(),
        ]);

        let baseSpec: ItemSpecV2 | undefined;
        if (item.approvedRevisionId) {
            const approved = await ctx.db.get(item.approvedRevisionId);
            if (approved) {
                baseSpec = parseItemSpec(approved.data);
            }
        }

        const spec = buildSpecFromAccounting({ item, section, materials, workLines, baseSpec });

        const now = Date.now();
        const revisionNumber = item.latestRevisionNumber + 1;

        if (item.approvedRevisionId) {
            await ctx.db.patch(item.approvedRevisionId, { state: "superseded" });
        }

        const revisionId = await ctx.db.insert("itemRevisions", {
            projectId: item.projectId,
            itemId: item._id,
            tabScope: "accounting",
            state: "approved",
            revisionNumber,
            baseApprovedRevisionId: item.approvedRevisionId,
            data: spec,
            summaryMarkdown: "Synced from accounting section.",
            createdBy: { kind: "user" },
            createdAt: now,
        });

        await ctx.db.patch(item._id, {
            approvedRevisionId: revisionId,
            latestRevisionNumber: revisionNumber,
            status: "approved",
            title: spec.identity.title,
            typeKey: spec.identity.typeKey,
            tags: spec.identity.tags,
            updatedAt: now,
        });

        const revision = await ctx.db.get(revisionId);
        if (!revision) throw new Error("Revision not found after insert");

        await syncItemProjections(ctx, {
            item: { ...item, title: spec.identity.title, typeKey: spec.identity.typeKey },
            revision,
            spec,
            force: true,
        });

        return { revisionId };
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
            createdByKind: "agent",
        });

        return { revisionId: result.revisionId };
    },
});

export const applySpec = mutation({
    args: {
        projectId: v.id("projects"),
        itemId: v.optional(v.id("projectItems")),
        spec: v.any(), // We'll parse with ItemSpecV2Schema inside
    },
    handler: async (ctx, args) => {
        const spec = ItemSpecV2Schema.parse(args.spec);
        const now = Date.now();

        let itemId = args.itemId;

        if (!itemId) {
            // Create new item
            itemId = await ctx.db.insert("projectItems", {
                projectId: args.projectId,
                title: spec.identity.title,
                typeKey: spec.identity.typeKey,
                status: "draft",
                createdAt: now,
                updatedAt: now,
                latestRevisionNumber: 0,
                createdFrom: { source: "manual" },
            });
        } else {
            // Update existing item basic fields
            await ctx.db.patch(itemId, {
                title: spec.identity.title,
                typeKey: spec.identity.typeKey,
                updatedAt: now,
            });
        }

        // Create a revision
        const item = await ctx.db.get(itemId);
        if (!item) throw new Error("Item not found");

        const revisionNumber = (item.latestRevisionNumber || 0) + 1;

        const revisionId = await ctx.db.insert("itemRevisions", {
            projectId: args.projectId,
            itemId: itemId,
            tabScope: "planning", // Default to planning for now
            state: "approved", // Auto-approve for "Turn into item" flow
            revisionNumber,
            baseApprovedRevisionId: item.approvedRevisionId,
            data: spec,
            summaryMarkdown: "Applied from Agentic Flow",
            createdBy: { kind: "user" },
            createdAt: now,
        });

        await ctx.db.patch(itemId, {
            approvedRevisionId: revisionId,
            latestRevisionNumber: revisionNumber,
            status: "approved",
        });
        
        // Sync projections
        const revision = await ctx.db.get(revisionId);
        if (revision) {
             await syncItemProjections(ctx, {
                item: { ...item, title: spec.identity.title, typeKey: spec.identity.typeKey },
                revision,
                spec,
                force: true,
            });
        }

        return { itemId, revisionId };
    },
});
