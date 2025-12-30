import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getCurrent = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("projectKnowledge")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .unique();
    },
});

export const listLog = query({
    args: { projectId: v.id("projects"), limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const entries = await ctx.db
            .query("knowledgeLogEntries")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .take(args.limit ?? 50);
        return entries;
    },
});

export const updateCurrent = mutation({
    args: {
        projectId: v.id("projects"),
        currentText: v.string(),
        preferencesText: v.optional(v.string()),
        updatedBy: v.string(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("projectKnowledge")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .unique();

        const now = Date.now();
        if (existing) {
            await ctx.db.patch(existing._id, {
                currentText: args.currentText,
                preferencesText: args.preferencesText,
                updatedAt: now,
                updatedBy: args.updatedBy,
            });
            return { id: existing._id };
        }

        const id = await ctx.db.insert("projectKnowledge", {
            projectId: args.projectId,
            currentText: args.currentText,
            preferencesText: args.preferencesText,
            updatedAt: now,
            updatedBy: args.updatedBy,
        });
        return { id };
    },
});

export const appendLog = mutation({
    args: {
        projectId: v.id("projects"),
        text: v.string(),
        source: v.union(
            v.literal("ingestion"),
            v.literal("user_chat"),
            v.literal("agent_summary")
        ),
        linkedDocId: v.optional(v.id("knowledgeDocs")),
        linkedMessageId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const id = await ctx.db.insert("knowledgeLogEntries", {
            projectId: args.projectId,
            createdAt: Date.now(),
            source: args.source,
            text: args.text,
            linkedDocId: args.linkedDocId,
            linkedMessageId: args.linkedMessageId,
        });
        return { id };
    },
});
