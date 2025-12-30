import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

function parseFieldPath(questionKey: string) {
    const parts = questionKey.split(".");
    if (parts.length < 2) return null;
    return parts.slice(1).join(".");
}

function normalizeAnswerValue(answer: unknown) {
    if (typeof answer === "number") return { valueTyped: answer, valueTextHe: String(answer) };
    if (typeof answer === "boolean") return { valueTyped: answer, valueTextHe: answer ? "כן" : "לא" };
    if (typeof answer === "string") {
        const trimmed = answer.trim();
        return { valueTyped: trimmed, valueTextHe: trimmed };
    }
    return { valueTyped: answer, valueTextHe: "" };
}

export const listQuestions = query({
    args: { projectId: v.id("projects"), status: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const all = await ctx.db
            .query("questionQueue")
            .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId))
            .collect();
        const filtered = args.status ? all.filter((q) => q.status === args.status) : all;
        return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
    },
});

export const enqueueQuestions = mutation({
    args: {
        projectId: v.id("projects"),
        questions: v.array(v.object({
            questionKey: v.string(),
            elementId: v.optional(v.id("projectItems")),
            categoryHe: v.string(),
            questionTextHe: v.string(),
            answerType: v.union(
                v.literal("text"),
                v.literal("number"),
                v.literal("date"),
                v.literal("select"),
                v.literal("multiselect"),
                v.literal("yesno")
            ),
            optionsHe: v.optional(v.array(v.string())),
        })),
    },
    handler: async (ctx, args) => {
        for (const question of args.questions) {
            const existing = await ctx.db
                .query("questionQueue")
                .withIndex("by_project_key", (q) =>
                    q.eq("projectId", args.projectId).eq("questionKey", question.questionKey)
                )
                .first();
            if (existing) continue;

            await ctx.db.insert("questionQueue", {
                projectId: args.projectId,
                elementId: question.elementId,
                categoryHe: question.categoryHe,
                questionKey: question.questionKey,
                questionTextHe: question.questionTextHe,
                answerType: question.answerType,
                optionsHe: question.optionsHe,
                status: "open",
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        }

        return { ok: true };
    },
});

export const answerQuestion = mutation({
    args: {
        questionId: v.id("questionQueue"),
        answer: v.any(),
        answeredBy: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const question = await ctx.db.get(args.questionId);
        if (!question) throw new Error("Question not found");

        const fieldPath = parseFieldPath(question.questionKey);
        const normalized = normalizeAnswerValue(args.answer);

        const result = await ctx.runMutation(api.factsPipeline.createFact, {
            projectId: question.projectId,
            scope: question.elementId ? "element" : "project",
            elementId: question.elementId ?? null,
            categoryHe: question.categoryHe,
            type: "field_update",
            fieldPath: fieldPath ?? undefined,
            valueTyped: normalized.valueTyped,
            valueTextHe: normalized.valueTextHe,
            source: "user_form",
            sourceRef: args.answeredBy,
            status: "accepted",
            confidence: 1,
        });

        await ctx.db.patch(args.questionId, {
            status: "answered",
            answeredByFactId: (result.factId ?? undefined) as Id<"facts"> | undefined,
            updatedAt: Date.now(),
        });

        return { factId: result.factId };
    },
});

export const dismissQuestion = mutation({
    args: { questionId: v.id("questionQueue") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.questionId, {
            status: "dismissed",
            updatedAt: Date.now(),
        });
    },
});
