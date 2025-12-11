import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { ClarificationSchema } from "../lib/zodSchemas";

// 1. DATA ACCESS: Get context for the agent
export const getContext = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");

    const skill = await ctx.db
      .query("skills")
      .withIndex("by_name", (q) => q.eq("name", "clarification"))
      .first();

    const planningPlans = await ctx.db
      .query("plans")
      .withIndex("by_project_phase", (q) =>
        q.eq("projectId", args.projectId).eq("phase", "planning")
      )
      .order("desc")
      .collect();
    const activePlan = planningPlans.find((plan) => plan.isActive);

    const recentClarifications = await ctx.db
      .query("conversations")
      .withIndex("by_project_phase", (q) =>
        q.eq("projectId", args.projectId).eq("phase", "clarification")
      )
      .order("desc")
      .take(3);

    const knowledgeDocs = await ctx.runQuery(internal.knowledge.getContextDocs, {
      projectId: args.projectId,
      limit: 3,
    });

    return {
      project,
      systemPrompt: skill?.content || "You are a helpful project assistant.",
      activePlan,
      recentClarifications,
      knowledgeDocs,
    };
  },
});

// 2. DATA ACCESS: Save the agent's output
export const saveResult = internalMutation({
  args: {
    projectId: v.id("projects"),
    messages: v.array(v.object({ role: v.string(), content: v.string() })),
    response: v.any(), // ClarificationSchema result
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);

    // Log the conversation
    const conversationId = await ctx.db.insert("conversations", {
      projectId: args.projectId,
      phase: "clarification",
      agentRole: "clarification_agent",
      messagesJson: JSON.stringify(args.messages),
      createdAt: Date.now(),
    });

    if (args.response.briefSummary) {
        await ctx.db.patch(args.projectId, {
            overviewSummary: args.response.briefSummary,
        });
    }

    const clarifications = await ctx.db
        .query("plans")
        .withIndex("by_project_phase", (q) =>
            q.eq("projectId", args.projectId).eq("phase", "clarification")
        )
        .collect();

    const summaryMarkdown = [
        "## Clarification Summary",
        args.response.briefSummary,
        "",
        "## Open Questions",
        args.response.openQuestions.length
            ? args.response.openQuestions.map((q) => `- ${q}`).join("\n")
            : "- No open questions",
        "",
        `Suggested next phase: ${args.response.suggestedNextPhase}`,
    ].join("\n");

    await ctx.db.insert("plans", {
        projectId: args.projectId,
        version: clarifications.length + 1,
        phase: "clarification",
        isDraft: true,
        isActive: false,
        contentMarkdown: summaryMarkdown,
        reasoning: args.response.suggestedNextPhase,
        createdAt: Date.now(),
        createdBy: "agent",
    });

    const conversationText = args.messages
        .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
        .join("\n");

    await ctx.scheduler.runAfter(0, internal.knowledge.ingestArtifact, {
        projectId: args.projectId,
        sourceType: "conversation",
        sourceRefId: conversationId,
        title: `Clarification Conversation ${new Date().toISOString()}`,
        text: conversationText,
        summary: args.response.briefSummary || "Clarification summary",
        tags: ["conversation", "clarification"],
        topics: [],
        phase: "clarification",
        clientName: project?.clientName,
    });
  },
});

// 3. AGENT ACTION: Main entry point
export const run = action({
  args: {
    projectId: v.id("projects"),
    chatHistory: v.array(v.object({ role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")), content: v.string() })),
  },
  handler: async (ctx, args) => {
    // 1. Get Context
    const { project, systemPrompt, activePlan, recentClarifications } = await ctx.runQuery(internal.agents.clarification.getContext, {
      projectId: args.projectId,
    });

    const knowledgeResults = await ctx.runAction(internal.knowledge.dynamicSearch, {
        projectId: args.projectId,
        query: args.chatHistory.map((m) => m.content).join("\n").slice(0, 500) || project.details.notes || project.name,
        scope: "both",
        sourceTypes: ["conversation", "plan", "doc_upload"],
        limit: 6,
        agentRole: "clarification_agent",
        includeSummaries: true,
    });

    const planSnippet = activePlan
        ? activePlan.contentMarkdown.slice(0, 1500)
        : "No approved plan yet.";

    const previousClarifications = recentClarifications
        .map((conversation) => {
            try {
                const parsed = JSON.parse(conversation.messagesJson) as { role: string; content: string }[];
                const assistant = parsed.reverse().find((message) => message.role === "assistant");
                return `- ${new Date(conversation.createdAt).toLocaleDateString()}: ${assistant?.content ?? "No recorded assistant response."}`;
            } catch {
                return `- ${new Date(conversation.createdAt).toLocaleDateString()}: (unable to parse conversation log)`;
            }
        })
        .join("\n");

    const knowledgeSummary = knowledgeResults.length
        ? knowledgeResults.map((doc) => `- [${doc.doc.sourceType}] ${doc.doc.title}: ${doc.doc.summary ?? doc.text?.slice(0, 200)}`).join("\n")
        : "- No knowledge documents available.";

    const userPrompt = [
        `Project: ${project.name}`,
        `Client: ${project.clientName}`,
        `Current Notes: ${project.details.notes || "N/A"}`,
        `Existing Summary: ${project.overviewSummary || "No summary captured yet."}`,
        "",
        `Active Plan Snapshot:\n${planSnippet}`,
        "",
        "Recent Clarification Interactions:",
        previousClarifications || "- None recorded",
        "",
        "Knowledge Documents:",
        knowledgeSummary,
        "",
        "Live chat history from the user follows. Provide a structured clarification summary and list of open questions based on everything you know.",
    ].join("\n");

    // 3. Call AI
    const result = await callChatWithSchema(ClarificationSchema, {
      systemPrompt,
      userPrompt,
      additionalMessages: args.chatHistory,
    });

    // 4. Save Result
    await ctx.runMutation(internal.agents.clarification.saveResult, {
      projectId: args.projectId,
      messages: [...args.chatHistory, { role: "assistant", content: JSON.stringify(result) }],
      response: result,
    });

    return result;
  },
});
