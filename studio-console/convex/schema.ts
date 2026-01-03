import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { STUDIO_PHASES, TASK_STATUSES, TASK_CATEGORIES, TASK_PRIORITIES } from "./constants";
import {
    evidenceSchema,
    factValueSchema,
    factStatusSchema,
    factSourceKindSchema,
    factScopeTypeSchema,
    factParseRunStatusSchema,
    factParseRunStatsSchema
} from "./lib/facts/schemas";

export default defineSchema({
    // --- TEMPLATES REFACTOR TABLES ---

    // 0.1 Templates (Versioned recipes)
    templateDefinitions: defineTable({
        templateId: v.string(), // Stable ID e.g. "print_beita"
        version: v.number(),
        name: v.string(),
        appliesToKind: v.union(v.literal("deliverable"), v.literal("day"), v.literal("service")),
        fields: v.array(v.object({
            key: v.string(),
            label: v.string(),
            type: v.union(v.literal("text"), v.literal("number"), v.literal("boolean")),
            required: v.boolean(),
            default: v.optional(v.any()), // serialized
        })),
        tasks: v.array(v.object({
            title: v.string(),
            category: v.string(),
            role: v.string(),
            effortDays: v.number(),
            condition: v.optional(v.object({ field: v.string(), equals: v.any() })),
            // ... other task defaults can be added here
        })),
        materials: v.array(v.object({
            name: v.string(), // placeholder name
            spec: v.optional(v.string()),
            qty: v.optional(v.number()),
            unit: v.optional(v.string()),
            defaultVendorRole: v.optional(v.string())
        })),
        companionRules: v.optional(v.array(v.object({
            type: v.union(v.literal("suggestItem"), v.literal("autoAddItem")),
            templateId: v.string(),
            when: v.string() // simple rule string e.g. "always", "projectFlag:onSiteSetup"
        }))),
        quotePattern: v.optional(v.string()), // Hebrew pattern
        status: v.union(v.literal("draft"), v.literal("published")),
        createdAt: v.number(),
        createdBy: v.optional(v.string()),
    }).index("by_templateId_version", ["templateId", "version"])
        .index("by_status", ["status"]),

    // 0.2 Role Catalog (Global Defaults)
    roleCatalog: defineTable({
        roleName: v.string(),
        defaultRatePerDay: v.number(),
        isInternalRole: v.boolean(),
        isVendorRole: v.boolean(),
    }).index("by_roleName", ["roleName"]),

    // 0.3 Project Pricing Policy (Overrides)
    projectPricingPolicy: defineTable({
        projectId: v.id("projects"),
        overheadPct: v.number(), // 0.15
        riskPct: v.number(),     // 0.10
        profitPct: v.number(),   // 0.30
        currency: v.string(),    // "ILS"
        roundingPolicy: v.optional(v.string()),
    }).index("by_project", ["projectId"]),

    // 0.4 Project Role Rates (Overrides)
    projectRoleRates: defineTable({
        projectId: v.id("projects"),
        roleName: v.string(),
        ratePerDay: v.number(),
    }).index("by_project_role", ["projectId", "roleName"]),

    // 0.5 Project Brief (Extracted strict fields)
    projectBrief: defineTable({
        projectId: v.id("projects"),
        name: v.string(),
        clientName: v.optional(v.string()),
        locationText: v.optional(v.string()),
        dates: v.optional(v.object({
            start: v.optional(v.string()),
            end: v.optional(v.string()),
            installDay: v.optional(v.string()),
            shootDay: v.optional(v.string()),
            teardownDay: v.optional(v.string()),
        })),
        projectFlags: v.optional(v.object({
            studioBuild: v.optional(v.boolean()),
            prints: v.optional(v.boolean()),
            transport: v.optional(v.boolean()),
            install: v.optional(v.boolean()),
            rental: v.optional(v.boolean()),
            event: v.optional(v.boolean()),
        })),
        constraints: v.optional(v.array(v.object({
            id: v.string(),
            text: v.string(),
            source: v.optional(v.string()),
            createdAt: v.number(),
        }))),
        preferences: v.optional(v.array(v.object({
            id: v.string(),
            text: v.string(),
            source: v.optional(v.string()),
            createdAt: v.number(),
        }))),
        assumptions: v.optional(v.array(v.object({
            id: v.string(),
            text: v.string(),
            source: v.optional(v.string()),
            createdAt: v.number(),
        }))),
        risks: v.optional(v.array(v.object({
            id: v.string(),
            title: v.string(),
            severity: v.number(), // 1-5
            likelihood: v.number(), // 1-5
            mitigation: v.optional(v.string()),
            ownerRole: v.optional(v.string()),
        }))),
        memoryBullets: v.optional(v.array(v.object({
            id: v.string(),
            text: v.string(),
            createdAt: v.number(),
            source: v.optional(v.string()),
        }))),
        freeNotes: v.optional(v.string()), // markdown
    }).index("by_project", ["projectId"]),

    // 1. PROJECTS: Core entity
    // 1. PROJECTS: Core entity
    projects: defineTable({
        name: v.string(),
        clientName: v.string(),
        status: v.union(
            v.literal("lead"),
            v.literal("planning"),
            v.literal("production"),
            v.literal("archived")
        ),
        stage: v.optional(
            v.union(
                v.literal("ideation"),
                v.literal("planning"),
                v.literal("production"),
                v.literal("done")
            )
        ),
        projectTypes: v.optional(
            v.array(
                v.union(
                    v.literal("dressing"),
                    v.literal("studio_build"),
                    v.literal("print_install"),
                    v.literal("big_install_takedown"),
                    v.literal("photoshoot")
                )
            )
        ),
        budgetTier: v.optional(
            v.union(
                v.literal("low"),
                v.literal("medium"),
                v.literal("high"),
                v.literal("unknown")
            )
        ),
        relatedPastProjectIds: v.optional(v.array(v.id("projects"))),
        defaultLanguage: v.optional(v.union(v.literal("he"), v.literal("en"))),
        details: v.object({
            eventDate: v.optional(v.string()), // ISO
            budgetCap: v.optional(v.number()),
            location: v.optional(v.string()),
            notes: v.optional(v.string()),
        }),
        overview: v.optional(v.object({
            projectType: v.optional(v.union(
                v.literal("photo_shoot"),
                v.literal("pop_up"),
                v.literal("window_display"),
                v.literal("event"),
                v.literal("commercial_set"),
                v.literal("other")
            )),
            properties: v.optional(v.object({
                requiresStudioProduction: v.optional(v.boolean()),
                requiresPurchases: v.optional(v.array(v.union(v.literal("local"), v.literal("abroad")))),
                requiresRentals: v.optional(v.boolean()),
                requiresMoving: v.optional(v.boolean()),
                requiresInstallation: v.optional(v.boolean()),
                requiresDismantle: v.optional(v.boolean()),
                includesShootDay: v.optional(v.boolean()),
                includesManagementFee: v.optional(v.boolean()),
            })),
            constraints: v.optional(v.object({
                budgetRange: v.optional(v.object({
                    min: v.optional(v.number()),
                    max: v.optional(v.number()),
                    currency: v.optional(v.string()),
                })),
                dates: v.optional(v.object({
                    install: v.optional(v.string()),
                    shoot: v.optional(v.string()),
                    dismantle: v.optional(v.string()),
                })),
                location: v.optional(v.string()),
                venueRules: v.optional(v.array(v.string())),
                qualityTier: v.optional(v.string()),
            })),
        })),
        features: v.optional(v.object({
            itemsModelV1: v.optional(v.boolean()),
            itemsTree: v.optional(v.boolean()),
            changeSetFlow: v.optional(v.boolean()),
            accountingLinesV1: v.optional(v.boolean()),
            factsV2: v.optional(v.boolean()),
            elementsCanonical: v.optional(v.boolean()),
            factsEnabled: v.optional(v.boolean()),
        })),
        rootItemId: v.optional(v.id("projectItems")),
        overviewSummary: v.optional(v.string()),
        createdAt: v.number(),  // Date.now()
        createdBy: v.string(),  // userId/email (local for now)

        // Accounting / Costing Fields
        currency: v.optional(v.string()), // e.g. "ILS", "USD"
        vatRate: v.optional(v.number()),        // e.g. 0.17
        pricesIncludeVat: v.optional(v.boolean()),
        overheadPercent: v.optional(v.number()), // 0.15
        riskPercent: v.optional(v.number()),     // 0.10
        profitPercent: v.optional(v.number()),   // 0.30
    })
        .index("by_status", ["status"])
        .index("by_stage", ["stage"]),

    projectScenarios: defineTable({
        projectId: v.id("projects"),
        phase: v.union(
            v.literal("ideation"),
            v.literal("clarification"),
            v.literal("planning"),
            v.literal("solutioning"),
            v.literal("tasks"),
            v.literal("quote")
        ),
        scenarioKey: v.string(), // e.g. "default"
        title: v.optional(v.string()),
        metadataJson: v.optional(v.string()),
        createdAt: v.number(),
        createdBy: v.string(),
        updatedAt: v.optional(v.number()),
    })
        .index("by_project_phase_key", ["projectId", "phase", "scenarioKey"])
        .index("by_project_phase", ["projectId", "phase"]),

    chatThreads: defineTable({
        projectId: v.id("projects"),
        scenarioId: v.id("projectScenarios"),
        title: v.optional(v.string()),
        createdAt: v.number(),
        createdBy: v.string(),
        updatedAt: v.optional(v.number()),
    })
        .index("by_project", ["projectId"])
        .index("by_scenario", ["scenarioId"]),

    chatMessages: defineTable({
        projectId: v.id("projects"),
        scenarioId: v.id("projectScenarios"),
        threadId: v.id("chatThreads"),
        role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
        content: v.string(),
        status: v.optional(v.union(v.literal("streaming"), v.literal("final"), v.literal("error"))),
        createdAt: v.number(),
        createdBy: v.string(),
        updatedAt: v.optional(v.number()),
    }).index("by_thread_createdAt", ["threadId", "createdAt"]),

    ideationConceptCards: defineTable({
        projectId: v.id("projects"),
        threadId: v.id("chatThreads"),
        title: v.string(),
        oneLiner: v.string(),
        detailsMarkdown: v.string(),
        createdAt: v.number(),
        createdBy: v.string(),
    }).index("by_project_createdAt", ["projectId", "createdAt"]),

    ideaSelections: defineTable({
        projectId: v.id("projects"),
        conceptCardIds: v.array(v.id("ideationConceptCards")),
        notes: v.optional(v.string()),
        status: v.union(v.literal("pending"), v.literal("converted"), v.literal("failed")),
        changeSetId: v.optional(v.id("itemChangeSets")),
        createdAt: v.number(),
        createdBy: v.string(),
        updatedAt: v.optional(v.number()),
    }).index("by_project_createdAt", ["projectId", "createdAt"]),

    projectAssets: defineTable({
        projectId: v.id("projects"),
        kind: v.union(v.literal("image")),
        storageId: v.string(),
        mimeType: v.string(),
        filename: v.optional(v.string()),
        source: v.union(v.literal("upload"), v.literal("generated")),
        prompt: v.optional(v.string()),
        provider: v.optional(v.string()),
        model: v.optional(v.string()),
        width: v.optional(v.number()),
        height: v.optional(v.number()),
        createdAt: v.number(),
        createdBy: v.string(),
    })
        .index("by_project_createdAt", ["projectId", "createdAt"])
        .index("by_storageId", ["storageId"]),

    assetLinks: defineTable({
        projectId: v.id("projects"),
        assetId: v.id("projectAssets"),
        entityType: v.union(
            v.literal("materialLine"),
            v.literal("projectItem"),
            v.literal("task"),
            v.literal("quote")
        ),
        entityId: v.string(),
        role: v.optional(v.string()),
        createdAt: v.number(),
        createdBy: v.string(),
    })
        .index("by_project_entity", ["projectId", "entityType", "entityId"])
        .index("by_project_asset_entity", ["projectId", "assetId", "entityType", "entityId"])
        .index("by_asset", ["assetId"]),

    projectItems: defineTable({
        projectId: v.id("projects"),
        title: v.string(),
        typeKey: v.string(),
        status: v.union(
            v.literal("draft"),
            v.literal("proposed"),
            v.literal("approved"),
            v.literal("in_progress"),
            v.literal("done"),
            v.literal("blocked"),
            v.literal("cancelled"),
            v.literal("archived")
        ),
        parentItemId: v.optional(v.union(v.id("projectItems"), v.null())),
        sortKey: v.optional(v.string()),
        kind: v.optional(v.string()),
        category: v.optional(v.string()),
        name: v.optional(v.string()),
        description: v.optional(v.string()),
        flags: v.optional(v.object({
            requiresStudio: v.optional(v.boolean()),
            requiresPurchase: v.optional(v.boolean()),
            purchaseMode: v.optional(v.union(
                v.literal("local"),
                v.literal("abroad"),
                v.literal("both"),
                v.literal("none")
            )),
            requiresRental: v.optional(v.boolean()),
            requiresMoving: v.optional(v.boolean()),
            requiresInstallation: v.optional(v.boolean()),
            requiresDismantle: v.optional(v.boolean()),
        })),
        scope: v.optional(v.object({
            quantity: v.optional(v.number()),
            unit: v.optional(v.string()),
            dimensions: v.optional(v.string()),
            location: v.optional(v.string()),
            dueDate: v.optional(v.string()),
            constraints: v.optional(v.array(v.string())),
            assumptions: v.optional(v.array(v.string())),
        })),
        links: v.optional(v.object({
            knowledgeDocIds: v.optional(v.array(v.id("knowledgeDocs"))),
            pastProjectIds: v.optional(v.array(v.id("projects"))),
            externalUrls: v.optional(v.array(v.string())),
            trelloCardIds: v.optional(v.array(v.string())),
        })),
        rollups: v.optional(v.object({
            cost: v.optional(v.object({
                material: v.optional(v.number()),
                labor: v.optional(v.number()),
                rentals: v.optional(v.number()),
                purchases: v.optional(v.number()),
                shipping: v.optional(v.number()),
                misc: v.optional(v.number()),
                totalCost: v.optional(v.number()),
                sellPrice: v.optional(v.number()),
                margin: v.optional(v.number()),
                currency: v.optional(v.string()),
            })),
            schedule: v.optional(v.object({
                durationHours: v.optional(v.number()),
                plannedStart: v.optional(v.string()),
                plannedEnd: v.optional(v.string()),
                progressPct: v.optional(v.number()),
                blocked: v.optional(v.boolean()),
            })),
            tasks: v.optional(v.object({
                total: v.optional(v.number()),
                done: v.optional(v.number()),
                blocked: v.optional(v.number()),
            })),
        })),
        quoteDefaults: v.optional(v.object({
            includeByDefault: v.optional(v.boolean()),
            displayName: v.optional(v.string()),
            taxable: v.optional(v.boolean()),
            vatRate: v.optional(v.number()),
        })),
        lockedByPhase: v.optional(v.union(
            v.literal("planning"),
            v.literal("solutioning"),
            v.literal("accounting"),
            v.literal("tasks"),
            v.literal("item_edit"),
            v.literal("convert"),
            v.literal("element_edit"),
            v.literal("procurement"),
            v.literal("runbook"),
            v.literal("closeout")
        )),
        deleteRequestedBy: v.optional(v.string()),
        deletedAt: v.optional(v.number()),
        searchText: v.optional(v.string()),
        sortOrder: v.optional(v.number()),
        tags: v.optional(v.array(v.string())),
        elementStatus: v.optional(v.union(
            v.literal("suggested"),
            v.literal("active"),
            v.literal("archived")
        )),
        elementNotesMarkdown: v.optional(v.string()),
        publishedVersionId: v.optional(v.id("elementVersions")),
        activeVersionId: v.optional(v.id("elementVersions")),
        createdFrom: v.object({
            source: v.union(
                v.literal("manual"),
                v.literal("ideationCard"),
                v.literal("planning"),
                v.literal("accountingBackfill"),
                v.literal("agent")
            ),
            sourceId: v.optional(v.string()),
        }),
        approvedRevisionId: v.optional(v.id("itemRevisions")),
        latestRevisionNumber: v.number(),
        deleteRequestedAt: v.optional(v.number()),
        archivedAt: v.optional(v.number()),
        manualOverrides: v.optional(v.any()),
        projectionCache: v.optional(v.any()),
        projectionRevision: v.optional(v.number()),
        lastMaterializedAt: v.optional(v.number()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_project_status", ["projectId", "status"])
        .index("by_project_sort", ["projectId", "sortOrder"])
        .index("by_project_type", ["projectId", "typeKey"])
        .index("by_project_parent_sort", ["projectId", "parentItemId", "sortKey"])
        .index("by_project_kind", ["projectId", "kind"])
        .index("by_project_category", ["projectId", "category"])
        .searchIndex("search_items", { searchField: "searchText" }),

    itemRevisions: defineTable({
        projectId: v.id("projects"),
        itemId: v.id("projectItems"),
        tabScope: v.union(
            v.literal("ideation"),
            v.literal("clarification"),
            v.literal("planning"),
            v.literal("solutioning"),
            v.literal("accounting"),
            v.literal("tasks"),
            v.literal("quote")
        ),
        phase: v.optional(v.union(
            v.literal("planning"),
            v.literal("solutioning"),
            v.literal("accounting"),
            v.literal("tasks"),
            v.literal("item_edit"),
            v.literal("convert"),
            v.literal("element_edit"),
            v.literal("procurement"),
            v.literal("runbook"),
            v.literal("closeout")
        )),
        source: v.optional(v.union(v.literal("user"), v.literal("agent"))),
        agentName: v.optional(v.string()),
        runId: v.optional(v.string()),
        revisionType: v.optional(v.union(v.literal("snapshot"), v.literal("patch"))),
        snapshotJson: v.optional(v.string()),
        patchJson: v.optional(v.string()),
        changeSetId: v.optional(v.id("itemChangeSets")),
        parentRevisionId: v.optional(v.id("itemRevisions")),
        baseRevisionId: v.optional(v.id("itemRevisions")),
        appliedAt: v.optional(v.number()),
        appliedBy: v.optional(v.string()),
        summary: v.optional(v.string()),
        state: v.union(
            v.literal("proposed"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("superseded")
        ),
        revisionNumber: v.number(),
        baseApprovedRevisionId: v.optional(v.id("itemRevisions")),
        approvedAt: v.optional(v.number()),
        approvedBy: v.optional(v.string()),
        digestText: v.optional(v.string()),
        data: v.any(),
        summaryMarkdown: v.optional(v.string()),
        createdBy: v.object({
            kind: v.union(v.literal("user"), v.literal("agent")),
            agentRunId: v.optional(v.id("agentRuns")),
        }),
        createdAt: v.number(),
    })
        .index("by_item_revision", ["itemId", "revisionNumber"])
        .index("by_project_tab_state", ["projectId", "tabScope", "state"])
        .index("by_project_state", ["projectId", "state"])
        .index("by_project_phase", ["projectId", "phase"])
        .index("by_changeSet", ["changeSetId"])
        .index("by_item", ["itemId"]),

    revisions: defineTable({
        projectId: v.id("projects"),
        status: v.union(v.literal("draft"), v.literal("approved"), v.literal("rejected")),
        originTab: v.union(
            v.literal("Ideation"),
            v.literal("Planning"),
            v.literal("Solutioning"),
            v.literal("Accounting"),
            v.literal("Tasks")
        ),
        actionType: v.union(
            v.literal("manual_edit"),
            v.literal("agent_suggestions"),
            v.literal("dependency_calc"),
            v.literal("critique"),
            v.literal("stress_test"),
            v.literal("risk_scan"),
            v.literal("improve")
        ),
        tags: v.array(v.string()),
        summary: v.string(),
        affectedElementIds: v.array(v.id("projectItems")),
        createdAt: v.number(),
        createdBy: v.string(),
    })
        .index("by_project_status", ["projectId", "status"])
        .index("by_project_tab_status", ["projectId", "originTab", "status"]),

    revisionChanges: defineTable({
        revisionId: v.id("revisions"),
        elementId: v.id("projectItems"),
        baseVersionId: v.optional(v.id("elementVersions")),
        replaceMask: v.array(v.string()),
        patchOps: v.optional(v.any()),
        proposedSnapshot: v.optional(v.any()),
        diffPreview: v.optional(v.any()),
    })
        .index("by_revision", ["revisionId"])
        .index("by_revision_element", ["revisionId", "elementId"]),

    itemChangeSets: defineTable({
        projectId: v.id("projects"),
        phase: v.union(
            v.literal("planning"),
            v.literal("solutioning"),
            v.literal("accounting"),
            v.literal("tasks"),
            v.literal("item_edit"),
            v.literal("convert"),
            v.literal("element_edit"),
            v.literal("procurement"),
            v.literal("runbook"),
            v.literal("closeout")
        ),
        agentName: v.string(),
        runId: v.optional(v.string()),
        ideaSelectionId: v.optional(v.id("ideaSelections")),
        status: v.union(
            v.literal("pending"),
            v.literal("approved"),
            v.literal("rejected")
        ),
        createdAt: v.number(),
        decidedAt: v.optional(v.number()),
        decidedBy: v.optional(v.string()),
        title: v.optional(v.string()),
        warnings: v.optional(v.array(v.string())),
        assumptions: v.optional(v.array(v.string())),
        openQuestions: v.optional(v.array(v.string())),
        basedOnBulletIds: v.optional(v.array(v.string())),
        basedOnApprovedSnapshotId: v.optional(v.string()),
        conflictsReferenced: v.optional(v.array(v.string())),
        counts: v.optional(v.object({
            items: v.optional(v.number()),
            tasks: v.optional(v.number()),
            accountingLines: v.optional(v.number()),
            dependencies: v.optional(v.number()),
            materialLines: v.optional(v.number()),
        })),
    })
        .index("by_project_phase_status", ["projectId", "phase", "status"])
        .index("by_project", ["projectId"])
        .index("by_project_phase", ["projectId", "phase"])
        .index("by_run", ["runId"]),

    itemChangeSetOps: defineTable({
        projectId: v.id("projects"),
        changeSetId: v.id("itemChangeSets"),
        entityType: v.union(
            v.literal("item"),
            v.literal("task"),
            v.literal("accountingLine"),
            v.literal("dependency"),
            v.literal("materialLine")
        ),
        opType: v.union(
            v.literal("create"),
            v.literal("patch"),
            v.literal("delete")
        ),
        targetId: v.optional(v.string()),
        tempId: v.optional(v.string()),
        baseRevisionId: v.optional(v.id("itemRevisions")),
        payloadJson: v.string(),
        createdAt: v.number(),
    })
        .index("by_changeSet", ["changeSetId"])
        .index("by_changeSet_entity", ["changeSetId", "entityType"])
        .index("by_project", ["projectId"]),

    itemLocks: defineTable({
        projectId: v.id("projects"),
        itemId: v.optional(v.id("projectItems")),
        phase: v.union(
            v.literal("planning"),
            v.literal("solutioning"),
            v.literal("accounting"),
            v.literal("tasks"),
            v.literal("item_edit"),
            v.literal("convert"),
            v.literal("element_edit"),
            v.literal("procurement"),
            v.literal("runbook"),
            v.literal("closeout")
        ),
        lockedBy: v.string(),
        runId: v.optional(v.string()),
        lockedAt: v.number(),
        expiresAt: v.optional(v.number()),
    })
        .index("by_project_phase", ["projectId", "phase"])
        .index("by_item_phase", ["itemId", "phase"])
        .index("by_run", ["runId"]),

    itemTemplates: defineTable({
        key: v.string(),
        label: v.string(),
        typeKey: v.string(),
        defaultData: v.any(),
        enabled: v.boolean(),
        sortOrder: v.number(),
    }),

    itemProjectionLocks: defineTable({
        projectId: v.id("projects"),
        itemId: v.id("projectItems"),
        lastSyncedRevisionId: v.optional(v.id("itemRevisions")),
        lastSyncedAt: v.number(),
    }).index("by_project_item", ["projectId", "itemId"]),

    elementVersions: defineTable({
        projectId: v.id("projects"),
        elementId: v.id("projectItems"),
        createdAt: v.number(),
        createdBy: v.string(),
        revisionId: v.optional(v.id("revisions")),
        createdFrom: v.optional(v.object({
            tab: v.optional(v.string()),
            source: v.optional(v.string()),
        })),
        tags: v.optional(v.array(v.string())),
        summary: v.optional(v.string()),
        changeStats: v.optional(v.any()),
        basedOnVersionId: v.optional(v.id("elementVersions")),
        appliedFactIds: v.optional(v.array(v.id("facts"))),
        data: v.optional(v.any()),
        freeText: v.optional(v.any()),
        hashes: v.optional(v.object({
            dataHash: v.string(),
            freeTextHashByBucket: v.any(),
        })),
        diffSummaryHe: v.optional(v.string()),
        snapshot: v.optional(v.any()),
    })
        .index("by_element_createdAt", ["elementId", "createdAt"])
        .index("by_project_createdAt", ["projectId", "createdAt"]),

    elementDrafts: defineTable({
        projectId: v.id("projects"),
        elementId: v.id("projectItems"),
        data: v.any(),
        createdAt: v.number(),
        updatedAt: v.number(),
        createdBy: v.optional(v.string()),
    })
        .index("by_project_element", ["projectId", "elementId"])
        .index("by_project_updatedAt", ["projectId", "updatedAt"]),

    elementDraftApprovals: defineTable({
        projectId: v.id("projects"),
        elementId: v.id("projectItems"),
        draftId: v.id("elementDrafts"),
        approvedRevisionId: v.id("itemRevisions"),
        approvedAt: v.number(),
        approvedBy: v.optional(v.string()),
    })
        .index("by_project_approvedAt", ["projectId", "approvedAt"])
        .index("by_element_approvedAt", ["elementId", "approvedAt"]),

    projectVersions: defineTable({
        projectId: v.id("projects"),
        createdAt: v.number(),
        createdBy: v.string(),
        publishedElementVersionIds: v.array(v.id("elementVersions")),
        noteHe: v.optional(v.string()),
        hash: v.string(),
    })
        .index("by_project_createdAt", ["projectId", "createdAt"]),

    questionQueue: defineTable({
        projectId: v.id("projects"),
        elementId: v.optional(v.id("projectItems")),
        categoryHe: v.string(),
        questionKey: v.string(),
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
        status: v.union(
            v.literal("open"),
            v.literal("answered"),
            v.literal("dismissed")
        ),
        answeredByFactId: v.optional(v.id("facts")),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_project_key", ["projectId", "questionKey"])
        .index("by_project_status", ["projectId", "status"]),

    derivationRuns: defineTable({
        projectId: v.id("projects"),
        triggerType: v.union(
            v.literal("elementVersion"),
            v.literal("projectVersion")
        ),
        triggerId: v.union(v.id("elementVersions"), v.id("projectVersions")),
        mode: v.union(v.literal("patch"), v.literal("replace")),
        status: v.union(
            v.literal("proposed"),
            v.literal("applied"),
            v.literal("rejected"),
            v.literal("error")
        ),
        changeSet: v.any(),
        error: v.optional(v.string()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_project_createdAt", ["projectId", "createdAt"])
        .index("by_project_status", ["projectId", "status"])
        .index("by_trigger", ["triggerType", "triggerId"]),

    rateLimitBuckets: defineTable({
        key: v.string(),
        windowStart: v.number(),
        count: v.number(),
        updatedAt: v.number(),
    }).index("by_key", ["key"]),

    // 16. SECTIONS (Budget Lines)
    sections: defineTable({
        projectId: v.id("projects"),
        itemId: v.optional(v.id("projectItems")),
        group: v.string(), // e.g., "Studio Elements", "Logistics"
        name: v.string(),
        description: v.optional(v.string()),
        sortOrder: v.number(),
        pricingMode: v.union(v.literal("estimated"), v.literal("actual"), v.literal("mixed")),

        // Per-section overrides
        overheadPercentOverride: v.optional(v.number()),
        riskPercentOverride: v.optional(v.number()),
        profitPercentOverride: v.optional(v.number()),
    })
        .index("by_project", ["projectId"])
        .index("by_project_group", ["projectId", "group"]),

    // 17. MATERIAL LINES (The "E" in cost)
    materialLines: defineTable({
        sectionId: v.id("sections"),
        projectId: v.id("projects"), // Denormalized for easier querying
        itemId: v.optional(v.id("projectItems")),
        taskId: v.optional(v.id("tasks")),
        itemMaterialId: v.optional(v.string()),
        category: v.string(), // e.g., "PVC", "Paint"
        label: v.string(),
        description: v.optional(v.string()),
        workstream: v.optional(v.string()),
        isManagement: v.optional(v.boolean()),
        quoteVisibility: v.optional(v.union(
            v.literal("include"),
            v.literal("exclude"),
            v.literal("optional")
        )),

        procurement: v.optional(
            v.union(
                v.literal("in_stock"),
                v.literal("local"),
                v.literal("abroad"),
                v.literal("either")
            )
        ),

        // Vendor Link
        vendorId: v.optional(v.id("vendors")),
        vendorName: v.optional(v.string()), // Snapshot or ad-hoc name
        canonicalItemId: v.optional(v.id("canonicalItems")),

        unit: v.string(), // m, sqm, unit

        // Planning
        plannedQuantity: v.number(),
        plannedUnitCost: v.number(),

        // Actuals
        actualQuantity: v.optional(v.number()),
        actualUnitCost: v.optional(v.number()),

        taxRate: v.optional(v.number()), // e.g., 0.17
        status: v.string(), // planned, ordered, received, paid
        note: v.optional(v.string()),

        // Solutioning Agent Fields
        solutioned: v.optional(v.boolean()),
        solutionPlan: v.optional(v.string()), // The "how to" text
        solutionPlanJson: v.optional(v.string()), // JSON string for structured plan
        lastUpdatedBy: v.optional(v.string()),
        updatedAt: v.optional(v.number()),
        origin: v.optional(v.object({
            source: v.union(v.literal("template"), v.literal("user"), v.literal("ai")),
            templateId: v.optional(v.string()),
            version: v.optional(v.number()),
            templateMaterialId: v.optional(v.string())
        })),
        generation: v.optional(v.union(v.literal("generated"), v.literal("manual"))),
        lock: v.optional(v.boolean()),
        derivedFrom: v.optional(v.object({
            elementVersionId: v.id("elementVersions"),
            projectVersionId: v.optional(v.id("projectVersions")),
            derivationRunId: v.id("derivationRuns"),
        })),
    })
        .index("by_section", ["sectionId"])
        .index("by_project", ["projectId"])
        .index("by_project_item", ["projectId", "itemId"])
        .index("by_project_task", ["projectId", "taskId"]),

    // 18. WORK LINES (The "S" in cost)
    workLines: defineTable({
        sectionId: v.id("sections"),
        projectId: v.id("projects"),
        itemId: v.optional(v.id("projectItems")),
        taskId: v.optional(v.id("tasks")),
        itemLaborId: v.optional(v.string()),
        workType: v.string(), // studio, field, management
        role: v.string(),
        personId: v.optional(v.string()), // Link to user/employee if needed
        workstream: v.optional(v.string()),
        isManagement: v.optional(v.boolean()),
        quoteVisibility: v.optional(v.union(
            v.literal("include"),
            v.literal("exclude"),
            v.literal("optional")
        )),

        rateType: v.string(), // hour, day, flat

        // Planning
        plannedQuantity: v.number(),
        plannedUnitCost: v.number(),

        // Actuals
        actualQuantity: v.optional(v.number()),
        actualUnitCost: v.optional(v.number()),

        status: v.string(), // planned, scheduled, done, paid
        description: v.optional(v.string()),
        generation: v.optional(v.union(v.literal("generated"), v.literal("manual"))),
        lock: v.optional(v.boolean()),
        derivedFrom: v.optional(v.object({
            elementVersionId: v.id("elementVersions"),
            projectVersionId: v.optional(v.id("projectVersions")),
            derivationRunId: v.id("derivationRuns"),
        })),
    })
        .index("by_section", ["sectionId"])
        .index("by_project", ["projectId"])
        .index("by_project_item", ["projectId", "itemId"])
        .index("by_project_task", ["projectId", "taskId"]),

    accountingLines: defineTable({
        projectId: v.id("projects"),
        itemId: v.id("projectItems"),
        taskId: v.optional(v.id("tasks")),
        lineType: v.union(
            v.literal("material"),
            v.literal("labor"),
            v.literal("purchase"),
            v.literal("rental"),
            v.literal("shipping"),
            v.literal("service"),
            v.literal("misc")
        ),
        title: v.string(),
        notes: v.optional(v.string()),
        workstream: v.optional(v.string()),
        isManagement: v.optional(v.boolean()),
        quoteVisibility: v.optional(v.union(
            v.literal("include"),
            v.literal("exclude"),
            v.literal("optional")
        )),
        quantity: v.optional(v.number()),
        unit: v.optional(v.string()),
        unitCost: v.optional(v.number()),
        currency: v.string(),
        taxable: v.optional(v.boolean()),
        vatRate: v.optional(v.number()),
        vendorNameFreeText: v.optional(v.string()),
        leadTimeDays: v.optional(v.number()),
        purchaseStatus: v.optional(v.union(
            v.literal("planned"),
            v.literal("quoted"),
            v.literal("ordered"),
            v.literal("received"),
            v.literal("cancelled")
        )),
        createdAt: v.number(),
        updatedAt: v.number(),
        generation: v.optional(v.union(v.literal("generated"), v.literal("manual"))),
        lock: v.optional(v.boolean()),
        derivedFrom: v.optional(v.object({
            elementVersionId: v.id("elementVersions"),
            projectVersionId: v.optional(v.id("projectVersions")),
            derivationRunId: v.id("derivationRuns"),
        })),
    })
        .index("by_project", ["projectId"])
        .index("by_project_item", ["projectId", "itemId"])
        .index("by_project_task", ["projectId", "taskId"])
        .index("by_project_lineType", ["projectId", "lineType"]),

    // 19. VENDORS (Knowledge Base)
    vendors: defineTable({
        name: v.string(),
        category: v.optional(v.string()),
        contactInfo: v.optional(v.string()),
        rating: v.optional(v.number()),
        description: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
    }).searchIndex("search_name", { searchField: "name" }),

    // 20. MATERIAL CATALOG (Historical Data)
    materialCatalog: defineTable({
        category: v.string(),
        name: v.string(),
        defaultUnit: v.string(),
        lastPrice: v.number(),
        vendorId: v.optional(v.id("vendors")),
        lastUpdated: v.number(), // Timestamp
        description: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
    }).searchIndex("search_material", { searchField: "name" }),

    // 21. LABOR RATES (Roles & Standard Costs)
    laborRates: defineTable({
        role: v.string(),        // "Carpenter", "Installer", "Project Manager"
        rateType: v.string(),    // "day", "hour"
        defaultRate: v.number(), // ILS
        category: v.optional(v.string()), // "Studio", "Field", "Management"
    }).searchIndex("search_role", { searchField: "role" }),

    // 22. EMPLOYEES (Staff & Contractors)
    employees: defineTable({
        name: v.string(),
        description: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        role: v.optional(v.string()),
        contactInfo: v.optional(v.string()),
        status: v.optional(v.string()),
    }).searchIndex("search_name", { searchField: "name" }),

    // 23. PURCHASES (Accounting / Operations)
    purchases: defineTable({
        itemName: v.string(),
        description: v.optional(v.string()),
        vendorId: v.optional(v.id("vendors")),
        materialId: v.optional(v.id("materialCatalog")),
        employeeId: v.optional(v.id("employees")),
        projectId: v.optional(v.id("projects")),
        amount: v.number(),
        quantity: v.optional(v.number()), // Added for Price Memory
        unit: v.optional(v.string()),     // Added for Price Memory
        currency: v.optional(v.string()),
        status: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        purchasedAt: v.optional(v.number()),
        createdAt: v.number(),
    }).index("by_project", ["projectId"]),
    // 2. CANONICAL TASKS: Internal Source of Truth
    tasks: defineTable({
        projectId: v.id("projects"),
        title: v.string(),
        description: v.optional(v.string()),
        status: v.union(
            v.literal(TASK_STATUSES[0]),
            v.literal(TASK_STATUSES[1]),
            v.literal(TASK_STATUSES[2]),
            v.literal(TASK_STATUSES[3])
        ),
        category: v.union(
            v.literal(TASK_CATEGORIES[0]),
            v.literal(TASK_CATEGORIES[1]),
            v.literal(TASK_CATEGORIES[2]),
            v.literal(TASK_CATEGORIES[3]),
            v.literal(TASK_CATEGORIES[4])
        ),
        priority: v.union(
            v.literal(TASK_PRIORITIES[0]),
            v.literal(TASK_PRIORITIES[1]),
            v.literal(TASK_PRIORITIES[2])
        ),
        parentTaskId: v.optional(v.id("tasks")),
        sortKey: v.optional(v.string()),
        durationHours: v.optional(v.number()),
        plannedStart: v.optional(v.union(v.string(), v.number())),
        plannedEnd: v.optional(v.union(v.string(), v.number())),
        // Optional relationships
        questId: v.optional(v.id("quests")),
        accountingSectionId: v.optional(v.id("sections")),
        accountingLineType: v.optional(v.union(v.literal("material"), v.literal("work"))),
        accountingLineId: v.optional(v.union(v.id("materialLines"), v.id("workLines"))),
        itemId: v.optional(v.id("projectItems")),
        itemSubtaskId: v.optional(v.string()),
        workstream: v.optional(v.string()),
        isManagement: v.optional(v.boolean()),
        // Dependencies
        taskNumber: v.optional(v.number()),
        dependencies: v.optional(v.array(v.id("tasks"))),

        // Gantt / Scheduling
        startDate: v.optional(v.number()),
        endDate: v.optional(v.number()),
        estimatedDuration: v.optional(v.number()), // in milliseconds

        // Task details (modal editor)
        estimatedMinutes: v.optional(v.union(v.number(), v.null())),
        steps: v.optional(v.array(v.string())),
        subtasks: v.optional(
            v.array(
                v.object({
                    title: v.string(),
                    done: v.boolean(),
                })
            )
        ),
        tags: v.optional(v.array(v.string())),
        assignee: v.optional(v.union(v.string(), v.null())),
        studioPhase: v.optional(
            v.union(
                v.literal(STUDIO_PHASES[0]),
                v.literal(STUDIO_PHASES[1]),
                v.literal(STUDIO_PHASES[2]),
                v.literal(STUDIO_PHASES[3]),
                v.literal(STUDIO_PHASES[4])
            )
        ),

        // AI metadata
        source: v.union(v.literal("user"), v.literal("agent")),
        confidenceScore: v.optional(v.number()),
        origin: v.optional(v.object({
            source: v.union(v.literal("template"), v.literal("user"), v.literal("ai")),
            templateId: v.optional(v.string()),
            version: v.optional(v.number()),
            templateTaskId: v.optional(v.string())
        })),
        generation: v.optional(v.union(v.literal("generated"), v.literal("manual"))),
        lock: v.optional(v.boolean()),
        derivedFrom: v.optional(v.object({
            elementVersionId: v.id("elementVersions"),
            projectVersionId: v.optional(v.id("projectVersions")),
            derivationRunId: v.id("derivationRuns"),
        })),
        // Timestamps
        createdAt: v.optional(v.number()),
        updatedAt: v.number(),
    })
        .index("by_project", ["projectId"])
        .index("by_project_item", ["projectId", "itemId"])
        .index("by_project_parentTask", ["projectId", "parentTaskId"])
        .index("by_project_phase", ["projectId", "studioPhase"]),

    // 3. TRELLO MAPPINGS: Task <-> Trello Card
    trelloMappings: defineTable({
        projectId: v.id("projects"),
        taskId: v.id("tasks"),
        trelloCardId: v.string(),  // external ID
        trelloListId: v.string(),  // external ID
        lastSyncedAt: v.number(),  // Date.now()
        contentHash: v.string(),   // hash of task fields at last sync
    })
        .index("by_project", ["projectId"])
        .index("by_trello_card", ["trelloCardId"]),

    // 4. PLANS: Versioned, Draft vs Active
    plans: defineTable({
        projectId: v.id("projects"),
        version: v.number(),
        phase: v.string(),   // "clarification", "plan", "deep_plan"
        isDraft: v.boolean(),
        isActive: v.boolean(),
        contentMarkdown: v.string(),
        reasoning: v.optional(v.string()),
        createdAt: v.number(),
        createdBy: v.string(), // "agent" | "user"
    }).index("by_project", ["projectId"])
        .index("by_project_active", ["projectId", "isDraft"])
        .index("by_project_phase", ["projectId", "phase"]),

    // 5. KNOWLEDGE DOCS (high-level document)
    knowledgeDocs: defineTable({
        projectId: v.optional(v.id("projects")),  // null/undefined = global
        title: v.string(),
        storageId: v.string(),         // Convex file storage ID
        sourceType: v.optional(v.union(
            v.literal("doc_upload"),
            v.literal("plan"),
            v.literal("conversation"),
            v.literal("task"),
            v.literal("quest"),
            v.literal("quote"),
            v.literal("item"),
            v.literal("system_note")
        )),
        sourceRefId: v.optional(v.string()),
        phase: v.optional(v.string()),
        clientName: v.optional(v.string()),
        topics: v.optional(v.array(v.string())),
        domain: v.optional(v.string()),
        language: v.optional(v.string()),
        processingStatus: v.union(
            v.literal("uploaded"),
            v.literal("processing"),
            v.literal("ready"),
            v.literal("failed")
        ),
        summary: v.string(),
        tags: v.array(v.string()),
        keyPoints: v.optional(v.array(v.string())),
        keywords: v.optional(v.array(v.string())),
        createdAt: v.number(),
    }).index("by_project", ["projectId"]),

    // 6. KNOWLEDGE CHUNKS with vectorIndex
    knowledgeChunks: defineTable({
        docId: v.id("knowledgeDocs"),
        projectId: v.optional(v.id("projects")),
        sourceType: v.optional(v.union(
            v.literal("doc_upload"),
            v.literal("plan"),
            v.literal("conversation"),
            v.literal("task"),
            v.literal("quest"),
            v.literal("quote"),
            v.literal("item"),
            v.literal("system_note")
        )),
        clientName: v.optional(v.string()),
        topics: v.optional(v.array(v.string())),
        domain: v.optional(v.string()),
        phase: v.optional(v.string()),
        createdAt: v.optional(v.number()), // older chunks may not have this; new writes set it
        text: v.string(),
        embedding: v.array(v.float64()),
    }).vectorIndex("by_embedding", {
        vectorField: "embedding",
        dimensions: 1536,       // matching your embedding model
        filterFields: ["projectId", "sourceType", "clientName", "domain", "phase"],  // scope per project
    }),

    // 7. QUOTES: internal + client-facing
    quotes: defineTable({
        projectId: v.id("projects"),
        version: v.number(),
        internalBreakdownJson: v.string(),   // serialized JSON
        clientDocumentText: v.string(),
        currency: v.string(),
        totalAmount: v.number(),
        pdfStorageId: v.optional(v.string()),
        createdAt: v.number(),
        createdBy: v.string(),
        generation: v.optional(v.union(v.literal("generated"), v.literal("manual"))),
        lock: v.optional(v.boolean()),
        derivedFrom: v.optional(v.object({
            elementVersionId: v.optional(v.id("elementVersions")),
            projectVersionId: v.optional(v.id("projectVersions")),
            derivationRunId: v.optional(v.id("derivationRuns")),
        })),
    }).index("by_project", ["projectId"]),

    // 7b. DEEP RESEARCH RUNS (Gemini Deep Research outputs)
    deepResearchRuns: defineTable({
        projectId: v.id("projects"),
        agentRunId: v.optional(v.id("agentRuns")),
        planId: v.optional(v.id("plans")),
        createdAt: v.number(),
        createdBy: v.string(),
        status: v.union(v.literal("in_progress"), v.literal("completed"), v.literal("failed")),
        interactionId: v.optional(v.string()),
        lastPolledAt: v.optional(v.number()),
        reportMarkdown: v.optional(v.string()),
        reportJson: v.optional(v.string()),
        error: v.optional(v.string()),
    })
        .index("by_project", ["projectId"])
        .index("by_agentRunId", ["agentRunId"])
        .index("by_project_createdAt", ["projectId", "createdAt"]),

    // 7c. AGENT RUNS (UI live feedback)
    agentRuns: defineTable({
        projectId: v.id("projects"),
        agent: v.string(),
        status: v.union(
            v.literal("queued"),
            v.literal("running"),
            v.literal("succeeded"),
            v.literal("failed")
        ),
        stage: v.optional(v.string()),
        error: v.optional(v.string()),
        createdAt: v.number(),
        updatedAt: v.number(),
        startedAt: v.optional(v.number()),
        finishedAt: v.optional(v.number()),
        events: v.array(v.object({
            ts: v.number(),
            level: v.union(v.literal("info"), v.literal("warn"), v.literal("error")),
            message: v.string(),
            stage: v.optional(v.string()),
        })),
    })
        .index("by_project_createdAt", ["projectId", "createdAt"])
        .index("by_project_agent_createdAt", ["projectId", "agent", "createdAt"])
        .index("by_project_status_createdAt", ["projectId", "status", "createdAt"]),

    // 8. CONVERSATIONS: for logging agent runs
    conversations: defineTable({
        projectId: v.id("projects"),
        phase: v.string(),   // "clarification", "planning", "quote", etc.
        agentRole: v.string(),
        messagesJson: v.string(),  // [{role, content, timestamp}]
        createdAt: v.number(),
    }).index("by_project_phase", ["projectId", "phase"]),

    // 8a. PROJECT CONVERSATIONS: Agent tab threaded conversations
    projectConversations: defineTable({
        projectId: v.id("projects"),
        title: v.string(),
        stageTag: v.union(v.literal("ideation"), v.literal("planning"), v.literal("solutioning")),
        defaultChannel: v.union(v.literal("free"), v.literal("structured")),
        contextMode: v.union(v.literal("none"), v.literal("selected"), v.literal("all")),
        contextElementIds: v.optional(v.array(v.id("projectItems"))),
        status: v.union(v.literal("active"), v.literal("archived")),
        threadId: v.optional(v.id("chatThreads")),
        lastMessageAt: v.optional(v.number()),
        createdAt: v.number(),
        updatedAt: v.number(),
        archivedAt: v.optional(v.number()),
    })
        .index("by_project_status_updatedAt", ["projectId", "status", "updatedAt"])
        .index("by_project_stage_updatedAt", ["projectId", "stageTag", "updatedAt"]),

    conversationMessages: defineTable({
        projectId: v.id("projects"),
        conversationId: v.id("projectConversations"),
        role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
        content: v.string(),
        stage: v.union(v.literal("ideation"), v.literal("planning"), v.literal("solutioning")),
        channel: v.union(v.literal("free"), v.literal("structured")),
        stageAtTime: v.optional(v.union(v.literal("ideation"), v.literal("planning"), v.literal("solutioning"))),
        channelAtTime: v.optional(v.union(v.literal("free"), v.literal("structured"))),
        promptIdUsed: v.optional(v.string()),
        createdAt: v.number(),
    })
        .index("by_conversation_createdAt", ["conversationId", "createdAt"])
        .index("by_project_createdAt", ["projectId", "createdAt"]),

    // 8b. FLOW WORKSPACES: editable "current understanding" per tab + scope
    flowWorkspaces: defineTable({
        projectId: v.id("projects"),
        tab: v.union(v.literal("ideation"), v.literal("planning"), v.literal("solutioning")),
        scopeType: v.union(
            v.literal("allProject"),
            v.literal("singleItem"),
            v.literal("multiItem")
        ),
        // Stable, indexable key for the scope. (Example: allProject | singleItem:<id> | multiItem:<id1>,<id2>)
        scopeKey: v.string(),
        scopeItemIds: v.optional(v.array(v.id("projectItems"))),
        text: v.string(),
        manualEditedAt: v.optional(v.number()),
        updatedBy: v.optional(v.union(v.literal("user"), v.literal("system"))),
        revision: v.number(),
        lastAgentRunId: v.optional(v.id("agentRuns")),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_project", ["projectId"])
        .index("by_project_tab", ["projectId", "tab"])
        .index("by_project_tab_scopeKey", ["projectId", "tab", "scopeKey"]),

    // 10. INGESTION JOBS
    ingestionJobs: defineTable({
        projectId: v.optional(v.id("projects")),
        name: v.string(),
        defaultContext: v.string(),
        defaultTags: v.array(v.string()),
        enrichmentProfileId: v.optional(v.id("enrichmentProfiles")),

        // New fields per plan
        sourceType: v.optional(v.union(
            v.literal("upload"),
            v.literal("drive"),
            v.literal("email"),
            v.literal("whatsapp")
        )),
        stage: v.optional(v.union(
            v.literal("received"),
            v.literal("parsed"),
            v.literal("enriched"),
            v.literal("chunked"),
            v.literal("embedded"),
            v.literal("ready"),
            v.literal("failed")
        )),
        progress: v.optional(v.object({
            totalFiles: v.number(),
            doneFiles: v.number(),
            failedFiles: v.number(),
        })),
        startedAt: v.optional(v.number()),
        finishedAt: v.optional(v.number()),
        errorSummary: v.optional(v.string()),

        status: v.union(
            v.literal("created"),
            v.literal("queued"),
            v.literal("processing"),
            v.literal("running"),
            v.literal("ready"),
            v.literal("committed"),
            v.literal("failed"),
            v.literal("cancelled")
        ),
        createdAt: v.number(),
    })
        .index("by_project", ["projectId"])
        .index("by_projectId_createdAt", ["projectId", "createdAt"])
        .index("by_status_createdAt", ["status", "createdAt"])
        .index("by_sourceType_createdAt", ["sourceType", "createdAt"]),

    // 11. INGESTION FILES
    ingestionFiles: defineTable({
        ingestionJobId: v.id("ingestionJobs"),
        projectId: v.optional(v.id("projects")),
        originalFilename: v.string(),
        storageId: v.string(),
        mimeType: v.string(),

        // New fields per plan
        sourceType: v.optional(v.union(
            v.literal("upload"),
            v.literal("drive"),
            v.literal("email"),
            v.literal("whatsapp")
        )),
        sizeBytes: v.optional(v.number()),
        stage: v.optional(v.union(
            v.literal("received"),
            v.literal("parsed"),
            v.literal("enriched"),
            v.literal("chunked"),
            v.literal("embedded"),
            v.literal("ready"),
            v.literal("failed")
        )),
        parsed: v.optional(v.object({
            textBytes: v.optional(v.number()),
            pageCount: v.optional(v.number()),
            sheetNames: v.optional(v.array(v.string())),
            slideCount: v.optional(v.number()),
            imageMeta: v.optional(v.object({
                width: v.number(),
                height: v.number(),
                format: v.string(),
            })),
        })),
        createdAt: v.optional(v.number()),
        updatedAt: v.optional(v.number()),

        status: v.union(
            v.literal("uploaded"),
            v.literal("parsed"),
            v.literal("enriched"),
            v.literal("ready"),
            v.literal("committed"),
            v.literal("failed")
        ),

        rawText: v.optional(v.string()),
        enrichedText: v.optional(v.string()),
        summary: v.optional(v.string()),
        keyPointsJson: v.optional(v.string()),
        keywordsJson: v.optional(v.string()),
        suggestedTagsJson: v.optional(v.string()),
        topicsJson: v.optional(v.string()),
        domain: v.optional(v.string()),
        clientName: v.optional(v.string()),
        language: v.optional(v.string()),
        userContext: v.optional(v.string()),
        error: v.optional(v.string()),
        ragDocId: v.optional(v.id("knowledgeDocs")),
    })
        .index("by_job", ["ingestionJobId"])
        .index("by_project", ["projectId"])
        .index("by_projectId_createdAt", ["projectId", "createdAt"]),

    // 24. INBOX ITEMS
    inboxItems: defineTable({
        projectId: v.optional(v.id("projects")),
        source: v.union(
            v.literal("email"),
            v.literal("whatsapp"),
            v.literal("upload"),
            v.literal("drive")
        ),
        sourceMessageId: v.optional(v.string()),
        fromName: v.optional(v.string()),
        fromAddressOrPhone: v.optional(v.string()),
        subject: v.optional(v.string()),
        bodyText: v.string(),
        receivedAt: v.number(),
        status: v.union(
            v.literal("new"),
            v.literal("triaged"),
            v.literal("archived")
        ),
        attachments: v.array(v.object({
            fileId: v.string(), // Convex storage ID
            name: v.string(),
            mimeType: v.string(),
            sizeBytes: v.number(),
        })),
        linked: v.object({
            ingestionJobId: v.optional(v.id("ingestionJobs")),
            knowledgeDocIds: v.optional(v.array(v.id("knowledgeDocs"))),
            taskIds: v.optional(v.array(v.id("tasks"))),
            decisionIds: v.optional(v.array(v.string())), // Placeholder for decisions if table doesn't exist yet
        }),
        suggestions: v.optional(v.object({
            tasksDraft: v.array(v.object({
                title: v.string(),
                details: v.optional(v.string()),
                priority: v.optional(v.string()),
                dueAt: v.optional(v.number()),
                tags: v.array(v.string()),
            })),
            decisionsDraft: v.array(v.object({
                title: v.string(),
                details: v.optional(v.string()),
                options: v.optional(v.array(v.string())),
            })),
            questionsDraft: v.array(v.object({
                question: v.string(),
                reason: v.optional(v.string()),
                priority: v.optional(v.string()),
            })),
            triage: v.object({
                status: v.union(
                    v.literal("not_started"),
                    v.literal("running"),
                    v.literal("done"),
                    v.literal("failed")
                ),
                error: v.optional(v.string()),
            }),
        })),
    })
        .index("by_project_receivedAt", ["projectId", "receivedAt"])
        .index("by_status_receivedAt", ["status", "receivedAt"])
        .index("by_sourceMessageId", ["sourceMessageId"]),

    // 25. CONNECTOR ACCOUNTS
    connectorAccounts: defineTable({
        type: v.union(
            v.literal("drive"),
            v.literal("emailInbound"),
            v.literal("whatsappImport")
        ),
        ownerUserId: v.string(),
        status: v.union(
            v.literal("connected"),
            v.literal("disconnected"),
            v.literal("error")
        ),
        auth: v.object({
            // Encrypted token reference or similar
            accessToken: v.optional(v.string()),
            refreshToken: v.optional(v.string()),
            expiryDate: v.optional(v.number()),
            email: v.optional(v.string()),
            googleUserId: v.optional(v.string()),
        }),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_owner_type", ["ownerUserId", "type"]),

    // 26. CONNECTOR WATCHES
    connectorWatches: defineTable({
        accountId: v.id("connectorAccounts"),
        type: v.literal("driveFolder"),
        projectId: v.id("projects"),
        externalId: v.string(), // e.g. Drive Folder ID
        name: v.string(),
        enabled: v.boolean(),
        cursorState: v.object({
            pageToken: v.optional(v.string()),
            lastSyncAt: v.optional(v.number()),
        }),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_project", ["projectId"])
        .index("by_account", ["accountId"]),

    // 12. ENRICHMENT PROFILES (configurable enhancer behavior)
    enrichmentProfiles: defineTable({
        name: v.string(),
        description: v.string(),
        llmModel: v.string(),         // "gpt-4o" etc.
        useWebSearch: v.boolean(),
        useCodeInterpreter: v.boolean(),
        systemPrompt: v.string(),     // enhancer system message
        schemaJson: v.string(),       // JSON schema for output
    }),

    // 13. RETRIEVAL LOGS (observability for RAG queries)
    retrievalLogs: defineTable({
        projectId: v.optional(v.id("projects")),
        agentRole: v.string(),
        query: v.string(),
        filtersJson: v.string(),
        scope: v.string(),            // project | global | both
        limit: v.number(),
        minScore: v.optional(v.number()),
        resultCount: v.number(),
        createdAt: v.number(),
    }).index("by_project", ["projectId"]),

    // 14. SKILLS (agent prompts)
    skills: defineTable({
        name: v.string(),         // "clarification", "planning", ...
        type: v.string(),         // "agent_system", "enrichment"
        content: v.string(),      // prompt template
        metadataJson: v.string(), // e.g. {"phase":"planning"}
    }).index("by_name", ["name"]),

    // 15. SETTINGS (API keys, per-user, per-workspace)
    settings: defineTable({
        // for simplicity: single global row or keyed by "key"
        key: v.string(),          // "trello_api", etc.
        valueJson: v.string(),
    }).index("by_key", ["key"]),

    // 27. PRICE OBSERVATIONS (Price Memory)


    // 27b. QUESTS
    quests: defineTable({
        projectId: v.id("projects"),
        title: v.string(),
        description: v.optional(v.string()),
        order: v.optional(v.number()),
        status: v.optional(v.string()), // "active", "completed", "archived"
        createdAt: v.number(),
        updatedAt: v.optional(v.number()),
    }).index("by_project", ["projectId"]),

    // 28. CANONICAL ITEMS (Normalized Master List)
    canonicalItems: defineTable({
        name: v.string(), // "PVC rigid print 3mm"
        tags: v.array(v.string()), // ["print", "wood", "hardware"]
        defaultUnit: v.string(),
        synonyms: v.array(v.string()),
    }).searchIndex("search_name", { searchField: "name" }),

    // 29. ITEM NORMALIZATION MAP (Raw -> Canonical)
    itemNormalizationMap: defineTable({
        raw: v.string(),
        canonicalItemId: v.id("canonicalItems"),
        confidence: v.number(),
        updatedAt: v.number(),
    }).index("by_raw", ["raw"]),

    // 30. BUYING SUGGESTIONS (Cache)
    buyingSuggestions: defineTable({
        materialLineId: v.optional(v.id("materialLines")),
        projectId: v.optional(v.id("projects")), // For freeform queries
        freeformQuery: v.optional(v.string()),
        canonicalItemId: v.optional(v.id("canonicalItems")),
        source: v.union(v.literal("history"), v.literal("research")),
        status: v.union(v.literal("ready"), v.literal("stale")),
        summary: v.string(),
        options: v.array(v.object({
            vendorName: v.string(),
            vendorUrl: v.optional(v.string()),
            priceMin: v.optional(v.number()),
            priceMax: v.optional(v.number()),
            unit: v.string(),
            leadTimeDays: v.optional(v.number()),
            notes: v.optional(v.string()),
            confidence: v.string(), // "low"|"medium"|"high"
        })),
        citations: v.array(v.object({
            title: v.string(),
            url: v.string(),
            snippet: v.string(),
        })),
        createdAt: v.number(),
        expiresAt: v.number(),
    })
        .index("by_materialLine_createdAt", ["materialLineId", "createdAt"]),

    // 31. RESEARCH RUNS (Gemini Deep Research)
    researchRuns: defineTable({
        request: v.object({
            queryText: v.string(),
            canonicalItemId: v.optional(v.id("canonicalItems")),
            qty: v.optional(v.number()),
            unit: v.optional(v.string()),
            specs: v.optional(v.string()),
            location: v.optional(v.string()),
            urgencyDate: v.optional(v.string()),
            currency: v.string(),
            language: v.optional(v.string()),
        }),
        provider: v.literal("gemini_deep_research"),
        status: v.union(
            v.literal("queued"),
            v.literal("running"),
            v.literal("completed"),
            v.literal("failed"),
            v.literal("cancelled")
        ),
        interactionId: v.optional(v.string()), // from Interactions API
        result: v.optional(v.object({
            reportMarkdown: v.string(),
            options: v.array(v.any()), // Using any for flexibility here, or match buyingSuggestions options
            citations: v.array(v.any()),
        })),
        error: v.optional(v.string()),
        startedAt: v.number(),
        finishedAt: v.optional(v.number()),
        cost: v.optional(v.object({
            inputTokens: v.optional(v.number()),
            outputTokens: v.optional(v.number()),
            estimatedUSD: v.optional(v.number()),
        })),
        createdBy: v.string(),
        linked: v.object({
            materialLineId: v.optional(v.id("materialLines")),
            projectId: v.optional(v.id("projects")),
        }),
    })
        .index("by_status_startedAt", ["status", "startedAt"])
        .index("by_linked_materialLine_createdAt", ["linked.materialLineId", "startedAt"])
        .index("by_createdBy_startedAt", ["createdBy", "startedAt"]),

    // Structured Questions
    structuredQuestionSessions: defineTable({
        projectId: v.id("projects"),
        conversationId: v.optional(v.id("projectConversations")),
        stage: v.union(v.literal("clarification"), v.literal("planning"), v.literal("solutioning")),
        status: v.union(v.literal("active"), v.literal("done"), v.literal("archived")),
        currentTurnNumber: v.number(),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_project_stage", ["projectId", "stage", "status"])
        .index("by_project_conversation_stage_status", ["projectId", "conversationId", "stage", "status"]),

    structuredQuestionTurns: defineTable({
        projectId: v.id("projects"),
        conversationId: v.optional(v.id("projectConversations")),
        stage: v.union(v.literal("clarification"), v.literal("planning"), v.literal("solutioning")),
        sessionId: v.id("structuredQuestionSessions"),
        turnNumber: v.number(),
        questions: v.any(), // JSON: StructuredQuestion[]
        answers: v.any(), // JSON: StructuredAnswer[]
        userInstructions: v.optional(v.string()),
        agentRunId: v.optional(v.id("agentRuns")),
        createdAt: v.number(),
        answeredAt: v.optional(v.number()),
    })
        .index("by_session_turn", ["sessionId", "turnNumber"])
        .index("by_project_stage_recent", ["projectId", "stage", "createdAt"])
        .index("by_conversation_stage_recent", ["conversationId", "stage", "createdAt"]),

    // --- FACTS PIPELINE ---

    turnBundles: defineTable({
        projectId: v.id("projects"),
        source: v.object({
            type: v.union(v.literal("structuredQuestions"), v.literal("chat"), v.literal("generation"), v.literal("mixed")),
            sourceIds: v.array(v.string()),
        }),
        stage: v.union(v.literal("ideation"), v.literal("planning"), v.literal("solutioning")),
        scope: v.object({
            type: v.union(v.literal("project"), v.literal("item"), v.literal("multiItem")),
            itemIds: v.optional(v.array(v.id("projectItems"))),
        }),
        bundleText: v.string(), // immutable
        bundleHash: v.string(), // sha256
        createdAt: v.number(),
    })
        .index("by_project_createdAt", ["projectId", "createdAt"])
        .index("by_hash", ["bundleHash"]),

    factParseRuns: defineTable({
        projectId: v.id("projects"),
        turnBundleId: v.id("turnBundles"),
        status: factParseRunStatusSchema,
        model: v.string(), // "gpt-5-mini"
        startedAt: v.number(),
        finishedAt: v.optional(v.number()),
        stats: v.optional(factParseRunStatsSchema),
        error: v.optional(v.object({ message: v.string(), raw: v.optional(v.string()) })),
    })
        .index("by_bundle", ["turnBundleId"])
        .index("by_project_createdAt", ["projectId", "startedAt"]),

    facts: defineTable({
        projectId: v.id("projects"),
        scopeType: factScopeTypeSchema,
        itemId: v.union(v.id("projectItems"), v.null()),
        key: v.string(), // whitelisted canonical path
        valueType: v.string(), // "boolean" | "enum" | "number" | "dimension" | "currency" | "date" | "string" | "note"
        value: factValueSchema,
        status: factStatusSchema,
        needsReview: v.boolean(),
        confidence: v.number(), // 0..1
        sourceKind: factSourceKindSchema,
        evidence: v.optional(evidenceSchema),
        parseRunId: v.optional(v.id("factParseRuns")),
        createdAt: v.number(),
        supersedesFactId: v.optional(v.id("facts")),
        scope: v.optional(v.union(v.literal("project"), v.literal("element"))),
        elementId: v.optional(v.id("projectItems")),
        categoryHe: v.optional(v.string()),
        subCategoryHe: v.optional(v.string()),
        type: v.optional(v.union(
            v.literal("field_update"),
            v.literal("free_text"),
            v.literal("decision"),
            v.literal("risk"),
            v.literal("preference"),
            v.literal("constraint"),
            v.literal("note")
        )),
        fieldPath: v.optional(v.string()),
        bucketKey: v.optional(v.string()),
        valueTyped: v.optional(v.any()),
        valueTextHe: v.optional(v.string()),
        source: v.optional(v.union(
            v.literal("user_chat"),
            v.literal("user_form"),
            v.literal("file_upload"),
            v.literal("agent_inference"),
            v.literal("manual_edit"),
            v.literal("migration")
        )),
        sourceRef: v.optional(v.string()),
        updatedAt: v.optional(v.number()),
    })
        .index("by_scope_key", ["projectId", "scopeType", "itemId", "key"])
        .index("by_project_status", ["projectId", "status"])
        .index("by_item", ["projectId", "itemId"])
        .index("by_project_element_status", ["projectId", "elementId", "status"])
        .index("by_project_category_status", ["projectId", "categoryHe", "status"])
        .index("by_project_field_status", ["projectId", "fieldPath", "status"])
        .index("by_project_sourceRef", ["projectId", "sourceRef"]),

    factExtractionRuns: defineTable({
        projectId: v.id("projects"),
        turnBundleId: v.id("turnBundles"),
        status: v.union(
            v.literal("queued"),
            v.literal("running"),
            v.literal("succeeded"),
            v.literal("failed")
        ),
        model: v.string(),
        startedAt: v.number(),
        finishedAt: v.optional(v.number()),
        chunking: v.optional(v.object({
            chunks: v.number(),
            strategy: v.string(),
            chunkSize: v.number(),
            overlap: v.number(),
        })),
        stats: v.optional(v.object({
            factsProduced: v.number(),
            userFacts: v.number(),
            hypotheses: v.number(),
            exactDuplicates: v.number(),
            semanticCandidates: v.number(),
            contradictions: v.number(),
        })),
        error: v.optional(v.object({ message: v.string(), raw: v.optional(v.string()) })),
        createdAt: v.number(),
    })
        .index("by_bundle", ["turnBundleId"])
        .index("by_project_createdAt", ["projectId", "createdAt"]),

    factAtoms: defineTable({
        projectId: v.id("projects"),
        scopeType: factScopeTypeSchema,
        itemId: v.union(v.id("projectItems"), v.null()),
        factTextHe: v.string(),
        category: v.string(),
        importance: v.number(),
        sourceTier: v.union(v.literal("user_evidence"), v.literal("hypothesis")),
        status: v.union(
            v.literal("proposed"),
            v.literal("accepted"),
            v.literal("rejected"),
            v.literal("hypothesis"),
            v.literal("superseded"),
            v.literal("duplicate")
        ),
        confidence: v.number(),
        key: v.optional(v.string()),
        valueType: v.optional(v.string()),
        value: v.optional(v.any()),
        evidence: v.optional(v.array(v.object({
            turnBundleId: v.id("turnBundles"),
            quoteHe: v.string(),
            startChar: v.number(),
            endChar: v.number(),
            sourceSection: v.string(),
            sourceKind: v.union(v.literal("user"), v.literal("doc"), v.literal("agentOutput")),
        }))),
        createdFrom: v.object({
            turnBundleId: v.id("turnBundles"),
            runId: v.id("factExtractionRuns"),
            chunkId: v.optional(v.string()),
            sourceKind: v.union(v.literal("user"), v.literal("doc"), v.literal("agent")),
        }),
        dedupe: v.object({
            exactHash: v.string(),
            duplicateOfFactId: v.optional(v.id("factAtoms")),
        }),
        groupId: v.optional(v.id("factGroups")),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_project_scope_status", ["projectId", "scopeType", "itemId", "status"])
        .index("by_exactHash", ["projectId", "dedupe.exactHash"])
        .index("by_group", ["projectId", "groupId"])
        .index("by_project_item", ["projectId", "itemId"]),

    factGroups: defineTable({
        projectId: v.id("projects"),
        scopeType: factScopeTypeSchema,
        itemId: v.union(v.id("projectItems"), v.null()),
        key: v.optional(v.string()),
        canonicalFactId: v.id("factAtoms"),
        memberFactIds: v.optional(v.array(v.id("factAtoms"))),
        labelHe: v.optional(v.string()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_project_scope", ["projectId", "scopeType", "itemId"])
        .index("by_canonical", ["canonicalFactId"]),

    factIssues: defineTable({
        projectId: v.id("projects"),
        type: v.union(
            v.literal("contradiction"),
            v.literal("semantic_duplicate_suggestion"),
            v.literal("missing_item_link")
        ),
        severity: v.union(v.literal("info"), v.literal("warning"), v.literal("high")),
        status: v.union(v.literal("open"), v.literal("resolved"), v.literal("dismissed")),
        factId: v.id("factAtoms"),
        relatedFactIds: v.optional(v.array(v.id("factAtoms"))),
        proposedAction: v.optional(v.string()),
        explanationHe: v.optional(v.string()),
        createdAt: v.number(),
        resolvedByUserId: v.optional(v.string()),
        resolvedAt: v.optional(v.number()),
    })
        .index("by_project_status", ["projectId", "status"])
        .index("by_fact", ["factId"])
        .index("by_type_status", ["type", "status"]),

    factEmbeddings: defineTable({
        projectId: v.id("projects"),
        factId: v.id("factAtoms"),
        vector: v.array(v.float64()),
        model: v.string(),
        createdAt: v.number(),
    })
        .index("by_project_fact", ["projectId", "factId"])
        .vectorIndex("by_embedding", {
            vectorField: "vector",
            dimensions: 1536,
            filterFields: ["projectId"],
        }),

    knowledgeBlocks: defineTable({
        projectId: v.id("projects"),
        scopeType: factScopeTypeSchema,
        itemId: v.union(v.id("projectItems"), v.null()),
        blockKey: v.string(),
        json: v.any(), // structured object
        renderedMarkdown: v.string(),
        revision: v.number(),
        updatedAt: v.number(),
        updatedBy: v.object({ type: v.union(v.literal("system"), v.literal("user"), v.literal("agent")), refId: v.optional(v.string()) }),
    })
        .index("by_scope_block", ["projectId", "scopeType", "itemId", "blockKey"]),

    projectBrains: defineTable({
        projectId: v.id("projects"),
        version: v.number(),
        updatedAt: v.number(),
        project: v.any(),
        elementNotes: v.any(),
        unmapped: v.any(),
        conflicts: v.any(),
        recentUpdates: v.any(),
    }).index("by_project", ["projectId"]),

    brainEvents: defineTable({
        projectId: v.id("projects"),
        eventType: v.union(
            v.literal("structured_submit"),
            v.literal("agent_send"),
            v.literal("file_ingested"),
            v.literal("manual_add"),
            v.literal("manual_structured_edit")
        ),
        payload: v.any(),
        brainVersionAtStart: v.number(),
        status: v.union(
            v.literal("queued"),
            v.literal("applied"),
            v.literal("needs_review"),
            v.literal("rejected"),
            v.literal("conflict_retry")
        ),
        patchOps: v.optional(v.any()),
        createdAt: v.number(),
        appliedAt: v.optional(v.number()),
        error: v.optional(v.string()),
    })
        .index("by_project_createdAt", ["projectId", "createdAt"])
        .index("by_project_status", ["projectId", "status"]),

    brainRuns: defineTable({
        projectId: v.id("projects"),
        eventId: v.id("brainEvents"),
        model: v.string(),
        outputJson: v.optional(v.string()),
        runSummary: v.optional(v.string()),
        status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
        createdAt: v.number(),
        error: v.optional(v.string()),
    }).index("by_project_event", ["projectId", "eventId"]),

    elementSuggestions: defineTable({
        projectId: v.id("projects"),
        title: v.string(),
        descriptionMarkdown: v.string(),
        status: v.union(
            v.literal("SUGGESTED"),
            v.literal("APPROVED"),
            v.literal("DISMISSED")
        ),
        createdAt: v.number(),
    }).index("by_project_status", ["projectId", "status"])
        .index("by_project_createdAt", ["projectId", "createdAt"]),
});
