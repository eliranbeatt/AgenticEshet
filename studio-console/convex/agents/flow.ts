import { v } from "convex/values";
import { z } from "zod";

import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema, streamChatText } from "../lib/openai";
import type { Doc } from "../_generated/dataModel";
import { ItemSpecV2Schema } from "../lib/zodSchemas";

const tabValidator = v.union(v.literal("ideation"), v.literal("planning"), v.literal("solutioning"));
const modeValidator = v.union(v.literal("clarify"), v.literal("generate"));
const scopeTypeValidator = v.union(v.literal("allProject"), v.literal("singleItem"), v.literal("multiItem"));

const AgentAParsedSchema = z.object({
    clarificationQuestions: z.array(z.string()),
    suggestions: z
        .array(
            z.object({
                title: z.string(),
                details: z.string(),
                whyItHelps: z.string(),
            })
        ),
});

const AgentBWorkspaceSchema = z.object({
    updatedWorkspaceMarkdown: z.string(),
});

function labelForTab(tab: "ideation" | "planning" | "solutioning") {
    if (tab === "ideation") return "Ideation";
    if (tab === "planning") return "Planning";
    return "Solutioning";
}

function buildAgentASystemPrompt(args: {
    tab: "ideation" | "planning" | "solutioning";
    mode: "clarify" | "generate";
}) {
    const focus = labelForTab(args.tab);

    if (args.mode === "generate") {
        return [
            `You are assisting in ${focus}.`,
            "Generate/Expand mode.",
            "Your goal is to propose new items, expanded approaches, or detailed plans based on the user's request.",
            "Do NOT ask clarification questions unless absolutely necessary (return empty list if none).",
            "Return 3 to 5 actionable suggestions that are relevant to the user's request (features, efficiency improvements, etc.).",
            "Use this markdown format exactly:",
            "## Clarification questions\n(Optional, leave empty if none)\n\n## Suggestions\n1. **Title**: ...\n   - Details: ...\n   - Why it helps: ...\n2. ...",
            "Do not claim to have updated any structured fields.",
        ].join("\n");
    }

    return [
        `You are assisting in ${focus}.`,
        "Clarify & Suggest mode.",
        "Return exactly 3 targeted clarification questions and exactly 3 actionable suggestions.",
        "Suggestions should be relevant to the questions asked (features, efficiency improvements, etc.), not just implementation details.",
        "Use this markdown format exactly:",
        "## Clarification questions\n1. ...\n2. ...\n3. ...\n\n## Suggestions\n1. **Title**: ...\n   - Details: ...\n   - Why it helps: ...\n2. ...\n3. ...",
        "Do not output a full item spec. Do not say you updated fields.",
    ].join("\n");
}

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

        const scopeSummary =
            args.scopeType === "allProject"
                ? "All Project"
                : args.scopeType === "singleItem"
                    ? `Single Item: ${selectedItems[0]?.title ?? String(args.scopeItemIds?.[0] ?? "")}`
                    : `Multi Item: ${selectedItems.map((i) => i.title).join(", ")}`;

        const transcript = [
            ...messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
            `USER: ${args.userContent}`,
        ].join("\n");

        const agentAUserPrompt = [
            `PROJECT: ${project.name}`,
            `CLIENT: ${project.clientName}`,
            `TAB: ${args.tab}`,
            `SCOPE: ${scopeSummary}`,
            "",
            "Current Understanding (workspace markdown):",
            workspace?.text?.trim() ? workspace.text : "(empty)",
            "",
            "Conversation:",
            transcript,
        ].join("\n");

        let finalAssistantMarkdown = "";
        let parsedA: z.infer<typeof AgentAParsedSchema> | null = null;

        try {
            let buffer = "";
            let lastFlushedAt = 0;
            await streamChatText({
                systemPrompt: buildAgentASystemPrompt({ tab: args.tab, mode: args.mode }),
                userPrompt: agentAUserPrompt,
                model: args.model,
                thinkingMode: args.thinkingMode,
                language: project.defaultLanguage === "en" ? "en" : "he",
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

            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId,
                level: "info",
                stage: "agent_a",
                message: "Agent A completed chat response",
            });

            try {
                parsedA = await callChatWithSchema(AgentAParsedSchema, {
                    model: args.model,
                    systemPrompt:
                        "Extract EXACTLY 3 clarificationQuestions and EXACTLY 3 suggestions from the assistant markdown. Return JSON only.",
                    userPrompt: finalAssistantMarkdown,
                    maxRetries: 2,
                    language: "en",
                });
            } catch (error) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId,
                    level: "warn",
                    stage: "agent_a",
                    message: `Agent A parse failed: ${error instanceof Error ? error.message : String(error)}`,
                });
            }

            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId,
                status: "running",
                stage: "agent_b",
            });

            const agentB = await callChatWithSchema(AgentBWorkspaceSchema, {
                model: args.model,
                systemPrompt: [
                    "You update the 'Current Understanding' workspace markdown.",
                    "Take the user's latest message and the assistant response, and update the workspace text accordingly.",
                    "Preserve existing structure if present.",
                    "Do not invent facts; if unsure, leave TODO bullets or open questions.",
                    "Return JSON only.",
                ].join("\n"),
                userPrompt: JSON.stringify(
                    {
                        tab: args.tab,
                        scopeType: args.scopeType,
                        scopeKey,
                        selectedItems: selectedItems.map((i) => ({ id: String(i._id), title: i.title, typeKey: i.typeKey })),
                        workspaceMarkdown: workspace?.text ?? "",
                        userMessage: args.userContent,
                        assistantMessage: finalAssistantMarkdown,
                        parsedAssistant: parsedA,
                    },
                    null,
                    2
                ),
                maxRetries: 2,
                language: project.defaultLanguage === "en" ? "en" : "he",
            });

            await ctx.runMutation(api.flowWorkspaces.saveText, {
                workspaceId,
                text: agentB.updatedWorkspaceMarkdown,
                source: "system",
                lastAgentRunId: runId,
            });

            await ctx.runMutation(internal.chat.createMessage, {
                projectId: project._id,
                scenarioId: scenario._id,
                threadId: args.threadId,
                role: "system",
                content: "Current understanding updated.",
                status: "final",
            });

            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId,
                level: "info",
                stage: "agent_b",
                message: "Workspace updated",
            });

            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId,
                status: "succeeded",
                stage: "done",
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
