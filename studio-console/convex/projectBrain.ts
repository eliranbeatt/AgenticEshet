import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";

type Bullet = {
    id: string;
    text: string;
    tags?: string[];
    status: "accepted" | "proposed" | "tombstoned";
    confidence: "high" | "medium" | "low";
    source: { eventId: string; type: string; ref?: string };
    locked?: boolean;
    createdAt: number;
    updatedAt: number;
};

function randomId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function emptyBrain(projectId: string) {
    return {
        projectId,
        version: 1,
        updatedAt: Date.now(),
        project: {
            overview: [] as Bullet[],
            preferences: [] as Bullet[],
            constraints: [] as Bullet[],
            timeline: [] as Bullet[],
            stakeholders: [] as Bullet[],
        },
        elementNotes: {} as Record<string, { notes: Bullet[]; conflicts: any[] }>,
        unmapped: [] as Bullet[],
        conflicts: [] as any[],
        recentUpdates: [] as any[],
    };
}

export const getCurrent = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("projectBrains")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .unique();
    },
});

export const ensure = internalMutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("projectBrains")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .unique();
        if (existing) return { id: existing._id };

        const brain = emptyBrain(args.projectId);
        const id = await ctx.db.insert("projectBrains", brain);
        return { id };
    },
});

export const initEmpty = mutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("projectBrains")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .unique();
        if (existing) return { id: existing._id };
        const brain = emptyBrain(args.projectId);
        const id = await ctx.db.insert("projectBrains", brain);
        return { id };
    },
});

export const saveManualEdit = mutation({
    args: {
        projectId: v.id("projects"),
        brain: v.any(),
        expectedVersion: v.number(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("projectBrains")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .unique();
        if (!existing) throw new Error("ProjectBrain not found");
        if ((existing.version ?? 0) !== args.expectedVersion) {
            throw new Error("ProjectBrain version mismatch");
        }

        const now = Date.now();
        const next = {
            ...args.brain,
            projectId: args.projectId,
            version: args.expectedVersion + 1,
            updatedAt: now,
        };

        await ctx.db.patch(existing._id, next);
        return { ok: true, version: next.version };
    },
});

export const replace = internalMutation({
    args: {
        projectId: v.id("projects"),
        brain: v.any(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("projectBrains")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .unique();

        const now = Date.now();
        const next = {
            ...args.brain,
            projectId: args.projectId,
            version: (args.brain?.version ?? 0) || (existing?.version ?? 0) || 0,
            updatedAt: now,
        };

        if (existing) {
            await ctx.db.patch(existing._id, next);
            return { id: existing._id };
        }

        const id = await ctx.db.insert("projectBrains", next);
        return { id };
    },
});

export const markNotesCoveredByApproved = internalMutation({
    args: {
        projectId: v.id("projects"),
        elementId: v.id("projectItems"),
        digestText: v.string(),
    },
    handler: async (ctx, args) => {
        const brain = await ctx.db
            .query("projectBrains")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .unique();
        if (!brain) return { updated: false };

        const elementNotes = brain.elementNotes ?? {};
        const entry = elementNotes[args.elementId];
        if (!entry?.notes || entry.notes.length === 0) return { updated: false };

        const digest = args.digestText.toLowerCase();
        const now = Date.now();
        let changed = false;

        const nextNotes = entry.notes.map((note: any) => {
            if (!note?.text) return note;
            const text = String(note.text);
            const covered = digest.includes(text.toLowerCase());
            if (!covered) return note;
            const tags = Array.isArray(note.tags) ? note.tags : [];
            if (tags.includes("covered_by_approved")) return note;
            changed = true;
            return {
                ...note,
                tags: [...tags, "covered_by_approved"],
                updatedAt: now,
            };
        });

        if (!changed) return { updated: false };

        elementNotes[args.elementId] = { ...entry, notes: nextNotes };
        await ctx.db.patch(brain._id, {
            elementNotes,
            version: (brain.version ?? 0) + 1,
            updatedAt: now,
        });

        return { updated: true };
    },
});

export const newBullet = internalMutation({
    args: {
        projectId: v.id("projects"),
        text: v.string(),
        sourceType: v.string(),
        sourceEventId: v.string(),
        confidence: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
    },
    handler: async (_ctx, args) => {
        const now = Date.now();
        const bullet: Bullet = {
            id: randomId("bullet"),
            text: args.text,
            status: "accepted",
            confidence: args.confidence ?? "medium",
            source: { eventId: args.sourceEventId, type: args.sourceType },
            createdAt: now,
            updatedAt: now,
        };
        return bullet;
    },
});
