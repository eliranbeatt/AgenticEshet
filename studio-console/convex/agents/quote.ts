import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { QuoteSchema } from "../lib/zodSchemas";
import { type Doc } from "../_generated/dataModel";

type QuoteBreakdownItem = {
    label: string;
    amount: number;
    currency: string;
    notes: string | null;
};

type QuoteDataPayload = {
    internalBreakdown: QuoteBreakdownItem[];
    totalAmount: number;
    currency: string;
    clientDocumentText: string;
};

// 1. DATA ACCESS
export const getContext: ReturnType<typeof internalQuery> = internalQuery({
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
    const quoteData = args.quoteData as QuoteDataPayload;
     // Determine version
     const existing = await ctx.db
        .query("quotes")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();
 
    const version = existing.length + 1;

    await ctx.db.insert("quotes", {
        projectId: args.projectId,
        version,
        internalBreakdownJson: JSON.stringify(quoteData.internalBreakdown),
        clientDocumentText: quoteData.clientDocumentText,
        currency: quoteData.currency,
        totalAmount: quoteData.totalAmount,
        createdAt: Date.now(),
        createdBy: "agent",
    });

    const quoteText = [
        `Currency: ${quoteData.currency}`,
        `Total: ${quoteData.totalAmount}`,
        "Breakdown:",
        ...quoteData.internalBreakdown.map((item) => `- ${item.label}: ${item.amount} ${item.currency}`),
        "",
        "Client Document:",
        quoteData.clientDocumentText,
    ].join("\n");

    const ingestArtifact = (internal as unknown as { knowledge: { ingestArtifact: unknown } }).knowledge.ingestArtifact;

    await ctx.scheduler.runAfter(0, ingestArtifact, {
        projectId: args.projectId,
        sourceType: "quote",
        sourceRefId: `quote-v${version}`,
        title: `Quote v${version}`,
        text: quoteText,
        summary: quoteData.clientDocumentText.slice(0, 500),
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

export const runInBackground: ReturnType<typeof internalAction> = internalAction({
  args: {
    projectId: v.id("projects"),
    instructions: v.optional(v.string()),
    agentRunId: v.optional(v.id("agentRuns")),
  },
  handler: async (ctx, args) => {
    const agentRunId = args.agentRunId;

    if (agentRunId) {
        await ctx.runMutation(internal.agentRuns.setStatus, {
            runId: agentRunId,
            status: "running",
            stage: "loading_context",
        });
        await ctx.runMutation(internal.agentRuns.appendEvent, {
            runId: agentRunId,
            level: "info",
            message: "Loading project context and tasks for quoting.",
            stage: "loading_context",
        });
    }

    try {
        const { project, tasks, systemPrompt } = await ctx.runQuery(internal.agents.quote.getContext, {
          projectId: args.projectId,
        });

        if (agentRunId) {
            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId: agentRunId,
                level: "info",
                message: "Searching knowledge base for pricing references.",
                stage: "knowledge_search",
            });
        }

        const knowledgeDocs = await ctx.runAction(api.knowledge.dynamicSearch, {
            projectId: args.projectId,
            query: [args.instructions || "", project.clientName, project.details.notes || ""].join("\n"),
            scope: "both",
            sourceTypes: ["quote", "task", "doc_upload", "plan"],
            limit: 8,
            agentRole: "quote_agent",
            includeSummaries: true,
        });

    const taskSummary = tasks
        .map((task: Doc<"tasks">) => `- ${task.title} [${task.category}/${task.priority}]`)
        .join("\n");

    const knowledgeSummary = knowledgeDocs.length
        ? knowledgeDocs
              .map((entry: { doc: { sourceType: string; title: string; summary?: string; keyPoints?: string[] }; text?: string }) => {
                  const keyPoints = Array.isArray(entry.doc.keyPoints) && entry.doc.keyPoints.length > 0
                      ? ` Key points: ${entry.doc.keyPoints.slice(0, 6).join("; ")}`
                      : "";
                  const base = (entry.doc.summary ?? entry.text?.slice(0, 200) ?? "").trim();
                  return `- [${entry.doc.sourceType}] ${entry.doc.title}: ${base}${keyPoints}`;
              })
              .join("\n")
        : "No pricing references available.";

    const userPrompt = `Project: ${project.name}
Details: ${JSON.stringify(project.details)}
Tasks/Scope:
${taskSummary}

Pricing Intelligence:
${knowledgeSummary}

User Instructions: ${args.instructions || "Generate initial quote based on known scope."}

Always include a currency field (ILS by default) and ensure the internal breakdown matches the total amount.`;

        if (agentRunId) {
            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId: agentRunId,
                level: "info",
                message: "Calling model to generate quote breakdown.",
                stage: "llm_call",
            });
        }

        const result = await callChatWithSchema(QuoteSchema, {
          systemPrompt,
          userPrompt,
        });

        if (agentRunId) {
            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId: agentRunId,
                level: "info",
                message: "Saving generated quote.",
                stage: "persisting",
            });
        }

        await ctx.runMutation(internal.agents.quote.saveQuote, {
          projectId: args.projectId,
          quoteData: result,
        });

        if (agentRunId) {
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId: agentRunId,
                status: "succeeded",
                stage: "done",
            });
        }

        return result;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (agentRunId) {
            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId: agentRunId,
                level: "error",
                message,
                stage: "failed",
            });
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId: agentRunId,
                status: "failed",
                stage: "failed",
                error: message,
            });
        }
        throw error;
    }
  },
});

// 2. AGENT ACTION
export const run: ReturnType<typeof action> = action({
  args: {
    projectId: v.id("projects"),
    instructions: v.optional(v.string()), // e.g. "Add travel expenses"
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.agents.quote.getContext, { projectId: args.projectId });

    const agentRunId = await ctx.runMutation(internal.agentRuns.createRun, {
        projectId: args.projectId,
        agent: "quote",
        stage: "queued",
        initialMessage: "Queued quote generation.",
    });

    await ctx.scheduler.runAfter(0, internal.agents.quote.runInBackground, {
        projectId: args.projectId,
        instructions: args.instructions,
        agentRunId,
    });

    return { queued: true, runId: agentRunId };
  },
});
