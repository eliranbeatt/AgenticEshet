import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { applyBrainPatchOps } from "./lib/brainPatch";

export const get = internalQuery({
    args: { eventId: v.id("brainEvents") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.eventId);
    },
});

export const create = internalMutation({
    args: {
        projectId: v.id("projects"),
        eventType: v.union(
            v.literal("structured_submit"),
            v.literal("agent_send"),
            v.literal("file_ingested"),
            v.literal("manual_add"),
            v.literal("manual_structured_edit")
        ),
        payload: v.any(),
    },
    handler: async (ctx, args) => {
        await ctx.runMutation(internal.projectBrain.ensure, { projectId: args.projectId });
        const brain = await ctx.db
            .query("projectBrains")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .unique();
        if (!brain) throw new Error("ProjectBrain missing after ensure");

        return await ctx.db.insert("brainEvents", {
            projectId: args.projectId,
            eventType: args.eventType,
            payload: args.payload,
            brainVersionAtStart: brain.version ?? 0,
            status: "queued",
            createdAt: Date.now(),
        });
    },
});

export const apply = internalMutation({
    args: {
        eventId: v.id("brainEvents"),
        patchOps: v.array(v.any()),
        runSummary: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const event = await ctx.db.get(args.eventId);
        if (!event) throw new Error("BrainEvent not found");

        const brain = await ctx.db
            .query("projectBrains")
            .withIndex("by_project", (q) => q.eq("projectId", event.projectId))
            .unique();
        if (!brain) throw new Error("ProjectBrain not found");

        if ((brain.version ?? 0) !== event.brainVersionAtStart) {
            await ctx.db.patch(event._id, {
                status: "conflict_retry",
                error: "Brain version changed before apply",
            });
            return { status: "conflict_retry" as const };
        }

        const nextBrain = applyBrainPatchOps({
            brain,
            patchOps: args.patchOps,
            eventId: event._id,
            eventType: event.eventType,
        });

        await ctx.db.patch(brain._id, nextBrain);
        await ctx.db.patch(event._id, {
            status: "applied",
            patchOps: args.patchOps,
            appliedAt: Date.now(),
            error: undefined,
        });

        return { status: "applied" as const };
    },
});

export const resetForRetry = internalMutation({
    args: { eventId: v.id("brainEvents") },
    handler: async (ctx, args) => {
        const event = await ctx.db.get(args.eventId);
        if (!event) throw new Error("BrainEvent not found");

        const brain = await ctx.db
            .query("projectBrains")
            .withIndex("by_project", (q) => q.eq("projectId", event.projectId))
            .unique();
        if (!brain) throw new Error("ProjectBrain not found");

        await ctx.db.patch(event._id, {
            brainVersionAtStart: brain.version ?? 0,
            status: "queued",
            error: undefined,
        });

        return { ok: true };
    },
});
