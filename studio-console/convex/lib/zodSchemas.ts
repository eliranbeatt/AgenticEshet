import { z } from "zod";

export const TaskBreakdownSchema = z.object({
    logic: z.string().describe("Reasoning for why these tasks are needed"),
    tasks: z.array(z.object({
        title: z.string(),
        description: z.string(),
        category: z.enum(["Logistics", "Creative", "Finance", "Admin", "Studio"]),
        priority: z.enum(["High", "Medium", "Low"]),
        accountingSectionName: z.string().nullable().describe("Accounting section label to link this task to (null if none)"),
        accountingItemLabel: z.string().nullable().describe("Accounting item label/role within that section (null if none)"),
        accountingItemType: z.enum(["material", "work"]).nullable().describe("Accounting item type (null if none)"),
        dependencies: z.array(z.number()).default([]).describe("List of task indices (1-based) that this task depends on. Only reference tasks from this list that appear BEFORE this task. Use [] if it can start immediately."),
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

export const EstimationSchema = z.object({
  materials: z.array(z.object({
    category: z.string(),
    label: z.string(),
    unit: z.string(),
    quantity: z.number(),
    unitCost: z.number(),
    vendor: z.optional(z.string().nullable()),
    description: z.optional(z.string().nullable())
  })),
  work: z.array(z.object({
    workType: z.string(), // studio, field, management
    role: z.string(),
    rateType: z.string(), // day, hour, flat
    quantity: z.number(),
    unitCost: z.number(),
    description: z.optional(z.string().nullable())
  }))
});

export const EnhancerSchema = z.object({
    normalizedText: z.string(),
    summary: z.string(),
    keyPoints: z.array(z.string()),
    keywords: z.array(z.string()),
    suggestedTags: z.array(z.string()),
    topics: z.array(z.string()).default([]),
    domain: z.string().nullable().default(null),
    clientName: z.string().nullable().default(null),
    language: z.string().nullable().default(null),
});
