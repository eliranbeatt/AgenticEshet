import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { PlanSchema } from "../lib/zodSchemas";

// 1. DATA ACCESS
export const getContext = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");

    const skill = await ctx.db
      .query("skills")
      .withIndex("by_name", (q) => q.eq("name", "planning"))
      .first();

    // Get existing plans to provide context on previous versions?
    const existingPlans = await ctx.db
        .query("plans")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();

    return {
      project,
      systemPrompt: skill?.content || "You are an expert planner.",
      existingPlans,
    };
  },
});

// 2. DATA ACCESS
export const saveResult = internalMutation({
  args: {
    projectId: v.id("projects"),
    userRequest: v.string(),
    planData: v.any(), // PlanSchema
  },
  handler: async (ctx, args) => {
    // Determine version
    const existing = await ctx.db
        .query("plans")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();
    
    const version = existing.length + 1;

    // Create new Draft Plan
    const planId = await ctx.db.insert("plans", {
      projectId: args.projectId,
      version,
      phase: "planning", // default for this agent
      isDraft: true,
      isActive: false,
      contentMarkdown: args.planData.contentMarkdown,
      reasoning: args.planData.reasoning,
      createdAt: Date.now(),
      createdBy: "agent",
    });

    await ctx.db.insert("conversations", {
      projectId: args.projectId,
      phase: "planning",
      agentRole: "planning_agent",
      messagesJson: JSON.stringify([
        { role: "user", content: args.userRequest },
        { role: "assistant", content: args.planData.contentMarkdown },
      ]),
      createdAt: Date.now(),
    });

    return planId;
  },
});

// 3. AGENT ACTION
export const run = action({
  args: {
    projectId: v.id("projects"),
    userRequest: v.string(), // e.g. "Create initial plan" or "Refine timeline"
  },
  handler: async (ctx, args) => {
    const { project, systemPrompt, existingPlans } = await ctx.runQuery(internal.agents.planning.getContext, {
      projectId: args.projectId,
    });

    const context = `Project: ${project.name}
Details: ${JSON.stringify(project.details)}
Existing Plans Count: ${existingPlans.length}

User Request: ${args.userRequest}`;

    const result = await callChatWithSchema(PlanSchema, {
      systemPrompt,
      userPrompt: context,
    });

    await ctx.runMutation(internal.agents.planning.saveResult, {
      projectId: args.projectId,
      userRequest: args.userRequest,
      planData: result,
    });

    return result;
  },
});
