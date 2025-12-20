import { z } from "zod";

export const TaskBreakdownSchema = z.object({
    logic: z.string().optional().describe("Reasoning for why these tasks are needed"),
    tasks: z.array(z.object({
        id: z.string().describe("Unique identifier for this task (e.g., 'T1', 'T2'). Used for dependencies."),
        title: z.string(),
        description: z.string(),
        category: z.enum(["Logistics", "Creative", "Finance", "Admin", "Studio"]),
        priority: z.enum(["High", "Medium", "Low"]),
        itemTitle: z.string().nullable().describe("Project item title to link this task to (null if none)"),
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

export const SolutioningExtractedPlanLooseSchema = z.object({
    plan: z.unknown().optional(),
    markdown: z.string().optional(),
    SolutionItemPlanV1: z.unknown().optional(),
    MarkdownPlan: z.string().optional(),
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

const PurchaseNeedSchema = z.object({
    id: z.string().optional(),
    label: z.string(),
    qty: z.number().optional(),
    unit: z.string().optional(),
    notes: z.string().optional(),
});

const MaterialSpecSchema = z.object({
    id: z.string(),
    category: z.string().optional(),
    label: z.string(),
    description: z.string().optional(),
    qty: z.number().optional(),
    unit: z.string().optional(),
    unitCostEstimate: z.number().optional(),
    vendorName: z.string().optional(),
    procurement: z.enum(["in_stock", "local", "abroad", "either"]).optional(),
    status: z.string().optional(),
    note: z.string().optional(),
});

const LaborSpecSchema = z.object({
    id: z.string(),
    workType: z.string(),
    role: z.string(),
    rateType: z.enum(["hour", "day", "flat"]),
    quantity: z.number().optional(),
    unitCost: z.number().optional(),
    description: z.string().optional(),
});

const SubtaskSpecSchema: z.ZodType<{
    id: string;
    title: string;
    description?: string;
    status?: string;
    estMinutes?: number;
    children?: unknown[];
    taskProjection?: {
        createTask: boolean;
        titleOverride?: string;
    };
}> = z.lazy(() =>
    z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        status: z.string().optional(),
        estMinutes: z.number().optional(),
        children: z.array(SubtaskSpecSchema).optional(),
        taskProjection: z.object({
            createTask: z.boolean(),
            titleOverride: z.string().optional(),
        }).optional(),
    })
);

const AlternativeSpecSchema = z.object({
    title: z.string(),
    description: z.string().optional(),
    tradeoffs: z.array(z.string()).optional(),
});

export const ItemSpecV2Schema = z.object({
    version: z.literal("ItemSpecV2"),
    identity: z.object({
        title: z.string(),
        typeKey: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        accountingGroup: z.string().optional(),
    }),
    quality: z.object({
        tier: z.enum(["low", "medium", "high"]),
        notes: z.string().optional(),
    }).optional(),
    budgeting: z.object({
        estimate: z.object({
            amount: z.number().optional(),
            currency: z.literal("ILS"),
            confidence: z.number().optional(),
        }).optional(),
        range: z.object({
            min: z.number().optional(),
            max: z.number().optional(),
        }).optional(),
        notes: z.string().optional(),
    }).optional(),
    procurement: z.object({
        required: z.boolean(),
        channel: z.enum(["none", "local", "abroad", "both"]),
        leadTimeDays: z.number().optional(),
        purchaseList: z.array(PurchaseNeedSchema).optional(),
    }).optional(),
    studioWork: z.object({
        required: z.boolean(),
        workTypes: z.array(z.string()).optional(),
        estMinutes: z.number().optional(),
        buildPlanMarkdown: z.string().optional(),
        buildPlanJson: z.string().optional(),
    }).optional(),
    logistics: z.object({
        transportRequired: z.boolean(),
        packagingNotes: z.string().optional(),
        storageRequired: z.boolean().optional(),
    }).optional(),
    onsite: z.object({
        installDays: z.number().optional(),
        shootDays: z.number().optional(),
        teardownDays: z.number().optional(),
        operatorDuringEvent: z.boolean().optional(),
    }).optional(),
    safety: z.object({
        publicInteraction: z.boolean().optional(),
        electrical: z.boolean().optional(),
        weightBearing: z.boolean().optional(),
        notes: z.string().optional(),
    }).optional(),
    breakdown: z.object({
        subtasks: z.array(SubtaskSpecSchema).default([]),
        materials: z.array(MaterialSpecSchema).default([]),
        labor: z.array(LaborSpecSchema).default([]),
    }).default({
        subtasks: [],
        materials: [],
        labor: [],
    }),
    attachments: z.object({
        links: z.array(z.object({
            url: z.string(),
            label: z.string().optional(),
        })).optional(),
    }).optional(),
    state: z.object({
        openQuestions: z.array(z.string()).default([]),
        assumptions: z.array(z.string()).default([]),
        decisions: z.array(z.string()).default([]),
        alternatives: z.array(AlternativeSpecSchema).optional(),
    }).default({
        openQuestions: [],
        assumptions: [],
        decisions: [],
    }),
    quote: z.object({
        includeInQuote: z.boolean(),
        clientTextOverride: z.string().optional(),
        milestones: z.array(z.object({
            name: z.string(),
            date: z.string().optional(),
        })).optional(),
    }).optional(),
});

export const ItemUpdateOutputSchema = z.object({
    itemId: z.string(),
    proposedData: ItemSpecV2Schema,
    summaryMarkdown: z.string(),
    changeReason: z.string().optional(),
});

export type ItemSpecV2 = z.infer<typeof ItemSpecV2Schema>;
export type ItemUpdateOutput = z.infer<typeof ItemUpdateOutputSchema>;
export type SolutionItemPlanV1 = z.infer<typeof SolutionItemPlanV1Schema>;
