import { v } from "convex/values";

import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema, streamChatText } from "../lib/openai";
import type { Doc } from "../_generated/dataModel";
import { ItemSpecV2Schema } from "../lib/zodSchemas";
import { buildFlowAgentASystemPrompt } from "../prompts/flowPromptPack";
import {
    summarizeFacts,
    summarizeItems,
    summarizeKnowledgeBlocks,
    summarizeKnowledgeDocs,
} from "../lib/contextSummary";

const tabValidator = v.union(v.literal("ideation"), v.literal("planning"), v.literal("solutioning"));
const modeValidator = v.union(v.literal("clarify"), v.literal("generate"));
const scopeTypeValidator = v.union(v.literal("allProject"), v.literal("singleItem"), v.literal("multiItem"));

export const send = action({
    args: {
        threadId: v.id("chatThreads"),
        userContent: v.string(),
        tab: tabValidator,
        mode: modeValidator,
        scopeType: scopeTypeValidator,
        scopeItemIds: v.optional(v.array(v.id("projectItems"))),
        model: v.optional(v.string()),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        await ctx.runMutation(internal.rateLimit.consume, {
            key: `flow:${args.threadId}`,
            limit: 30,
            windowMs: 60_000,
        });

        const { project, scenario, messages } = await ctx.runQuery(internal.chat.getThreadContext, {
            threadId: args.threadId,
        }) as {
            project: Doc<"projects">;
            scenario: Doc<"projectScenarios">;
            messages: Doc<"chatMessages">[];
        };

        if (scenario.phase !== args.tab) {
            throw new Error(`Thread phase mismatch. Expected ${args.tab} but got ${scenario.phase}`);
        }

        const runId = await ctx.runMutation(internal.agentRuns.createRun, {
            projectId: project._id,
            agent: `flow:${args.tab}`,
            stage: "agent_a",
            initialMessage: "Flow turn started",
        });

        await ctx.runMutation(internal.agentRuns.setStatus, {
            runId,
            status: "running",
            stage: "agent_a",
        });

        const { workspaceId, scopeKey } = await ctx.runMutation(api.flowWorkspaces.ensure, {
            projectId: project._id,
            tab: args.tab,
            scopeType: args.scopeType,
            scopeItemIds: args.scopeItemIds,
            initialText: "",
        });

        const workspace = await ctx.runQuery(api.flowWorkspaces.get, {
            projectId: project._id,
            tab: args.tab,
            scopeKey,
        });

        const userMessageId = await ctx.runMutation(internal.chat.createMessage, {
            projectId: project._id,
            scenarioId: scenario._id,
            threadId: args.threadId,
            role: "user",
            content: args.userContent,
            status: "final",
        });

        const assistantMessageId = await ctx.runMutation(internal.chat.createMessage, {
            projectId: project._id,
            scenarioId: scenario._id,
            threadId: args.threadId,
            role: "assistant",
            content: "",
            status: "streaming",
        });

        const selectedItems = (args.scopeItemIds?.length
            ? await ctx.runQuery(api.items.listByIds, { itemIds: args.scopeItemIds })
            : []) as Doc<"projectItems">[];

        const factsSnapshot = await ctx.runQuery(internal.facts.getSnapshot, {
            projectId: project._id,
            stage: args.tab,
        });

        const knowledgeBlocks = await ctx.runQuery(api.facts.listBlocks, {
            projectId: project._id,
        });

        const knowledgeDocs = await ctx.runQuery(api.knowledge.listRecentDocs, {
            projectId: project._id,
            limit: 6,
            sourceTypes: ["doc_upload", "plan", "conversation"],
        });

        const { items } = await ctx.runQuery(api.items.listSidebarTree, {
            projectId: project._id,
            includeDrafts: true,
        });

        const scopeSummary =
            args.scopeType === "allProject"
                ? "All Project"
                : args.scopeType === "singleItem"
                    ? `Single Item: ${selectedItems[0]?.title ?? String(args.scopeItemIds?.[0] ?? "")}`
                    : `Multi Item: ${selectedItems.map((i) => i.title).join(", ")}`;

        const language = project.defaultLanguage === "en" ? "en" : "he";

        const transcript = [
            ...messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
            `USER: ${args.userContent}`,
        ].join("\n");

        let allProjectTranscript = "";
        if (args.scopeType !== "allProject") {
             const allProjectMessages = await ctx.runQuery(internal.chat.getThreadMessagesByScenarioKey, {
                 projectId: project._id,
                 phase: args.tab,
                 scenarioKey: "allProject:null"
             });
             if (allProjectMessages.length > 0) {
                 allProjectTranscript = [
                     "--- START OF ALL PROJECT CONTEXT ---",
                     ...allProjectMessages.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
                     "--- END OF ALL PROJECT CONTEXT ---",
                     ""
                 ].join("\n");
             }
        }

        const stageMap: Record<string, "clarification" | "planning" | "solutioning"> = {
            "ideation": "clarification",
            "planning": "planning",
            "solutioning": "solutioning"
        };
        const structuredTranscript = await ctx.runQuery(internal.structuredQuestions.getTranscript, {
            projectId: project._id,
            stage: stageMap[args.tab] || "clarification"
        });

        const agentAUserPrompt = [
            `PROJECT: ${project.name}`,
            `CLIENT: ${project.clientName}`,
            `OVERVIEW: ${JSON.stringify(project.overview || {})}`,
            `TAB: ${args.tab}`,
            `SCOPE: ${scopeSummary}`,
            "",
            "KNOWN FACTS (accepted):",
            summarizeFacts(factsSnapshot.acceptedFacts ?? []),
            "",
            "KNOWLEDGE BLOCKS:",
            summarizeKnowledgeBlocks(knowledgeBlocks ?? []),
            "",
            "RECENT KNOWLEDGE DOCS:",
            summarizeKnowledgeDocs(knowledgeDocs ?? []),
            "",
            "CURRENT ITEMS SUMMARY:",
            summarizeItems(items ?? []),
            "",
            "Current Understanding (workspace markdown):",
            workspace?.text?.trim() ? workspace.text : "(empty)",
            "",
            "Structured Questions History:",
            structuredTranscript || "(none)",
            "",
            allProjectTranscript,
            "Conversation:",
            transcript,
        ].join("\n");

        let finalAssistantMarkdown = "";

        try {
            let buffer = "";
            let lastFlushedAt = 0;
            await streamChatText({
                systemPrompt: buildFlowAgentASystemPrompt({
                    tab: args.tab,
                    mode: args.mode,
                    language,
                }),
                userPrompt: agentAUserPrompt,
                model: args.model,
                thinkingMode: args.thinkingMode,
                language,
                onDelta: async (delta) => {
                    buffer += delta;
                    const now = Date.now();
                    if (now - lastFlushedAt < 200) return;
                    lastFlushedAt = now;
                    await ctx.runMutation(internal.chat.patchMessage, {
                        messageId: assistantMessageId,
                        content: buffer,
                        status: "streaming",
                    });
                },
            });

            finalAssistantMarkdown = buffer.trim() ? buffer : "(empty)";
            await ctx.runMutation(internal.chat.patchMessage, {
                messageId: assistantMessageId,
                content: finalAssistantMarkdown,
                status: "final",
            });

            try {
                const itemRefs = await ctx.runQuery(internal.items.getItemRefs, { projectId: project._id });
                const scope =
                    args.scopeType === "allProject"
                        ? { type: "project" as const }
                        : {
                            type: args.scopeType === "singleItem" ? ("item" as const) : ("multiItem" as const),
                            itemIds: args.scopeItemIds,
                        };

                await ctx.runMutation(internal.turnBundles.createFromTurn, {
                    projectId: project._id,
                    stage: args.tab,
                    scope,
                    source: {
                        type: "chat",
                        sourceIds: [userMessageId, assistantMessageId],
                    },
                    itemRefs,
                    freeChat: args.userContent,
                    agentOutput: finalAssistantMarkdown,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId,
                    level: "warn",
                    stage: "agent_a",
                    message: `Facts turn bundle failed: ${message}`,
                });
            }

            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId,
                level: "info",
                stage: "agent_a",
                message: "Agent A completed chat response",
            });

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await ctx.runMutation(internal.chat.patchMessage, {
                messageId: assistantMessageId,
                status: "error",
                content: finalAssistantMarkdown ? `${finalAssistantMarkdown}\n\nError: ${message}` : `Error: ${message}`,
            });
            await ctx.runMutation(internal.chat.createMessage, {
                projectId: project._id,
                scenarioId: scenario._id,
                threadId: args.threadId,
                role: "system",
                content: `Error: ${message}`,
                status: "error",
            });
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId,
                status: "failed",
                stage: "error",
                error: message,
            });
        }

        return { ok: true as const, userMessageId, assistantMessageId, agentRunId: runId };
    },
});

export const generateItemUpdate = action({
    args: {
        threadId: v.id("chatThreads"),
        workspaceText: v.string(),
        model: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { project, scenario } = await ctx.runQuery(internal.chat.getThreadContext, {
            threadId: args.threadId,
        }) as {
            project: Doc<"projects">;
            scenario: Doc<"projectScenarios">;
        };

        const systemPrompt = `You are an expert project manager and estimator.
Analyze the provided "Current Understanding" text and extract the full specification for the main item described.
Return it as a structured ItemSpecV2 object.

CRITICAL INSTRUCTIONS:
1. You MUST populate the "identity" object with "title" and "typeKey".
2. You MUST populate the "breakdown" object. Extract every implied task into "subtasks", every material into "materials", and every role/labor into "labor".
3. You MUST populate the "state" object with any "openQuestions", "assumptions", and "decisions" found in the text.
4. Do not leave arrays empty if there is ANY information in the text that can be mapped to them.
5. Infer reasonable details (like estimated minutes, material quantities) if they are implied by the scope, but mark them as assumptions if uncertain.
6. "version" must be "ItemSpecV2".

IMPORTANT SCHEMA DETAILS:
- "subtasks" array items MUST have:
  - "id" (string, generate a unique one e.g. "task_1")
  - "title" (string) - REQUIRED. Do NOT use "label".
- "materials" array items MUST have:
  - "id" (string, generate a unique one e.g. "mat_1")
  - "label" (string) - REQUIRED. If unknown, use a generic label like "Material".
- "labor" array items MUST have:
  - "id" (string, generate a unique one e.g. "lab_1")
  - "workType" (string, e.g. "Studio", "Field") - REQUIRED. Default to "Studio" if unsure.
  - "role" (string, e.g. "Carpenter") - REQUIRED. Default to "General Labor" if unsure.
  - "rateType" (one of "hour", "day", "flat") - REQUIRED. Default to "hour".
- "openQuestions" MUST be an array of strings, NOT objects.

EXAMPLE JSON STRUCTURE:
{
  "version": "ItemSpecV2",
  "identity": { "title": "Example Item", "typeKey": "custom" },
  "breakdown": {
    "subtasks": [
      { "id": "task_1", "title": "Design Phase", "estMinutes": 120 }
    ],
    "materials": [
      { "id": "mat_1", "label": "Plywood Sheets", "qty": 5, "unit": "pcs" }
    ],
    "labor": [
      { "id": "lab_1", "workType": "Studio", "role": "Carpenter", "rateType": "hour", "quantity": 10 }
    ]
  },
  "state": { "openQuestions": [], "assumptions": [], "decisions": [] }
}

The goal is to convert the unstructured text into a rich, actionable structured plan.`;

        const result = await callChatWithSchema(
            ItemSpecV2Schema,
            {
                systemPrompt,
                userPrompt: args.workspaceText,
                model: args.model || "gpt-4o",
                temperature: 0.1,
            }
        );

        return result;
    },
});
