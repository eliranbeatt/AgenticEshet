import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { ItemSpecV2Schema } from "./lib/zodSchemas";
import { parseItemSpec } from "./lib/itemHelpers";
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
        const draft = await ctx.db.get(args.draftId);
        if (!draft || draft.projectId !== args.projectId) {
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

        await ctx.db.delete(args.draftId);
        return { approvedRevisionId: result.revisionId };
    },
});
