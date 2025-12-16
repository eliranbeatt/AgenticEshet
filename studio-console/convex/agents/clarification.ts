import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { ClarificationSchema } from "../lib/zodSchemas";
import { type Doc } from "../_generated/dataModel";

function formatAssistantMessage(result: { openQuestions?: string[] }) {
    if (result.openQuestions && result.openQuestions.length > 0) {
        return "**Open questions:**\n" + result.openQuestions.map((q) => `- ${q}`).join("\n");
    }
    return "No open questions detected.";
}

export const getContext: ReturnType<typeof internalQuery> = internalQuery({
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
            .withIndex("by_project_phase", (q) => q.eq("projectId", args.projectId).eq("phase", "planning"))
            .order("desc")
            .collect();
        const activePlan = planningPlans.find((plan) => plan.isActive);

        const recentClarifications = await ctx.db
            .query("conversations")
            .withIndex("by_project_phase", (q) => q.eq("projectId", args.projectId).eq("phase", "clarification"))
            .order("desc")
            .take(3);

        const knowledgeDocs = await ctx.runQuery(internal.knowledge.getContextDocs, {
            projectId: args.projectId,
            limit: 8,
            sourceTypes: ["doc_upload"],
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

export const saveResult = internalMutation({
    args: {
        projectId: v.id("projects"),
        conversationId: v.optional(v.id("conversations")),
        messages: v.array(v.object({ role: v.string(), content: v.string() })),
        response: v.any(),
    },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);

        const createdAt = Date.now();
        const conversationId = args.conversationId
            ? args.conversationId
            : await ctx.db.insert("conversations", {
                  projectId: args.projectId,
                  phase: "clarification",
                  agentRole: "clarification_agent",
                  messagesJson: JSON.stringify(args.messages),
                  createdAt,
              });

        if (args.conversationId) {
            await ctx.db.patch(conversationId, {
                messagesJson: JSON.stringify(args.messages),
            });
        }

        if (args.response.briefSummary) {
            await ctx.db.patch(args.projectId, {
                overviewSummary: args.response.briefSummary,
            });
        }

        const clarifications = await ctx.db
            .query("plans")
            .withIndex("by_project_phase", (q) => q.eq("projectId", args.projectId).eq("phase", "clarification"))
            .collect();

        const summaryMarkdown = [
            "## Clarification summary",
            args.response.briefSummary,
            "",
            "## Open questions",
            args.response.openQuestions.length
                ? args.response.openQuestions.map((q: string) => `- ${q}`).join("\n")
                : "- No open questions.",
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

export const runInBackground: ReturnType<typeof internalAction> = internalAction({
    args: {
        projectId: v.id("projects"),
        conversationId: v.id("conversations"),
        chatHistory: v.array(v.object({ role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")), content: v.string() })),
        agentRunId: v.optional(v.id("agentRuns")),
        thinkingMode: v.optional(v.boolean()),
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
                message: "Loading context for clarification.",
                stage: "loading_context",
            });
        }

        try {
            const { project, systemPrompt, activePlan, recentClarifications, knowledgeDocs } = await ctx.runQuery(
                internal.agents.clarification.getContext,
                { projectId: args.projectId }
            );

            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: agentRunId,
                    level: "info",
                    message: "Searching knowledge base for clarification context.",
                    stage: "knowledge_search",
                });
            }

            const knowledgeResults = await ctx.runAction(api.knowledge.dynamicSearch, {
                projectId: args.projectId,
                query:
                    args.chatHistory.map((m) => m.content).join("\n").slice(0, 500) ||
                    project.details.notes ||
                    project.name,
                scope: "both",
                sourceTypes: ["conversation", "plan", "doc_upload"],
                limit: 6,
                agentRole: "clarification_agent",
                includeSummaries: true,
            });

            const planSnippet = activePlan ? activePlan.contentMarkdown.slice(0, 1500) : "No approved plan yet.";

            const previousClarifications = recentClarifications
                .map((conversation: Doc<"conversations">) => {
                    try {
                        const parsed = JSON.parse(conversation.messagesJson) as { role: string; content: string }[];
                        const assistant = parsed.reverse().find((message) => message.role === "assistant");
                        return `- ${new Date(conversation.createdAt).toLocaleDateString()}: ${assistant?.content ?? "No recorded assistant response."}`;
                    } catch {
                        return `- ${new Date(conversation.createdAt).toLocaleDateString()}: (unable to parse conversation log)`;
                    }
                })
                .join("\n");

            const uploadedDocsSummary = knowledgeDocs && knowledgeDocs.length > 0
                ? knowledgeDocs
                      .map((doc: { sourceType?: string; title: string; summary?: string; keyPoints?: string[] }) => {
                          const keyPoints =
                              Array.isArray(doc.keyPoints) && doc.keyPoints.length > 0
                                  ? ` Key points: ${doc.keyPoints.slice(0, 6).join("; ")}`
                                  : "";
                          return `- [doc_upload] ${doc.title}: ${(doc.summary ?? "").slice(0, 400)}${keyPoints}`;
                      })
                      .join("\n")
                : "- No uploaded documents ready yet.";

            const knowledgeSummary = knowledgeResults.length
                ? knowledgeResults
                      .map((entry: { doc: { sourceType: string; title: string; summary?: string; keyPoints?: string[] }; text?: string }) => {
                          const keyPoints =
                              Array.isArray(entry.doc.keyPoints) && entry.doc.keyPoints.length > 0
                                  ? ` Key points: ${entry.doc.keyPoints.slice(0, 6).join("; ")}`
                                  : "";
                          const base = (entry.doc.summary ?? entry.text?.slice(0, 200) ?? "").trim();
                          return `- [${entry.doc.sourceType}] ${entry.doc.title}: ${base}${keyPoints}`;
                      })
                      .join("\n")
                : "- No relevant knowledge documents found.";

            const userPrompt = [
                `Project: ${project.name}`,
                `Client: ${project.clientName}`,
                `Current Notes: ${project.details.notes || "N/A"}`,
                `Existing Summary: ${project.overviewSummary || "No summary captured yet."}`,
                "",
                `Active Plan Snapshot:\n${planSnippet}`,
                "",
                "Recent Clarification Interactions (Do NOT Repeat these):",
                previousClarifications || "- None recorded",
                "",
                "Recently Uploaded Documents:",
                uploadedDocsSummary,
                "",
                "Knowledge Documents:",
                knowledgeSummary,
                "",
                "Instructions:",
                "1) Analyze the full chat history below.",
                "2) Identify missing info needed for a full bill of materials and labor estimate.",
                "3) Do NOT repeat questions that have already been answered.",
                "",
                "Chat history follows. Provide a structured clarification summary and list of smart, non-repetitive open questions.",
            ].join("\n");

            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: agentRunId,
                    level: "info",
                    message: "Calling model to generate clarification questions.",
                    stage: "llm_call",
                });
            }

            const result = await callChatWithSchema(ClarificationSchema, {
                systemPrompt,
                userPrompt,
                additionalMessages: args.chatHistory,
                thinkingMode: args.thinkingMode,
            });

            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: agentRunId,
                    level: "info",
                    message: "Saving clarification transcript and summary.",
                    stage: "persisting",
                });
            }

            await ctx.runMutation(internal.agents.clarification.saveResult, {
                projectId: args.projectId,
                conversationId: args.conversationId,
                messages: [
                    ...args.chatHistory,
                    { role: "assistant", content: formatAssistantMessage(result) },
                    { role: "system", content: `ANALYSIS_JSON:${JSON.stringify(result)}` },
                ],
                response: result,
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

export const run: ReturnType<typeof action> = action({
    args: {
        projectId: v.id("projects"),
        chatHistory: v.array(v.object({ role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")), content: v.string() })),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const createdAt = Date.now();
        const conversationId = await ctx.runMutation(api.conversations.createPlaceholder, {
            projectId: args.projectId,
            phase: "clarification",
            agentRole: "clarification_agent",
            messages: [...args.chatHistory, { role: "assistant", content: "Thinking..." }],
            createdAt,
        });

        await ctx.runQuery(internal.agents.clarification.getContext, { projectId: args.projectId });

        const agentRunId = await ctx.runMutation(internal.agentRuns.createRun, {
            projectId: args.projectId,
            agent: "clarification",
            stage: "queued",
            initialMessage: "Queued clarification run.",
        });

        await ctx.scheduler.runAfter(0, internal.agents.clarification.runInBackground, {
            projectId: args.projectId,
            conversationId,
            chatHistory: args.chatHistory,
            agentRunId,
            thinkingMode: args.thinkingMode,
        });

        return { queued: true, conversationId, runId: agentRunId };
    },
});
