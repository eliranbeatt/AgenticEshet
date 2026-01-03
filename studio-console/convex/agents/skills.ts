import { v } from "convex/values";
import { action, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithJsonSchema } from "../lib/openai";
import { parseJsonSchema, validateJsonSchemaMinimal } from "../lib/jsonSchema";

export const listEnabled = query({
    args: {
        stage: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const skills = await ctx.db.query("skills").collect();
        return skills.filter((skill) => {
            if (skill.enabled === false) return false;
            if (!args.stage) return true;
            return (skill.stageTags ?? []).includes(args.stage);
        });
    },
});

export const run = action({
    args: {
        projectId: v.id("projects"),
        conversationId: v.optional(v.id("projectConversations")),
        threadId: v.optional(v.id("chatThreads")),
        skillKey: v.string(),
        input: v.any(),
        model: v.optional(v.string()),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const skill = await ctx.db
            .query("skills")
            .withIndex("by_skillKey", (q) => q.eq("skillKey", args.skillKey))
            .first();

        if (!skill) {
            throw new Error(`Skill not found: ${args.skillKey}`);
        }
        if (skill.enabled === false) {
            throw new Error(`Skill disabled: ${args.skillKey}`);
        }

        const inputSchema = parseJsonSchema(skill.inputSchemaJson);
        const outputSchema = parseJsonSchema(skill.outputSchemaJson);

        const inputErrors = validateJsonSchemaMinimal(inputSchema, args.input);
        if (inputErrors.length > 0) {
            throw new Error(`Skill input validation failed: ${inputErrors.join("; ")}`);
        }

        const agentRunId = await ctx.runMutation(internal.agentRuns.createRun, {
            projectId: args.projectId,
            agent: `skill:${args.skillKey}`,
            stage: skill.stageTags?.[0],
            initialMessage: `Running ${args.skillKey}`,
        });

        await ctx.runMutation(internal.agentRuns.setStatus, {
            runId: agentRunId,
            status: "running",
            stage: skill.stageTags?.[0],
        });

        await ctx.runMutation(internal.agentRuns.appendEvent, {
            runId: agentRunId,
            level: "info",
            message: "Input validated",
            stage: skill.stageTags?.[0],
        });

        try {
            const settings = await ctx.runQuery(internal.settings.getAll);
            const model =
                args.model ||
                settings.modelConfig?.[args.skillKey] ||
                settings.modelConfig?.skills ||
                "gpt-5-mini";

            const output = await callChatWithJsonSchema(outputSchema ?? { type: "object" }, {
                model,
                systemPrompt: skill.content,
                userPrompt: JSON.stringify(args.input ?? {}),
                thinkingMode: args.thinkingMode,
                language: "he",
            });

            const outputErrors = validateJsonSchemaMinimal(outputSchema, output);
            if (outputErrors.length > 0) {
                throw new Error(`Skill output validation failed: ${outputErrors.join("; ")}`);
            }

            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId: agentRunId,
                status: "succeeded",
                stage: skill.stageTags?.[0],
            });

            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId: agentRunId,
                level: "info",
                message: "Skill completed",
                stage: skill.stageTags?.[0],
            });

            return {
                runId: agentRunId,
                skill,
                output,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId: agentRunId,
                status: "failed",
                stage: skill.stageTags?.[0],
                error: message,
            });
            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId: agentRunId,
                level: "error",
                message,
                stage: skill.stageTags?.[0],
            });
            throw error;
        }
    },
});
