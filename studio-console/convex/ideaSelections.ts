import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const createSelection = mutation({
    args: {
        projectId: v.id("projects"),
        conceptCardIds: v.array(v.id("ideationConceptCards")),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        if (args.conceptCardIds.length === 0) {
            throw new Error("Select at least one idea.");
        }
        const now = Date.now();
        const selectionId = await ctx.db.insert("ideaSelections", {
            projectId: args.projectId,
            conceptCardIds: args.conceptCardIds,
            notes: args.notes,
            status: "pending",
            createdAt: now,
            createdBy: "user",
            updatedAt: now,
        });
        return selectionId;
    },
});

export const listSelections = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("ideaSelections")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .collect();
    },
});

export const markConverted = mutation({
    args: {
        selectionId: v.id("ideaSelections"),
        changeSetId: v.id("itemChangeSets"),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.selectionId, {
            status: "converted",
            changeSetId: args.changeSetId,
            updatedAt: Date.now(),
        });
    },
});

export const markFailed = mutation({
    args: { selectionId: v.id("ideaSelections") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.selectionId, {
            status: "failed",
            updatedAt: Date.now(),
        });
    },
});
