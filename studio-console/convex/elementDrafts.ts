import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { ItemSpecV2Schema } from "./lib/zodSchemas";
import { buildBaseItemSpec, buildSearchText, parseItemSpec } from "./lib/itemHelpers";
import type { Doc, Id } from "./_generated/dataModel";

export const list = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const drafts = await ctx.db
            .query("elementDrafts")
            .withIndex("by_project_updatedAt", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .collect();

        const elementsById = new Map<string, Doc<"projectItems">>();
        for (const draft of drafts) {
            if (elementsById.has(String(draft.elementId))) continue;
            const element = await ctx.db.get(draft.elementId);
            if (element) {
                elementsById.set(String(draft.elementId), element);
            }
        }

        return drafts.map((draft) => ({
            draft,
            element: elementsById.get(String(draft.elementId)) ?? null,
        }));
    },
});

export const get = query({
    args: { projectId: v.id("projects"), elementId: v.id("projectItems") },
    handler: async (ctx, args) => {
        const draft = await ctx.db
            .query("elementDrafts")
            .withIndex("by_project_element", (q) =>
                q.eq("projectId", args.projectId).eq("elementId", args.elementId)
            )
            .first();
        return draft ?? null;
    },
});

export const getWithApproved = query({
    args: { projectId: v.id("projects"), draftId: v.id("elementDrafts") },
    handler: async (ctx, args) => {
        const draft = await ctx.db.get(args.draftId);
        if (!draft || draft.projectId !== args.projectId) return null;

        const element = await ctx.db.get(draft.elementId);
        if (!element) return { draft, approvedSpec: null };

        let approvedSpec = null;
        if (element.approvedRevisionId) {
            const revision = await ctx.db.get(element.approvedRevisionId);
            if (revision?.data) {
                approvedSpec = parseItemSpec(revision.data);
            }
        }

        return { draft, approvedSpec };
    },
});

export const upsert = mutation({
    args: {
        projectId: v.id("projects"),
        elementId: v.id("projectItems"),
        data: v.any(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const spec = ItemSpecV2Schema.parse(args.data);
        const existing = await ctx.db
            .query("elementDrafts")
            .withIndex("by_project_element", (q) =>
                q.eq("projectId", args.projectId).eq("elementId", args.elementId)
            )
            .first();

        if (existing) {
            await ctx.db.patch(existing._id, {
                data: spec,
                updatedAt: now,
            });
            return { draftId: existing._id };
        }

        const draftId = await ctx.db.insert("elementDrafts", {
            projectId: args.projectId,
            elementId: args.elementId,
            data: spec,
            createdAt: now,
            updatedAt: now,
        });
        return { draftId };
    },
});

export const applyDraftOps = mutation({
    args: {
        projectId: v.id("projects"),
        ops: v.array(v.object({
            type: v.union(v.literal("update_existing"), v.literal("create_new")),
            elementId: v.optional(v.string()),
            snapshot: v.any(),
        })),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        let created = 0;
        let updated = 0;
        const elementIds: Array<Id<"projectItems">> = [];

        for (const op of args.ops) {
            const spec = ItemSpecV2Schema.parse(op.snapshot);
            let elementId = op.elementId;

            if (!elementId || elementId.toUpperCase().startsWith("NEW")) {
                const itemId = await ctx.db.insert("projectItems", {
                    projectId: args.projectId,
                    parentItemId: null,
                    sortKey: String(now),
                    title: spec.identity.title,
                    typeKey: spec.identity.typeKey,
                    name: spec.identity.title,
                    category: spec.identity.typeKey,
                    kind: "deliverable",
                    description: spec.identity.description,
                    searchText: buildSearchText({
                        name: spec.identity.title,
                        description: spec.identity.description,
                        typeKey: spec.identity.typeKey,
                    }),
                    status: "draft",
                    createdFrom: { source: "agent" },
                    latestRevisionNumber: 1,
                    createdAt: now,
                    updatedAt: now,
                });

                const baseSpec = buildBaseItemSpec(spec.identity.title, spec.identity.typeKey, spec.identity.description);
                await ctx.db.insert("itemRevisions", {
                    projectId: args.projectId,
                    itemId,
                    tabScope: "ideation",
                    state: "proposed",
                    revisionNumber: 1,
                    data: baseSpec,
                    createdBy: { kind: "agent" },
                    createdAt: now,
                });

                elementId = String(itemId);
                created += 1;
            } else {
                updated += 1;
            }

            const existing = await ctx.db
                .query("elementDrafts")
                .withIndex("by_project_element", (q) =>
                    q.eq("projectId", args.projectId).eq("elementId", elementId as Id<"projectItems">)
                )
                .first();

            if (existing) {
                await ctx.db.patch(existing._id, {
                    data: spec,
                    updatedAt: now,
                });
            } else {
                await ctx.db.insert("elementDrafts", {
                    projectId: args.projectId,
                    elementId: elementId as Id<"projectItems">,
                    data: spec,
                    createdAt: now,
                    updatedAt: now,
                });
            }

            elementIds.push(elementId as Id<"projectItems">);
        }

        return { created, updated, elementIds };
    },
});

export const logDraftApproval = internalMutation({
    args: {
        projectId: v.id("projects"),
        elementId: v.id("projectItems"),
        draftId: v.id("elementDrafts"),
        approvedRevisionId: v.id("itemRevisions"),
        approvedBy: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("elementDraftApprovals", {
            projectId: args.projectId,
            elementId: args.elementId,
            draftId: args.draftId,
            approvedRevisionId: args.approvedRevisionId,
            approvedAt: Date.now(),
            approvedBy: args.approvedBy,
        });
    },
});

export const deleteDraft = mutation({
    args: { draftId: v.id("elementDrafts") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.draftId);
    },
});

export const approveFromDraft = action({
    args: {
        projectId: v.id("projects"),
        draftId: v.id("elementDrafts"),
        tabScope: v.optional(
            v.union(
                v.literal("ideation"),
                v.literal("clarification"),
                v.literal("planning"),
                v.literal("solutioning"),
                v.literal("accounting"),
                v.literal("tasks"),
                v.literal("quote")
            )
        ),
    },
    handler: async (ctx, args) => {
        const data = await ctx.runQuery(api.elementDrafts.getWithApproved, {
            projectId: args.projectId,
            draftId: args.draftId,
        });
        const draft = data?.draft ?? null;
        if (!draft) {
            throw new Error("Draft not found");
        }

        const spec = parseItemSpec(draft.data);
        const tabScope = args.tabScope ?? "planning";
        const result = await ctx.runMutation(api.items.upsertRevision, {
            itemId: draft.elementId as Id<"projectItems">,
            tabScope,
            dataOrPatch: spec,
            changeReason: "Approved from draft slot.",
            createdByKind: "user",
        });

        await ctx.runMutation(api.items.approveRevision, {
            itemId: draft.elementId as Id<"projectItems">,
            revisionId: result.revisionId,
        });

        await ctx.runMutation(internal.elementDrafts.logDraftApproval, {
            projectId: args.projectId,
            elementId: draft.elementId as Id<"projectItems">,
            draftId: draft._id,
            approvedRevisionId: result.revisionId,
            approvedBy: "user",
        });

        await ctx.runMutation(api.elementDrafts.deleteDraft, { draftId: args.draftId });
        return { approvedRevisionId: result.revisionId };
    },
});
