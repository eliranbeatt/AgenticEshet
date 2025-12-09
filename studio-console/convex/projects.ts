import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const listProjects = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("projects").collect();
    },
});

export const getProject = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.projectId);
    },
});

export const createProject = mutation({
    args: {
        name: v.string(),
        clientName: v.string(),
        details: v.object({
            eventDate: v.optional(v.string()),
            budgetCap: v.optional(v.number()),
            location: v.optional(v.string()),
            notes: v.optional(v.string()),
        }),
    },
    handler: async (ctx, args) => {
        const projectId = await ctx.db.insert("projects", {
            name: args.name,
            clientName: args.clientName,
            status: "lead",
            details: args.details,
            createdAt: Date.now(),
            createdBy: "user", // TODO: auth
        });
        return projectId;
    },
});

export const updateProject = mutation({
    args: {
        projectId: v.id("projects"),
        name: v.optional(v.string()),
        clientName: v.optional(v.string()),
        status: v.optional(
            v.union(
                v.literal("lead"),
                v.literal("planning"),
                v.literal("production"),
                v.literal("archived")
            )
        ),
        details: v.optional(
            v.object({
                eventDate: v.optional(v.string()),
                budgetCap: v.optional(v.number()),
                location: v.optional(v.string()),
                notes: v.optional(v.string()),
            })
        ),
    },
    handler: async (ctx, args) => {
        const { projectId, ...patches } = args;
        await ctx.db.patch(projectId, patches);
    },
});

export const getPlans = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("plans")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .collect();
    },
});
