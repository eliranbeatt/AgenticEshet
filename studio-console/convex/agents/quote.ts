import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { ItemSpecV2Schema, QuoteDraftSchema, type ItemSpecV2 } from "../lib/zodSchemas";
import { type Doc } from "../_generated/dataModel";

type QuoteBreakdownItem = {
    label: string;
    amount: number;
    currency: string;
    notes: string | null;
};

type QuoteDataPayload = {
    internalBreakdown: QuoteBreakdownItem[];
    totalAmount: number;
    currency: string;
    clientDocumentText: string;
};

// 1. DATA ACCESS
export const getContext: ReturnType<typeof internalQuery> = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");

        const items = await ctx.db
            .query("projectItems")
            .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", "approved"))
            .collect();
        const itemSpecs: Array<{ item: Doc<"projectItems">; spec: ItemSpecV2 | null }> = [];
        for (const item of items) {
            if (!item.approvedRevisionId) {
                itemSpecs.push({ item, spec: null });
                continue;
            }
            const revision = await ctx.db.get(item.approvedRevisionId);
            if (!revision) {
                itemSpecs.push({ item, spec: null });
                continue;
            }
            const parsed = ItemSpecV2Schema.safeParse(revision.data);
            itemSpecs.push({ item, spec: parsed.success ? parsed.data : null });
        }

        const skill = await ctx.db
            .query("skills")
            .withIndex("by_name", (q) => q.eq("name", "quote"))
            .first();

        const knowledgeDocs = await ctx.runQuery(internal.knowledge.getContextDocs, {
            projectId: args.projectId,
            limit: 3,
            tagFilter: ["pricing", "budget", "rates"],
        });

        return {
            project,
            items,
            itemSpecs,
            knowledgeDocs,
            systemPrompt: skill?.content || "You are a Cost Estimator.",
        };
    },
});

export const saveQuote = internalMutation({
    args: {
        projectId: v.id("projects"),
        quoteData: v.any(), // QuoteDraftSchema
    },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        const quoteData = args.quoteData as {
            currency: string;
            document: {
                title: string;
                intro: string;
                scopeBullets: string[];
                lineItems: Array<{
                    displayName: string;
                    description?: string;
                    quantity: number;
                    unit: string;
                    price: number;
                }>;
                totals: { subtotal: number; vat: number; total: number };
                paymentTerms: string[];
                scheduleAssumptions: string[];
                included: string[];
                excluded: string[];
                termsAndConditions: string[];
                validityDays: number;
            };
        };
        const internalBreakdown: QuoteBreakdownItem[] = quoteData.document.lineItems.map((item) => ({
            label: item.displayName,
            amount: item.price,
            currency: quoteData.currency,
            notes: item.description ?? null,
        }));
        const clientDocumentText = buildClientDocumentText(quoteData.document);
        const normalized: QuoteDataPayload = {
            internalBreakdown,
            totalAmount: quoteData.document.totals.total,
            currency: quoteData.currency,
            clientDocumentText,
        };
        // Determine version
        const existing = await ctx.db
            .query("quotes")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const version = existing.length + 1;

        await ctx.db.insert("quotes", {
            projectId: args.projectId,
            version,
            internalBreakdownJson: JSON.stringify(normalized.internalBreakdown),
            clientDocumentText: normalized.clientDocumentText,
            currency: normalized.currency,
            totalAmount: normalized.totalAmount,
            createdAt: Date.now(),
            createdBy: "agent",
        });

        const quoteText = [
            `Currency: ${normalized.currency}`,
            `Total: ${normalized.totalAmount}`,
            "Breakdown:",
            ...normalized.internalBreakdown.map((item) => `- ${item.label}: ${item.amount} ${item.currency}`),
            "",
            "Client Document:",
            normalized.clientDocumentText,
        ].join("\n");

        const ingestArtifact = (internal as unknown as { knowledge: { ingestArtifact: unknown } }).knowledge.ingestArtifact;

        await ctx.scheduler.runAfter(0, ingestArtifact, {
            projectId: args.projectId,
            sourceType: "quote",
            sourceRefId: `quote-v${version}`,
            title: `Quote v${version}`,
            text: quoteText,
            summary: quoteData.clientDocumentText.slice(0, 500),
            tags: ["quote", "pricing"],
            topics: [],
            clientName: project?.clientName,
            domain: "pricing",
        });
    },
});

export const listQuotes = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("quotes")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .order("desc") // newest first
            .collect();
    }
});

export const runInBackground: ReturnType<typeof internalAction> = internalAction({
    args: {
        projectId: v.id("projects"),
        instructions: v.optional(v.string()),
        agentRunId: v.optional(v.id("agentRuns")),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const agentRunId = args.agentRunId;

        // Fetch model configuration
        const settings = await ctx.runQuery(internal.settings.getAll);
        const model = settings.modelConfig?.quote || "gpt-5.2";

        if (agentRunId) {
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId: agentRunId,
                status: "running",
                stage: "loading_context",
            });
            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId: agentRunId,
                level: "info",
                message: "Loading project context and tasks for quoting.",
                stage: "loading_context",
            });
        }

        try {
            const { project, items, itemSpecs, systemPrompt } = await ctx.runQuery(internal.agents.quote.getContext, {
                projectId: args.projectId,
            });

            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: agentRunId,
                    level: "info",
                    message: "Searching knowledge base for pricing references.",
                    stage: "knowledge_search",
                });
            }

            const knowledgeDocs = await ctx.runAction(api.knowledge.dynamicSearch, {
                projectId: args.projectId,
                query: [args.instructions || "", project.clientName, project.details.notes || ""].join("\n"),
                scope: "both",
                sourceTypes: ["quote", "task", "doc_upload", "plan"],
                limit: 8,
                agentRole: "quote_agent",
                includeSummaries: true,
            });

            const itemSummary = itemSpecs
                .filter((entry) => entry.spec?.quote?.includeInQuote !== false)
                .map((entry) => {
                    if (!entry.spec) {
                        return `- ${entry.item.title} (${entry.item.typeKey})`;
                    }
                    const description = entry.spec.identity.description ?? "";
                    return `- ${entry.spec.identity.title} (${entry.spec.identity.typeKey})${description ? `: ${description}` : ""}`;
                });
            const scopeSummary = itemSummary.length > 0 ? itemSummary.join("\n") : "- No approved items found.";

            const knowledgeSummary = knowledgeDocs.length
                ? knowledgeDocs
                    .map((entry: { doc: { sourceType: string; title: string; summary?: string; keyPoints?: string[] }; text?: string }) => {
                        const keyPoints = Array.isArray(entry.doc.keyPoints) && entry.doc.keyPoints.length > 0
                            ? ` Key points: ${entry.doc.keyPoints.slice(0, 6).join("; ")}`
                            : "";
                        const base = (entry.doc.summary ?? entry.text?.slice(0, 200) ?? "").trim();
                        return `- [${entry.doc.sourceType}] ${entry.doc.title}: ${base}${keyPoints}`;
                    })
                    .join("\n")
                : "No pricing references available.";

            const userPrompt = JSON.stringify({
                mode: "EXTRACT",
                phase: "quote",
                actor: { userName: "user", studioName: "studio" },
                project: {
                    id: project._id,
                    name: project.name,
                    clientName: project.clientName,
                    defaultLanguage: project.defaultLanguage ?? "he",
                    budgetTier: project.budgetTier ?? "unknown",
                    projectTypes: project.projectTypes ?? [],
                    details: project.details,
                    overview: project.overview,
                    features: project.features ?? {},
                },
                selection: {
                    selectedItemIds: [],
                    selectedConceptIds: [],
                    selectedTaskIds: [],
                },
                items,
                tasks: [],
                accounting: {
                    materialLines: [],
                    workLines: [],
                    accountingLines: [],
                },
                quotes: [],
                concepts: [],
                knowledge: {
                    attachedDocs: knowledgeDocs,
                    pastProjects: [],
                    retrievedSnippets: [],
                },
                settings: {
                    currencyDefault: project.currency ?? "ILS",
                    tax: { vatRate: project.vatRate ?? 0, pricesIncludeVat: project.pricesIncludeVat ?? false },
                    pricingModel: {
                        overheadOnExpensesPct: 0.15,
                        overheadOnOwnerTimePct: 0.3,
                        profitPct: 0.1,
                    },
                },
                ui: {
                    capabilities: {
                        supportsChangeSets: true,
                        supportsLocks: true,
                        supportsDeepResearchTool: true,
                    },
                },
                scopeSummary,
                knowledgeSummary,
                instructions: args.instructions || "Generate initial quote based on known scope.",
            });

            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: agentRunId,
                    level: "info",
                    message: "Calling model to generate quote breakdown.",
                    stage: "llm_call",
                });
            }

            const result = await callChatWithSchema(QuoteDraftSchema, {
                model,
                systemPrompt,
                userPrompt,
                thinkingMode: args.thinkingMode,
            });

            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: agentRunId,
                    level: "info",
                    message: "Saving generated quote.",
                    stage: "persisting",
                });
            }

            await ctx.runMutation(internal.agents.quote.saveQuote, {
                projectId: args.projectId,
                quoteData: result,
            });

            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.setStatus, {
                    runId: agentRunId,
                    status: "succeeded",
                    stage: "done",
                });
            }

            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: agentRunId,
                    level: "error",
                    message,
                    stage: "failed",
                });
                await ctx.runMutation(internal.agentRuns.setStatus, {
                    runId: agentRunId,
                    status: "failed",
                    stage: "failed",
                    error: message,
                });
            }
            throw error;
        }
    },
});

// 2. AGENT ACTION
export const run: ReturnType<typeof action> = action({
    args: {
        projectId: v.id("projects"),
        instructions: v.optional(v.string()), // e.g. "Add travel expenses"
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        await ctx.runQuery(internal.agents.quote.getContext, { projectId: args.projectId });

        const agentRunId = await ctx.runMutation(internal.agentRuns.createRun, {
            projectId: args.projectId,
            agent: "quote",
            stage: "queued",
            initialMessage: "Queued quote generation.",
        });

        await ctx.scheduler.runAfter(0, internal.agents.quote.runInBackground, {
            projectId: args.projectId,
            instructions: args.instructions,
            agentRunId,
            thinkingMode: args.thinkingMode,
        });

        return { queued: true, runId: agentRunId };
    },
});

function buildClientDocumentText(document: {
    title: string;
    intro: string;
    scopeBullets: string[];
    lineItems: Array<{ displayName: string; description?: string; quantity: number; unit: string; price: number }>;
    totals: { subtotal: number; vat: number; total: number };
    paymentTerms: string[];
    scheduleAssumptions: string[];
    included: string[];
    excluded: string[];
    termsAndConditions: string[];
    validityDays: number;
}) {
    const lines = [
        document.title,
        "",
        document.intro,
        "",
        "Scope:",
        ...(document.scopeBullets.length ? document.scopeBullets.map((line) => `- ${line}`) : ["- (none)"]),
        "",
        "Line items:",
        ...document.lineItems.map(
            (item) =>
                `- ${item.displayName}: ${item.quantity} ${item.unit} @ ${item.price}` +
                (item.description ? ` (${item.description})` : ""),
        ),
        "",
        `Totals: subtotal ${document.totals.subtotal}, vat ${document.totals.vat}, total ${document.totals.total}`,
        "",
        "Payment terms:",
        ...(document.paymentTerms.length ? document.paymentTerms.map((line) => `- ${line}`) : ["- (none)"]),
        "",
        "Schedule assumptions:",
        ...(document.scheduleAssumptions.length ? document.scheduleAssumptions.map((line) => `- ${line}`) : ["- (none)"]),
        "",
        "Included:",
        ...(document.included.length ? document.included.map((line) => `- ${line}`) : ["- (none)"]),
        "",
        "Excluded:",
        ...(document.excluded.length ? document.excluded.map((line) => `- ${line}`) : ["- (none)"]),
        "",
        "Terms and conditions:",
        ...(document.termsAndConditions.length ? document.termsAndConditions.map((line) => `- ${line}`) : ["- (none)"]),
        "",
        `Validity: ${document.validityDays} days`,
    ];
    return lines.join("\n");
}
