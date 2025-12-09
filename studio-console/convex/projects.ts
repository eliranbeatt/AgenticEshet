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
        overviewSummary: v.optional(v.string()),
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

export const setPlanActive = mutation({
    args: {
        projectId: v.id("projects"),
        planId: v.id("plans"),
    },
    handler: async (ctx, args) => {
        const plan = await ctx.db.get(args.planId);
        if (!plan) {
            throw new Error("Plan not found");
        }
        if (plan.projectId !== args.projectId) {
            throw new Error("Plan does not belong to this project");
        }

        const plans = await ctx.db
            .query("plans")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        await Promise.all(
            plans.map(async (p) => {
                const isSelected = p._id === args.planId;
                await ctx.db.patch(p._id, {
                    isActive: isSelected,
                    isDraft: isSelected ? false : p.isDraft,
                });
            })
        );
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

export const getPlanPhaseMeta = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const plans = await ctx.db
            .query("plans")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .collect();

        const activePlan = plans.find((plan) => plan.isActive);
        const latestPlan = plans[0];
        const draftCount = plans.filter((plan) => plan.isDraft).length;

        return {
            activePlan: activePlan
                ? {
                      planId: activePlan._id,
                      version: activePlan.version,
                      approvedAt: activePlan.createdAt,
                  }
                : null,
            latestPlan: latestPlan
                ? {
                      planId: latestPlan._id,
                      version: latestPlan.version,
                      isDraft: latestPlan.isDraft,
                  }
                : null,
            totalPlans: plans.length,
            draftCount,
        };
    },
});
