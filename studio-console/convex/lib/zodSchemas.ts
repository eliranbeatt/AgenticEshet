import { z } from "zod";

export const TaskBreakdownSchema = z.object({
    logic: z.string().describe("Reasoning for why these tasks are needed"),
    tasks: z.array(z.object({
        title: z.string(),
        description: z.string(),
        category: z.enum(["Logistics", "Creative", "Finance", "Admin", "Studio"]),
        priority: z.enum(["High", "Medium", "Low"]),
        questName: z.string().nullable().describe("Quest grouping to bucket this task under (null if none)"),
    })),
});

export const ClarificationSchema = z.object({
    briefSummary: z.string(),
    openQuestions: z.array(z.string()),
    suggestedNextPhase: z.enum(["stay_in_clarification", "move_to_planning"]),
});

export const PlanSchema = z.object({
    reasoning: z.string(),
    contentMarkdown: z.string(),
    suggestedPhase: z.enum(["clarification", "planning", "ready_for_task_breakdown"]),
});

export const QuoteSchema = z.object({
    internalBreakdown: z.array(z.object({
        label: z.string(),              // e.g. "Materials", "Studio hours"
        amount: z.number(),             // numeric total
        currency: z.string(),           // "ILS", etc.
        notes: z.string().nullable(),   // API requires explicit null when absent
    })),
    totalAmount: z.number(),
    currency: z.string(),
    clientDocumentText: z.string(),
});

export const EnhancerSchema = z.object({
    normalizedText: z.string(),
    summary: z.string(),
    keyPoints: z.array(z.string()),
    keywords: z.array(z.string()),
    suggestedTags: z.array(z.string()),
    topics: z.array(z.string()).default([]),
    domain: z.string().optional(),
    clientName: z.string().optional(),
    language: z.string().optional(),
});
