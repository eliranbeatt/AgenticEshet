import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { ItemSpecV2Schema, QuoteAgentResultSchema, type ItemSpecV2, type QuoteAgentResult } from "../lib/zodSchemas";
import { type Doc } from "../_generated/dataModel";
import { calculateSectionSnapshot, getProjectPricingDefaults } from "../lib/costing";

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

        // Accounting Snapshot
        const sections = await ctx.db
            .query("sections")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const allMaterials = await ctx.db
            .query("materialLines")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const allWork = await ctx.db
            .query("workLines")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const materialsBySection = new Map<string, Doc<"materialLines">[]>();
        const workBySection = new Map<string, Doc<"workLines">[]>();

        for (const m of allMaterials) {
            if (!materialsBySection.has(m.sectionId)) materialsBySection.set(m.sectionId, []);
            materialsBySection.get(m.sectionId)!.push(m);
        }
        for (const w of allWork) {
            if (!workBySection.has(w.sectionId)) workBySection.set(w.sectionId, []);
            workBySection.get(w.sectionId)!.push(w);
        }

        const projectDefaults = getProjectPricingDefaults(project);
        let totalMaterialsCost = 0;
        let totalLaborCost = 0;
        let totalSubtotalBeforeVat = 0;

        const sectionsData = sections.map((s) => {
            const mats = materialsBySection.get(s._id) || [];
            const wrk = workBySection.get(s._id) || [];
            const snapshot = calculateSectionSnapshot(s, mats, wrk, projectDefaults);

            totalMaterialsCost += snapshot.plannedMaterialsCostE;
            totalLaborCost += snapshot.plannedWorkCostS;
            totalSubtotalBeforeVat += snapshot.plannedClientPrice;

            return {
                sectionId: s._id,
                title: s.name,
                rollups: snapshot,
                materialLines: mats,
                workLines: wrk,
            };
        });

        const vatRate = project.vatRate ?? 0.17;
        const vatAmount = totalSubtotalBeforeVat * vatRate;

        const accountingSnapshot = {
            currency: project.currency ?? "ILS",
            vatRate,
            totals: {
                materialsCost: totalMaterialsCost,
                laborCost: totalLaborCost,
                subcontractorsCost: 0,
                shippingCost: 0,
                overheadCost: totalSubtotalBeforeVat * projectDefaults.overhead,
                profit: totalSubtotalBeforeVat * projectDefaults.profit,
                risk: totalSubtotalBeforeVat * projectDefaults.risk,
                grandTotalCost: totalMaterialsCost + totalLaborCost,
            },
            sell: {
                subtotalBeforeVat: totalSubtotalBeforeVat,
                vatAmount: vatAmount,
                totalWithVat: totalSubtotalBeforeVat + vatAmount,
            },
            sections: sectionsData,
        };

        const skill = await ctx.db
            .query("skills")
            .withIndex("by_name", (q) => q.eq("name", "quote"))
            .first();

        const settings = await ctx.runQuery(internal.settings.getAll);

        const studioDefaults = {
            studioDisplayNameHeb: "סטודיו אם-לי נוי",
            phone: "054-XXXXXXX",
            email: "studio@noy.co.il",
            address: "Haharash 4, Tel Aviv",
            logoAssetId: settings.brandingLogoStorageId,
            bankDetails: "Bank Hapoalim (12), Branch 600, Account 123456",
            defaultPaymentTemplateId: "NET30_40_60_NET60",
            defaultValidityDays: 14,
            defaultLeadTimeBusinessDays: 14,
            standardTermsSnippets: [
                "ההצעה אינה כוללת אישור קונסטרוקטור.",
                "שינויים לאחר אישור סופי יחויבו בנפרד.",
            ],
        };

        return {
            project,
            items,
            itemSpecs,
            accountingSnapshot,
            studioDefaults,
            systemPrompt: skill?.content || "You are a Quote Agent.",
        };
    },
});

export const saveQuote = internalMutation({
    args: {
        projectId: v.id("projects"),
        result: v.any(), // QuoteAgentResult
    },
    handler: async (ctx, args) => {
        const result = args.result as QuoteAgentResult;
        if (result.mode !== "draft" || !result.quote) return;

        const now = Date.now();
        const existingVersions = await ctx.db
            .query("quotes")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();
        const nextVersion = existingVersions.length + 1;

        const quoteData = result.quote;

        const quoteId = await ctx.db.insert("quotes", {
            projectId: args.projectId,
            version: nextVersion,
            internalBreakdownJson: JSON.stringify(quoteData),
            clientDocumentText: result.clientFacingDocumentMarkdown || "",
            currency: quoteData.totals.currency,
            totalAmount: quoteData.totals.totalWithVat,
            createdAt: now,
            createdBy: "agent",
        });

        return quoteId;
    },
});

export const updateQuote = mutation({
    args: {
        quoteId: v.id("quotes"),
        updates: v.object({
            internalBreakdownJson: v.optional(v.string()),
            clientDocumentText: v.optional(v.string()),
            totalAmount: v.optional(v.number()),
        }),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.quoteId, args.updates);
    },
});

export const listQuotes = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("quotes")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .collect();
    },
});

// 2. AGENT ACTION
export const runInBackground: ReturnType<typeof internalAction> = internalAction({
    args: {
        projectId: v.id("projects"),
        instructions: v.optional(v.string()),
        agentRunId: v.optional(v.id("agentRuns")),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const agentRunId = args.agentRunId;

        if (agentRunId) {
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId: agentRunId,
                status: "running",
                stage: "loading_context",
            });
        }

        try {
            const context = await ctx.runQuery(internal.agents.quote.getContext, {
                projectId: args.projectId,
            });

            const quoteContext = {
                project: {
                    projectId: context.project._id,
                    projectName: context.project.name,
                    clientName: context.project.clientName || "",
                    contactPerson: context.project.clientContact || "",
                    dateIssued: new Date().toISOString().split("T")[0],
                    installLocation: context.project.details.location || "",
                    city: context.project.details.location || "",
                    venueType: context.project.projectTypes?.[0] || "studio",
                    projectProperties: {
                        requiresStudioBuild: context.project.overview?.properties?.requiresStudioProduction || false,
                        requiresPurchases: (context.project.overview?.properties?.requiresPurchases?.length ?? 0) > 0,
                        requiresInstall: context.project.overview?.properties?.requiresInstallation || false,
                        requiresRentals: context.project.overview?.properties?.requiresRentals || false,
                        requiresMoving: context.project.overview?.properties?.requiresMoving || false,
                        requiresDismantle: context.project.overview?.properties?.requiresDismantle || false,
                        requiresPrinting: context.project.overview?.properties?.requiresPrinting || false,
                        requiresEngineeringApproval: context.project.overview?.properties?.requiresEngineeringApproval || false,
                        publicAudienceRisk: false,
                    },
                },
                selectedItems: context.itemSpecs.map(({ item, spec }) => ({
                    itemId: item._id,
                    title: item.title,
                    description: item.description || spec?.identity.description || "",
                    notes: spec?.quality?.notes || "",
                    tags: spec?.identity.tags || [],
                    quantity: spec?.quote?.includeInQuote ? (spec?.identity.accountingGroup === "management" ? 1 : 1) : 1, // simplified
                    unit: "יחידה",
                    deliverables: [],
                    constraints: spec?.state?.openQuestions || [],
                    assumptions: spec?.state?.assumptions || [],
                    references: spec?.attachments?.links?.map(l => l.url) || [],
                    pricing: {
                        sellPriceOverride: undefined,
                    },
                })),
                accountingSnapshot: {
                    ...context.accountingSnapshot,
                    totals: {
                        ...context.accountingSnapshot.totals,
                        subcontractorsCost: context.accountingSnapshot.sections.reduce((acc, s) => acc + s.rollups.plannedWorkCostS, 0), // Mocked for now
                        shippingCost: 0,
                    }
                },
                studioDefaults: context.studioDefaults,
                userInstructions: args.instructions || "",
            };

            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: agentRunId,
                    level: "info",
                    message: "Calling model to generate quote draft.",
                    stage: "llm_call",
                });
            }

            const result = await callChatWithSchema(QuoteAgentResultSchema, {
                systemPrompt: context.systemPrompt,
                userPrompt: JSON.stringify(quoteContext, null, 2),
                thinkingMode: args.thinkingMode,
            });

            if (result.mode === "draft") {
                if (agentRunId) {
                    await ctx.runMutation(internal.agentRuns.appendEvent, {
                        runId: agentRunId,
                        level: "info",
                        message: "Quote draft generated. Saving to project.",
                        stage: "persisting",
                    });
                }

                const quoteId = await ctx.runMutation(internal.agents.quote.saveQuote, {
                    projectId: args.projectId,
                    result,
                });

                if (quoteId) {
                    // Ingest into knowledge base
                    await ctx.runAction(api.knowledge.ingestArtifact, {
                        projectId: args.projectId,
                        sourceType: "quote",
                        sourceRefId: quoteId,
                        title: result.quote!.quoteTitle,
                        text: result.clientFacingDocumentMarkdown || "",
                        summary: result.quote!.executiveSummary,
                        tags: ["quote", "client_facing"],
                        topics: ["pricing"],
                        clientName: result.quote!.client.name,
                    });
                }
            } else {
                if (agentRunId) {
                    await ctx.runMutation(internal.agentRuns.appendEvent, {
                        runId: agentRunId,
                        level: "warning",
                        message: `Agent needs clarification: ${result.clarifyingQuestions?.map(q => q.question).join(", ")}`,
                        stage: "needs_clarification",
                    });
                }
            }

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

export const run: ReturnType<typeof action> = action({
    args: {
        projectId: v.id("projects"),
        instructions: v.optional(v.string()),
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
