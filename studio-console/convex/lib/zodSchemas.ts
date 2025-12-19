import { z } from "zod";

export const TaskBreakdownSchema = z.object({
    logic: z.string().optional().describe("Reasoning for why these tasks are needed"),
    tasks: z.array(z.object({
        id: z.string().describe("Unique identifier for this task (e.g., 'T1', 'T2'). Used for dependencies."),
        title: z.string(),
        description: z.string(),
        category: z.enum(["Logistics", "Creative", "Finance", "Admin", "Studio"]),
        priority: z.enum(["High", "Medium", "Low"]),
        accountingSectionName: z.string().nullable().describe("Accounting section label to link this task to (null if none)"),
        accountingItemLabel: z.string().nullable().describe("Accounting item label/role within that section (null if none)"),
        accountingItemType: z.enum(["material", "work"]).nullable().describe("Accounting item type (null if none)"),
        estimatedHours: z.number().describe("Estimated time to complete this task in hours. REQUIRED."),
        dependencies: z.array(z.string()).describe("List of task IDs that this task depends on (e.g., ['T1']). Use [] if it can start immediately."),
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

export const IdeationConceptsSchema = z.object({
    concepts: z.array(
        z.object({
            title: z.string(),
            oneLiner: z.string(),
            detailsMarkdown: z.string(),
        })
    ),
});

export const SolutionItemPlanV1Schema = z.object({
    version: z.literal("SolutionItemPlanV1"),
    title: z.string(),
    summary: z.string().optional(),
    steps: z.array(
        z.object({
            id: z.string(),
            title: z.string(),
            details: z.string(),
            estimatedMinutes: z.number().optional(),
            materials: z.array(z.string()).optional(),
            tools: z.array(z.string()).optional(),
        })
    ),
});

export const SolutioningExtractedPlanSchema = z.object({
    plan: SolutionItemPlanV1Schema,
    markdown: z.string(),
});

export const TaskEditorPatchSchema = z.object({
    summary: z.string().describe("Short summary of what was changed/applied."),
    patch: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
        category: z.enum(["Logistics", "Creative", "Finance", "Admin", "Studio"]).optional(),
        priority: z.enum(["High", "Medium", "Low"]).optional(),
        estimatedMinutes: z.number().optional(),
        steps: z.array(z.string()).optional(),
        subtasks: z.array(z.object({ title: z.string(), done: z.boolean() })).optional(),
        assignee: z.string().nullable().optional(),
    }),
});
