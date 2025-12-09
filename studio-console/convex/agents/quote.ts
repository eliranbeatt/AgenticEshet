import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { QuoteSchema } from "../lib/zodSchemas";

// 1. DATA ACCESS
export const getContext = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");

    // Get tasks to base the quote on
    const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();

    const skill = await ctx.db
      .query("skills")
      .withIndex("by_name", (q) => q.eq("name", "quote")) 
      .first();

    return {
      project,
      tasks,
      systemPrompt: skill?.content || "You are a Cost Estimator.",
    };
  },
});

export const saveQuote = internalMutation({
  args: {
    projectId: v.id("projects"),
    quoteData: v.any(), // QuoteSchema
  },
  handler: async (ctx, args) => {
     // Determine version
     const existing = await ctx.db
        .query("quotes")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();
 
    const version = existing.length + 1;

    await ctx.db.insert("quotes", {
        projectId: args.projectId,
        version,
        internalBreakdownJson: JSON.stringify(args.quoteData.internalBreakdown),
        clientDocumentText: args.quoteData.clientDocumentText,
        createdAt: Date.now(),
        createdBy: "agent",
    });
  },
});

export const listQuotes = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("quotes")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .order("desc") // newest first
            .collect();
    }
});

// 2. AGENT ACTION
export const run = action({
  args: {
    projectId: v.id("projects"),
    instructions: v.optional(v.string()), // e.g. "Add travel expenses"
  },
  handler: async (ctx, args) => {
    const { project, tasks, systemPrompt } = await ctx.runQuery(internal.agents.quote.getContext, {
      projectId: args.projectId,
    });

    const userPrompt = `Project: ${project.name}
Details: ${JSON.stringify(project.details)}
Tasks/Scope: ${JSON.stringify(tasks.map(t => ({ title: t.title, category: t.category })))}

User Instructions: ${args.instructions || "Generate initial quote based on known scope."}`;

    const result = await callChatWithSchema(QuoteSchema, {
      systemPrompt,
      userPrompt,
    });

    await ctx.runMutation(internal.agents.quote.saveQuote, {
      projectId: args.projectId,
      quoteData: result,
    });

    return result;
  },
});
