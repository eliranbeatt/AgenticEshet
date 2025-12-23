import { z } from "zod";
import { TASK_CATEGORIES, TASK_PRIORITIES } from "../constants";

export const TaskBreakdownSchema = z.object({
    logic: z.string().optional().describe("Reasoning for why these tasks are needed"),
    tasks: z.array(z.object({
        id: z.string().describe("Unique identifier for this task (e.g., 'T1', 'T2'). Used for dependencies."),
        title: z.string(),
        description: z.string(),
        category: z.enum(TASK_CATEGORIES),
        priority: z.enum(TASK_PRIORITIES),
        itemTitle: z.string().nullable().describe("Project item title to link this task to (null if none)"),
        accountingSectionName: z.string().nullable().describe("Accounting section label to link this task to (null if none)"),
        accountingItemLabel: z.string().nullable().describe("Accounting item label/role within that section (null if none)"),
        accountingItemType: z.enum(["material", "work"]).nullable().describe("Accounting item type (null if none)"),
        estimatedHours: z.number().describe("Estimated time to complete this task in hours. REQUIRED."),
        dependencies: z.array(z.string()).describe("List of task IDs that this task depends on (e.g., ['T1']). Use [] if it can start immediately."),
        questName: z.string().optional().describe("Name of the quest (group of tasks) this task belongs to. E.g. 'Venue Setup', 'Catering'."),
    })),
});

export const TaskRefinementSchema = z.object({
    logic: z.string().optional().describe("Reasoning summary for the refinements."),
    tasks: z.array(z.object({
        id: z.string().describe("Task ID from the input list (e.g., 'T1')."),
        description: z.string().describe("Improved, clearer task description."),
        estimatedHours: z.number().describe("Estimated time to complete this task in hours."),
        dependencies: z.array(z.string()).describe("List of task IDs that this task depends on (e.g., ['T1']). Use [] if it can start immediately."),
        steps: z.array(z.string()).optional().describe("Optional step-by-step bullets for the task."),
        subtasks: z.array(z.string()).optional().describe("Optional subtask titles."),
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
            estimatedMinutes: z.number().nullable().optional(),
            materials: z.array(z.union([
                z.string(),
                z.object({
                    name: z.string(),
                    quantity: z.number().optional(),
                    unit: z.string().optional(),
                    unitCostEstimate: z.number().optional(),
                    notes: z.string().optional(),
                }),
            ])).optional(),
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
        estimatedMinutes: z.number().nullable().optional(),
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
    estMinutes?: number | null;
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
        estMinutes: z.number().nullable().optional(),
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
        leadTimeDays: z.number().nullable().optional(),
        purchaseList: z.array(PurchaseNeedSchema).optional(),
    }).optional(),
    studioWork: z.object({
        required: z.boolean(),
        workTypes: z.array(z.string()).optional(),
        estMinutes: z.number().nullable().optional(),
        buildPlanMarkdown: z.string().optional(),
        buildPlanJson: z.string().optional(),
    }).optional(),
    logistics: z.object({
        transportRequired: z.boolean(),
        packagingNotes: z.string().optional(),
        storageRequired: z.boolean().optional(),
    }).optional(),
    onsite: z.object({
        installDays: z.number().nullable().optional(),
        shootDays: z.number().nullable().optional(),
        teardownDays: z.number().nullable().optional(),
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

const CurrencySchema = z.enum(["ILS", "USD", "EUR"]);
const ItemKindSchema = z.enum(["deliverable", "service", "day", "fee", "group"]);
const ItemCategorySchema = z.enum([
    "set_piece",
    "print",
    "floor",
    "prop",
    "rental",
    "purchase",
    "transport",
    "installation",
    "studio_production",
    "management",
    "other",
]);
const PurchaseModeSchema = z.enum(["local", "abroad", "both", "none"]);
const TaskStatusSchema = z.enum(["todo", "in_progress", "done", "blocked", "cancelled"]);
const DependencyTypeSchema = z.enum(["FS", "SS", "FF", "SF"]);
const AccountingLineTypeSchema = z.enum([
    "material",
    "labor",
    "purchase",
    "rental",
    "shipping",
    "misc",
]);
const PurchaseStatusSchema = z.enum(["planned", "quoted", "ordered", "received", "cancelled"]);

const ItemFlagsSchema = z.object({
    requiresStudio: z.boolean().optional(),
    requiresPurchase: z.boolean().optional(),
    purchaseMode: PurchaseModeSchema.optional(),
    requiresRental: z.boolean().optional(),
    requiresMoving: z.boolean().optional(),
    requiresInstallation: z.boolean().optional(),
    requiresDismantle: z.boolean().optional(),
}).strict();

const ItemScopeSchema = z.object({
    quantity: z.number().min(0).optional(),
    unit: z.string().min(1).optional(),
    dimensions: z.string().optional(),
    location: z.string().optional(),
    dueDate: z.string().optional(),
    constraints: z.array(z.string()).optional(),
    assumptions: z.array(z.string()).optional(),
}).strict();

const QuoteDefaultsSchema = z.object({
    includeByDefault: z.boolean().optional(),
    displayName: z.string().optional(),
    taxable: z.boolean().optional(),
    vatRate: z.number().min(0).max(1).optional(),
}).strict();

const ItemRefSchema = z.object({
    itemId: z.string().nullable(),
    itemTempId: z.string().nullable(),
}).strict().refine((value) => Boolean(value.itemId) || Boolean(value.itemTempId), {
    message: "itemRef requires itemId or itemTempId",
});

const TaskRefSchema = z.object({
    taskId: z.string().nullable(),
    taskTempId: z.string().nullable(),
}).strict().refine((value) => Boolean(value.taskId) || Boolean(value.taskTempId), {
    message: "taskRef requires taskId or taskTempId",
});

const ItemCreateSchema = z.object({
    tempId: z.string().min(1),
    parentTempId: z.string().nullable().optional(),
    parentItemId: z.string().nullable().optional(),
    sortKey: z.string().min(1),
    kind: ItemKindSchema,
    category: ItemCategorySchema,
    name: z.string().min(1),
    description: z.string().optional(),
    flags: ItemFlagsSchema,
    scope: ItemScopeSchema.optional(),
    quoteDefaults: QuoteDefaultsSchema.optional(),
}).strict();

const ItemPatchSchema = z.object({
    itemId: z.string().min(1),
    patch: z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        flags: ItemFlagsSchema.optional(),
        scope: ItemScopeSchema.optional(),
        quoteDefaults: QuoteDefaultsSchema.optional(),
    }).strict(),
}).strict();

const ItemDeleteRequestSchema = z.object({
    itemId: z.string().min(1),
    reason: z.string(),
    requiresDoubleConfirm: z.literal(true),
}).strict();

const TaskCreateSchema = z.object({
    tempId: z.string().min(1),
    itemRef: ItemRefSchema,
    parentTaskTempId: z.string().nullable().optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    durationHours: z.number().min(0),
    status: TaskStatusSchema,
    tags: z.array(z.string()),
    plannedStart: z.string().datetime().nullable(),
    plannedEnd: z.string().datetime().nullable(),
}).strict();

const TaskPatchSchema = z.object({
    taskId: z.string().min(1),
    patch: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        durationHours: z.number().min(0).optional(),
        status: TaskStatusSchema.optional(),
        tags: z.array(z.string()).optional(),
        plannedStart: z.string().datetime().nullable().optional(),
        plannedEnd: z.string().datetime().nullable().optional(),
    }).strict(),
}).strict();

const TaskDependencySchema = z.object({
    fromTaskRef: TaskRefSchema,
    toTaskRef: TaskRefSchema,
    type: DependencyTypeSchema,
    lagHours: z.number().min(0),
}).strict();

const AccountingLineCreateSchema = z.object({
    tempId: z.string().min(1),
    itemRef: ItemRefSchema,
    taskRef: TaskRefSchema,
    lineType: AccountingLineTypeSchema,
    title: z.string().min(1),
    notes: z.string().optional(),
    quantity: z.number().min(0).optional(),
    unit: z.string().optional(),
    unitCost: z.number().min(0).optional(),
    currency: CurrencySchema,
    taxable: z.boolean(),
    vatRate: z.number().min(0).max(1),
    vendorNameFreeText: z.string().optional(),
    leadTimeDays: z.number().min(0).optional(),
    purchaseStatus: PurchaseStatusSchema,
}).strict();

const AccountingLinePatchSchema = z.object({
    lineId: z.string().min(1),
    patch: z.object({
        title: z.string().optional(),
        notes: z.string().optional(),
        quantity: z.number().min(0).optional(),
        unit: z.string().optional(),
        unitCost: z.number().min(0).optional(),
        currency: CurrencySchema.optional(),
        taxable: z.boolean().optional(),
        vatRate: z.number().min(0).max(1).optional(),
        vendorNameFreeText: z.string().optional(),
        leadTimeDays: z.number().min(0).optional(),
        purchaseStatus: PurchaseStatusSchema.optional(),
    }).strict(),
}).strict();

export const ChangeSetSchema = z.object({
    type: z.literal("ChangeSet"),
    projectId: z.string().min(1),
    phase: z.enum(["planning", "solutioning", "accounting", "tasks", "item_edit", "convert"]),
    agentName: z.string().min(1),
    summary: z.string(),
    assumptions: z.array(z.string()),
    openQuestions: z.array(z.string()),
    warnings: z.array(z.string()),
    items: z.object({
        create: z.array(ItemCreateSchema),
        patch: z.array(ItemPatchSchema),
        deleteRequest: z.array(ItemDeleteRequestSchema),
    }).strict(),
    tasks: z.object({
        create: z.array(TaskCreateSchema),
        patch: z.array(TaskPatchSchema),
        dependencies: z.array(TaskDependencySchema),
    }).strict(),
    accountingLines: z.object({
        create: z.array(AccountingLineCreateSchema),
        patch: z.array(AccountingLinePatchSchema),
    }).strict(),
    uiHints: z.object({
        focusItemIds: z.array(z.string()),
        expandItemIds: z.array(z.string()),
        nextSuggestedAction: z.enum([
            "approve_changeset",
            "ask_questions",
            "run_solutioning",
            "run_tasks",
            "generate_quote",
        ]),
    }).strict(),
}).strict();

export const ConceptPacketSchema = z.object({
    type: z.literal("ConceptPacket"),
    projectId: z.string().min(1),
    agentName: z.string().min(1),
    summary: z.string(),
    assumptions: z.array(z.string()),
    openQuestions: z.array(z.string()),
    concepts: z.object({
        create: z.array(z.object({
            tempId: z.string().min(1),
            title: z.string().min(1),
            oneLiner: z.string().min(1),
            narrative: z.string().min(1),
            style: z.object({
                materials: z.array(z.string()),
                colors: z.array(z.string()),
                lighting: z.array(z.string()),
                references: z.array(z.string()),
            }).strict(),
            feasibility: z.object({
                studioProduction: z.enum(["low", "medium", "high"]),
                purchases: z.enum(["low", "medium", "high"]),
                rentals: z.enum(["low", "medium", "high"]),
                moving: z.enum(["low", "medium", "high"]),
                installation: z.enum(["low", "medium", "high"]),
                mainRisks: z.array(z.string()),
            }).strict(),
            impliedItemCandidates: z.array(z.object({
                name: z.string().min(1),
                category: z.enum([
                    "set_piece",
                    "print",
                    "floor",
                    "prop",
                    "installation",
                    "transport",
                    "management",
                    "other",
                ]),
                notes: z.string(),
            }).strict()),
        }).strict()),
        patch: z.array(z.object({
            conceptId: z.string().min(1),
            patch: z.object({
                title: z.string().optional(),
                oneLiner: z.string().optional(),
                narrative: z.string().optional(),
            }).strict(),
        }).strict()),
    }).strict(),
}).strict();

export const ClarificationPacketSchema = z.object({
    type: z.literal("ClarificationPacket"),
    projectId: z.string().min(1),
    agentName: z.string().min(1),
    summaryOfKnowns: z.object({
        project: z.array(z.string()),
        constraints: z.array(z.string()),
        selectedItems: z.array(z.string()),
    }).strict(),
    blockingQuestions: z.array(z.object({
        id: z.string().min(1),
        scope: z.enum(["project", "item"]),
        itemId: z.string().nullable(),
        question: z.string().min(1),
        whyItMatters: z.string().min(1),
    }).strict()),
    assumptionsIfNoAnswer: z.array(z.string()),
    readyToExtractPlanWhen: z.array(z.string()),
}).strict();

export const QuoteDraftSchema = z.object({
    type: z.literal("QuoteDraft"),
    projectId: z.string().min(1),
    agentName: z.string().min(1),
    versionNote: z.string(),
    currency: CurrencySchema,
    pricesIncludeVat: z.boolean(),
    vatRate: z.number().min(0).max(1),
    client: z.object({
        name: z.string(),
        company: z.string(),
        email: z.string(),
    }).strict(),
    document: z.object({
        title: z.string().min(1),
        intro: z.string().min(1),
        scopeBullets: z.array(z.string()),
        lineItems: z.array(z.object({
            sortKey: z.string().min(1),
            displayName: z.string().min(1),
            description: z.string().optional(),
            quantity: z.number().min(0),
            unit: z.string().min(1),
            price: z.number().min(0),
            taxable: z.boolean(),
            vatRate: z.number().min(0).max(1).optional(),
        }).strict()),
        totals: z.object({
            subtotal: z.number().min(0),
            vat: z.number().min(0),
            total: z.number().min(0),
        }).strict(),
        paymentTerms: z.array(z.string()),
        scheduleAssumptions: z.array(z.string()),
        included: z.array(z.string()),
        excluded: z.array(z.string()),
        termsAndConditions: z.array(z.string()),
        validityDays: z.number().int().min(1),
    }).strict(),
    assumptions: z.array(z.string()),
    openQuestions: z.array(z.string()),
}).strict();

export const ResearchFindingsSchema = z.object({
    type: z.literal("ResearchFindings"),
    projectId: z.string().min(1),
    agentName: z.string().min(1),
    goal: z.string().min(1),
    queries: z.array(z.string()).min(1),
    keyFindings: z.array(z.object({
        topic: z.string().min(1),
        summary: z.string().min(1),
        options: z.array(z.object({
            name: z.string().min(1),
            pros: z.array(z.string()),
            cons: z.array(z.string()),
            bestFor: z.array(z.string()),
        }).strict()),
        estimatedRanges: z.array(z.object({
            what: z.string().min(1),
            low: z.number().min(0),
            high: z.number().min(0),
            currency: CurrencySchema,
            notes: z.string(),
        }).strict()),
        leadTimeNotes: z.array(z.string()),
        risks: z.array(z.string()),
    }).strict()),
    recommendedNextEdits: z.object({
        targetItemIds: z.array(z.string()),
        suggestedAccountingLinePatches: z.array(z.object({
            lineId: z.string().min(1),
            patch: z.object({
                unitCost: z.number().min(0).optional(),
                notes: z.string().optional(),
                leadTimeDays: z.number().min(0).optional(),
            }).strict(),
        }).strict()),
    }).strict(),
    citations: z.array(z.object({
        title: z.string(),
        url: z.string(),
        usedFor: z.string(),
    }).strict()),
    assumptions: z.array(z.string()),
    openQuestions: z.array(z.string()),
}).strict();

export const AgentOutputSchema = z.union([
    ChangeSetSchema,
    ConceptPacketSchema,
    ClarificationPacketSchema,
    QuoteDraftSchema,
    ResearchFindingsSchema,
]);

export const QuoteAgentResultSchema = z.object({
    mode: z.enum(["draft", "needs_clarification"]),
    clarifyingQuestions: z.array(z.object({
        id: z.string(),
        question: z.string().min(3),
        whyNeeded: z.string().min(3),
        bestGuessIfSkipped: z.string().optional().default(""),
    })).default([]),
    quote: z.object({
        language: z.literal("he"),
        quoteTitle: z.string().min(3),
        quoteNumber: z.string().optional().default(""),
        dateIssued: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        client: z.object({
            name: z.string().min(2),
            contactPerson: z.string().optional().default(""),
        }),
        project: z.object({
            name: z.string().min(2),
            locations: z.array(z.string()).default([]),
            dateRange: z.string().optional().default(""),
        }),
        executiveSummary: z.string().min(10),
        scopeIncludedBullets: z.array(z.string().min(3)).min(1),
        scopeExcludedBullets: z.array(z.string().min(3)).default([]),

        lineItems: z.array(z.object({
            itemId: z.string().min(1),
            title: z.string().min(2),
            shortDescription: z.string().optional().default(""),
            quantity: z.number().positive().default(1),
            unit: z.string().min(1).default("יחידה"),
            priceBeforeVat: z.number().nonnegative(),
            vatMode: z.enum(["PLUS_VAT", "INCLUDES_VAT"]).default("PLUS_VAT"),
            notes: z.string().optional().default(""),
        })).min(1),

        totals: z.object({
            currency: z.string().default("ILS"),
            subtotalBeforeVat: z.number().nonnegative(),
            vatRate: z.number().min(0).max(1).default(0.17),
            vatAmount: z.number().nonnegative(),
            totalWithVat: z.number().nonnegative(),
            roundingNotes: z.string().optional().default(""),
        }),

        paymentTerms: z.object({
            templateId: z.enum(["NET30_40_60_NET60", "MATERIALS_ADVANCE_30_PERCENT", "CUSTOM"]),
            textBullets: z.array(z.string().min(3)).min(1),
        }),

        validity: z.object({
            days: z.number().int().positive().default(14),
            text: z.string().min(5),
        }),

        leadTime: z.object({
            businessDays: z.number().int().positive().default(14),
            text: z.string().min(5),
        }),

        safetyAndLiability: z.array(z.string()).default([]),
        changePolicy: z.array(z.string()).default([]),

        approvalBlock: z.object({
            text: z.string().min(10),
            fields: z.array(z.string().min(2)).min(2),
        }),

        footer: z.object({
            studioName: z.string().min(2),
            tagline: z.string().optional().default(""),
            email: z.string().optional().default(""),
            phone: z.string().optional().default(""),
            bankDetails: z.string().optional().default(""),
        }),

        assumptionsMissingInfo: z.array(z.string()).default([]),
    }).optional(),

    clientFacingDocumentMarkdown: z.string().optional(),
}).superRefine((val, ctx) => {
    if (val.mode === "needs_clarification") {
        if (!val.clarifyingQuestions?.length) {
            ctx.addIssue({ code: "custom", message: "needs_clarification requires clarifyingQuestions[]" });
        }
        if (val.clientFacingDocumentMarkdown) {
            ctx.addIssue({ code: "custom", message: "Do not output markdown when mode=needs_clarification" });
        }
        return;
    }

    // draft mode validations
    if (!val.quote) {
        ctx.addIssue({ code: "custom", message: "draft requires quote" });
        return;
    }
    if (!val.clientFacingDocumentMarkdown?.length) {
        ctx.addIssue({ code: "custom", message: "draft requires clientFacingDocumentMarkdown" });
    }

    const q = val.quote!;
    const sum = q.lineItems.reduce((acc, li) => acc + (li.priceBeforeVat * (li.quantity ?? 1)), 0);
    const eps = 0.5; // allow tiny rounding
    if (Math.abs(sum - q.totals.subtotalBeforeVat) > eps) {
        ctx.addIssue({ code: "custom", message: `Totals mismatch: lineItems sum=${sum} subtotalBeforeVat=${q.totals.subtotalBeforeVat}` });
    }

    const expectedVat = q.totals.subtotalBeforeVat * q.totals.vatRate;
    if (Math.abs(expectedVat - q.totals.vatAmount) > 2) {
        ctx.addIssue({ code: "custom", message: "VAT amount not consistent with subtotal * vatRate" });
    }

    const expectedTotal = q.totals.subtotalBeforeVat + q.totals.vatAmount;
    if (Math.abs(expectedTotal - q.totals.totalWithVat) > 2) {
        ctx.addIssue({ code: "custom", message: "totalWithVat not consistent with subtotal + vatAmount" });
    }
});

export type ItemSpecV2 = z.infer<typeof ItemSpecV2Schema>;
export type ItemUpdateOutput = z.infer<typeof ItemUpdateOutputSchema>;
export type SolutionItemPlanV1 = z.infer<typeof SolutionItemPlanV1Schema>;
export type ChangeSet = z.infer<typeof ChangeSetSchema>;
export type ConceptPacket = z.infer<typeof ConceptPacketSchema>;
export type ClarificationPacket = z.infer<typeof ClarificationPacketSchema>;
export type QuoteDraft = z.infer<typeof QuoteDraftSchema>;
export type ResearchFindings = z.infer<typeof ResearchFindingsSchema>;
export type QuoteAgentResult = z.infer<typeof QuoteAgentResultSchema>;
