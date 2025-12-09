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

    return {
      project,
      systemPrompt: skill?.content || "You are a helpful project assistant.",
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
    // Log the conversation
    await ctx.db.insert("conversations", {
      projectId: args.projectId,
      phase: "clarification",
      agentRole: "clarification_agent",
      messagesJson: JSON.stringify(args.messages),
      createdAt: Date.now(),
    });

    // Update project notes or status if needed? 
    // For now, we mainly want to return the structured response to the UI.
    // But we might want to store the "brief summary" back into the project details?
    if (args.response.briefSummary) {
        // Optional: auto-update notes if empty? 
        // Let's leave that to a specific user approval action.
    }
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
    const { project, systemPrompt } = await ctx.runQuery(internal.agents.clarification.getContext, {
      projectId: args.projectId,
    });

    // 2. Prepare Prompt
    const userPrompt = `Project: ${project.name}
Client: ${project.clientName}
Current Notes: ${project.details.notes || "N/A"}

Latest User Input: (See chat history)`;

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
