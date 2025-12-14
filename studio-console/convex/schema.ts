import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
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
        details: v.object({
            eventDate: v.optional(v.string()), // ISO
            budgetCap: v.optional(v.number()),
            location: v.optional(v.string()),
            notes: v.optional(v.string()),
        }),
        overviewSummary: v.optional(v.string()),
        createdAt: v.number(),  // Date.now()
        createdBy: v.string(),  // userId/email (local for now)
        
        // Accounting / Costing Fields
        currency: v.optional(v.string()), // e.g. "ILS", "USD"
        overheadPercent: v.optional(v.number()), // 0.15
        riskPercent: v.optional(v.number()),     // 0.10
        profitPercent: v.optional(v.number()),   // 0.30
    }).index("by_status", ["status"]),

    // 16. SECTIONS (Budget Lines)
    sections: defineTable({
        projectId: v.id("projects"),
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
        category: v.string(), // e.g., "PVC", "Paint"
        label: v.string(),
        description: v.optional(v.string()),
        
        // Vendor Link
        vendorId: v.optional(v.id("vendors")),
        vendorName: v.optional(v.string()), // Snapshot or ad-hoc name

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
    })
    .index("by_section", ["sectionId"])
    .index("by_project", ["projectId"]),

    // 18. WORK LINES (The "S" in cost)
    workLines: defineTable({
        sectionId: v.id("sections"),
        projectId: v.id("projects"),
        workType: v.string(), // studio, field, management
        role: v.string(),
        personId: v.optional(v.string()), // Link to user/employee if needed
        
        rateType: v.string(), // hour, day, flat
        
        // Planning
        plannedQuantity: v.number(),
        plannedUnitCost: v.number(),
        
        // Actuals
        actualQuantity: v.optional(v.number()),
        actualUnitCost: v.optional(v.number()),
        
        status: v.string(), // planned, scheduled, done, paid
        description: v.optional(v.string()),
    })
    .index("by_section", ["sectionId"])
    .index("by_project", ["projectId"]),
    
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
            v.literal("todo"),
            v.literal("in_progress"),
            v.literal("done"),
            v.literal("blocked")
        ),
        category: v.union(
            v.literal("Logistics"),
            v.literal("Creative"),
            v.literal("Finance"),
            v.literal("Admin"),
            v.literal("Studio")
        ),
        priority: v.union(
            v.literal("High"),
            v.literal("Medium"),
            v.literal("Low")
        ),
        // Optional relationships
        questId: v.optional(v.id("quests")),
        // AI metadata
        source: v.union(v.literal("user"), v.literal("agent")),
        confidenceScore: v.optional(v.number()),
        // Timestamps
        createdAt: v.number(),
        updatedAt: v.number(),
    }).index("by_project", ["projectId"]),

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
        createdAt: v.number(),
        createdBy: v.string(),
    }).index("by_project", ["projectId"]),

    // 8. CONVERSATIONS: for logging agent runs
    conversations: defineTable({
        projectId: v.id("projects"),
        phase: v.string(),   // "clarification", "planning", "quote", etc.
        agentRole: v.string(),
        messagesJson: v.string(),  // [{role, content, timestamp}]
        createdAt: v.number(),
    }).index("by_project_phase", ["projectId", "phase"]),

    // 9. QUESTS: task group / milestone
    quests: defineTable({
        projectId: v.id("projects"),
        title: v.string(),
        description: v.optional(v.string()),
        order: v.number(),      // sort order in UI
        createdAt: v.number(),
    }).index("by_project", ["projectId"]),

    // 10. INGESTION JOBS
    ingestionJobs: defineTable({
        projectId: v.optional(v.id("projects")),
        name: v.string(),
        defaultContext: v.string(),
        defaultTags: v.array(v.string()),
        enrichmentProfileId: v.optional(v.id("enrichmentProfiles")),
        
        // New fields per plan
        sourceType: v.union(
            v.literal("upload"),
            v.literal("drive"),
            v.literal("email"),
            v.literal("whatsapp")
        ),
        stage: v.union(
            v.literal("received"),
            v.literal("parsed"),
            v.literal("enriched"),
            v.literal("chunked"),
            v.literal("embedded"),
            v.literal("ready"),
            v.literal("failed")
        ),
        progress: v.object({
            totalFiles: v.number(),
            doneFiles: v.number(),
            failedFiles: v.number(),
        }),
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
        sourceType: v.union(
            v.literal("upload"),
            v.literal("drive"),
            v.literal("email"),
            v.literal("whatsapp")
        ),
        sizeBytes: v.number(),
        stage: v.union(
            v.literal("received"),
            v.literal("parsed"),
            v.literal("enriched"),
            v.literal("chunked"),
            v.literal("embedded"),
            v.literal("ready"),
            v.literal("failed")
        ),
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
        createdAt: v.number(),
        updatedAt: v.number(),

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
        }),
        createdAt: v.number(),
        updatedAt: v.number(),
    }),

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
    priceObservations: defineTable({
        canonicalItemId: v.id("canonicalItems"),
        rawItemName: v.string(),
        vendorId: v.optional(v.id("vendors")),
        unit: v.string(), // "sqm", "piece", "sheet"
        unitPrice: v.number(),
        currency: v.string(), // default "ILS"
        minQty: v.optional(v.number()),
        qtyBreaks: v.optional(v.string()), // JSON string for breaks if needed
        leadTimeDays: v.optional(v.number()),
        locationTag: v.optional(v.string()), // "TLV", "center", "Eilat"
        source: v.union(
            v.literal("purchase"),
            v.literal("invoice"),
            v.literal("quote"),
            v.literal("manual"),
            v.literal("research")
        ),
        sourceRef: v.object({
            type: v.string(), // "purchaseId", "docId", "researchRunId"
            id: v.string(),
        }),
        projectId: v.optional(v.id("projects")),
        observedAt: v.number(),
        notes: v.optional(v.string()),
    })
    .index("by_canonicalItem_observedAt", ["canonicalItemId", "observedAt"])
    .index("by_vendor_observedAt", ["vendorId", "observedAt"]),

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
});
