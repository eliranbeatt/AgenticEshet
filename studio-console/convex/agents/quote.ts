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

    const knowledgeDocs = await ctx.runQuery(internal.knowledge.getContextDocs, {
        projectId: args.projectId,
        limit: 3,
        tagFilter: ["pricing", "budget", "rates"],
    });

    return {
      project,
      tasks,
      knowledgeDocs,
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
    const project = await ctx.db.get(args.projectId);
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
        currency: args.quoteData.currency,
        totalAmount: args.quoteData.totalAmount,
        createdAt: Date.now(),
        createdBy: "agent",
    });

    const quoteText = [
        `Currency: ${args.quoteData.currency}`,
        `Total: ${args.quoteData.totalAmount}`,
        "Breakdown:",
        ...args.quoteData.internalBreakdown.map((item: any) => `- ${item.label}: ${item.amount} ${item.currency}`),
        "",
        "Client Document:",
        args.quoteData.clientDocumentText,
    ].join("\n");

    await ctx.scheduler.runAfter(0, internal.knowledge.ingestArtifact, {
        projectId: args.projectId,
        sourceType: "quote",
        sourceRefId: `quote-v${version}`,
        title: `Quote v${version}`,
        text: quoteText,
        summary: args.quoteData.clientDocumentText.slice(0, 500),
        tags: ["quote", "pricing"],
        topics: [],
        clientName: project?.clientName,
        domain: "pricing",
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

    const knowledgeDocs = await ctx.runAction(internal.knowledge.dynamicSearch, {
        projectId: args.projectId,
        query: [args.instructions || "", project.clientName, project.details.notes || ""].join("\n"),
        scope: "both",
        sourceTypes: ["quote", "task", "doc_upload", "plan"],
        limit: 8,
        agentRole: "quote_agent",
        includeSummaries: true,
    });

    const taskSummary = tasks
        .map((task) => `- ${task.title} [${task.category}/${task.priority}]`)
        .join("\n");

    const knowledgeSummary = knowledgeDocs.length
        ? knowledgeDocs.map((doc) => `- [${doc.doc.sourceType}] ${doc.doc.title}: ${doc.doc.summary ?? doc.text?.slice(0, 200)}`).join("\n")
        : "No pricing references available.";

    const userPrompt = `Project: ${project.name}
Details: ${JSON.stringify(project.details)}
Tasks/Scope:
${taskSummary}

Pricing Intelligence:
${knowledgeSummary}

User Instructions: ${args.instructions || "Generate initial quote based on known scope."}

Always include a currency field (ILS by default) and ensure the internal breakdown matches the total amount.`;

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
