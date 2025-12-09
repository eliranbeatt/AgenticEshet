import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { TaskBreakdownSchema } from "../lib/zodSchemas";

// 1. DATA ACCESS
export const getContext = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");

    // Get the latest ACTIVE or DRAFT plan
    const plans = await ctx.db
        .query("plans")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .order("desc")
        .take(1);
    
    const latestPlan = plans[0];

    const skill = await ctx.db
      .query("skills")
      .withIndex("by_name", (q) => q.eq("name", "architect")) // We might need to seed this skill
      .first();

    return {
      project,
      latestPlan,
      systemPrompt: skill?.content || "You are a Senior Solutions Architect.",
    };
  },
});

export const saveTasks = internalMutation({
  args: {
    projectId: v.id("projects"),
    tasks: v.array(v.object({
        title: v.string(),
        description: v.string(),
        category: v.union(v.literal("Logistics"), v.literal("Creative"), v.literal("Finance"), v.literal("Admin"), v.literal("Studio")),
        priority: v.union(v.literal("High"), v.literal("Medium"), v.literal("Low")),
    })),
  },
  handler: async (ctx, args) => {
    // For now, we just append. In future, we might want to dedupe.
    for (const t of args.tasks) {
        await ctx.db.insert("tasks", {
            projectId: args.projectId,
            title: t.title,
            description: t.description,
            category: t.category,
            priority: t.priority,
            status: "todo",
            source: "agent",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    }
  },
});

// 2. AGENT ACTION
export const run = action({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const { project, latestPlan, systemPrompt } = await ctx.runQuery(internal.agents.architect.getContext, {
      projectId: args.projectId,
    });

    if (!latestPlan) {
        throw new Error("No plan found. Please generate a plan first.");
    }

    const userPrompt = `Project: ${project.name}
    
Plan Content:
${latestPlan.contentMarkdown}

Task: Break down this plan into actionable, atomic tasks. Focus on the immediate next steps implied by the plan.`;

    const result = await callChatWithSchema(TaskBreakdownSchema, {
      systemPrompt,
      userPrompt,
    });

    await ctx.runMutation(internal.agents.architect.saveTasks, {
      projectId: args.projectId,
      tasks: result.tasks,
    });

    return result;
  },
});
