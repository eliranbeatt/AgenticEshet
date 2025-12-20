import { v } from "convex/values";
import { z } from "zod";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { ConceptPacketSchema } from "../lib/zodSchemas";

const FALLBACK_SYSTEM_PROMPT = [
    "You are an ideation assistant for experiential design / studio build projects.",
    "You propose concepts that are realistic to execute and aligned with constraints.",
    "Always default to the project's default language unless the user explicitly requests otherwise.",
].join("\n");

export const getContext = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");

        const skill = await ctx.db
            .query("skills")
            .withIndex("by_name", (q) => q.eq("name", "ideation"))
            .first();

        const relatedProjects = project.relatedPastProjectIds?.length
            ? await Promise.all(project.relatedPastProjectIds.map((id) => ctx.db.get(id)))
            : [];

        return {
            project,
            systemPrompt: skill?.content || FALLBACK_SYSTEM_PROMPT,
            relatedProjects: relatedProjects.filter(Boolean),
        };
    },
});

export const upsertConceptCards = internalMutation({
    args: {
        projectId: v.id("projects"),
        threadId: v.id("chatThreads"),
        concepts: v.array(
            v.object({
                title: v.string(),
                oneLiner: v.string(),
                detailsMarkdown: v.string(),
            })
        ),
    },
    handler: async (ctx, args) => {
        const createdAt = Date.now();
        for (const concept of args.concepts) {
            await ctx.db.insert("ideationConceptCards", {
                projectId: args.projectId,
                threadId: args.threadId,
                title: concept.title,
                oneLiner: concept.oneLiner,
                detailsMarkdown: concept.detailsMarkdown,
                createdAt,
                createdBy: "agent",
            });
        }
    },
});

export const send = action({
    args: {
        threadId: v.id("chatThreads"),
        userContent: v.string(),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        await ctx.runMutation(internal.rateLimit.consume, {
            key: `ideation:${args.threadId}`,
            limit: 15,
            windowMs: 60_000,
        });

        const { project, scenario, messages } = await ctx.runQuery(internal.chat.getThreadContext, {
            threadId: args.threadId,
        });
        const { systemPrompt, relatedProjects } = await ctx.runQuery(internal.agents.ideation.getContext, {
            projectId: project._id,
        });

        // Fetch model configuration
        const settings = await ctx.runQuery(internal.settings.getAll);
        const model = settings.modelConfig?.ideation || "gpt-5.2";

        const userMessageId = await ctx.runMutation(internal.chat.createMessage, {
            projectId: project._id,
            scenarioId: scenario._id,
            threadId: args.threadId,
            role: "user",
            content: args.userContent,
            status: "final",
        });

        const assistantMessageId = await ctx.runMutation(internal.chat.createMessage, {
            projectId: project._id,
            scenarioId: scenario._id,
            threadId: args.threadId,
            role: "assistant",
            content: "",
            status: "streaming",
        });

        const contextLines = [
            `Project: ${project.name}`,
            `Client: ${project.clientName}`,
            `Stage: ${project.stage ?? "ideation"}`,
            `Budget tier: ${project.budgetTier ?? "unknown"}`,
            `Project types: ${(project.projectTypes ?? []).join(", ") || "none"}`,
            `Default language: ${project.defaultLanguage ?? "he"}`,
        ];

        const relatedLines = relatedProjects.length
            ? [
                "Related past projects (for inspiration, do not copy blindly):",
                ...relatedProjects.map((p) => `- ${p.name}: ${p.overviewSummary ?? p.details.notes ?? ""}`.trim()),
            ]
            : ["Related past projects: none"];

        const transcript = [
            ...messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
            `USER: ${args.userContent}`,
        ].join("\n");

        const userPrompt = [
            ...contextLines,
            "",
            ...relatedLines,
            "",
            "Task:",
            "Generate exactly 3 distinct concept directions.",
            "Format as Markdown with headings:",
            "## Concept 1: <title>",
            "## Concept 2: <title>",
            "## Concept 3: <title>",
            "Under each concept include:",
            "- One-liner (bold)",
            "- Visual language keywords",
            "- Materials / build approach",
            "- Timeline (high level)",
            "- Risks + mitigations",
            "- Budget fit (tie to the project's budget tier)",
            "",
            "Conversation history:",
            transcript,
        ].join("\n");

        try {
            let extracted = await callChatWithSchema(ConceptPacketSchema, {
                model,
                systemPrompt: [
                    systemPrompt,
                    "",
                    "Return JSON only that matches the ConceptPacket schema exactly.",
                    "Do not wrap the output in a `conceptPacket` key.",
                    "Always include: type, projectId, agentName, summary, assumptions, openQuestions, concepts.",
                    "concepts.create must be an array of objects with the required fields.",
                    "concepts.patch must be an array of objects (use [] unless patching).",
                    "Use only these enums:",
                    "- feasibility: low | medium | high",
                    "- candidate.category: set_piece | print | floor | prop | installation | transport | management | other",
                ].join("\n"),
                userPrompt: JSON.stringify({
                    mode: "EXTRACT",
                    phase: "ideation",
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
                    items: [],
                    tasks: [],
                    accounting: {
                        materialLines: [],
                        workLines: [],
                        accountingLines: [],
                    },
                    quotes: [],
                    concepts: [],
                    knowledge: {
                        attachedDocs: [],
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
                    userRequest: args.userContent,
                }),
                maxRetries: 3,
                language: project.defaultLanguage === "en" ? "en" : "he",
            });

            if (!extracted.concepts.patch) {
                extracted = {
                    ...extracted,
                    concepts: { ...extracted.concepts, patch: [] },
                };
            }

            const concepts = extracted.concepts.create.slice(0, 7).map((concept) => ({
                title: concept.title,
                oneLiner: concept.oneLiner,
                detailsMarkdown: [
                    concept.narrative,
                    "",
                    "Style:",
                    `- Materials: ${concept.style.materials.join(", ") || "n/a"}`,
                    `- Colors: ${concept.style.colors.join(", ") || "n/a"}`,
                    `- Lighting: ${concept.style.lighting.join(", ") || "n/a"}`,
                    `- References: ${concept.style.references.join(", ") || "n/a"}`,
                    "",
                    "Feasibility:",
                    `- Studio production: ${concept.feasibility.studioProduction}`,
                    `- Purchases: ${concept.feasibility.purchases}`,
                    `- Rentals: ${concept.feasibility.rentals}`,
                    `- Moving: ${concept.feasibility.moving}`,
                    `- Installation: ${concept.feasibility.installation}`,
                    `- Main risks: ${concept.feasibility.mainRisks.join(", ") || "n/a"}`,
                    "",
                    "Implied item candidates:",
                    ...concept.impliedItemCandidates.map(
                        (candidate) => `- ${candidate.name} (${candidate.category})${candidate.notes ? `: ${candidate.notes}` : ""}`,
                    ),
                ].join("\n"),
            }));

            await ctx.runMutation(internal.agents.ideation.upsertConceptCards, {
                projectId: project._id,
                threadId: args.threadId,
                concepts,
            });

            await ctx.runMutation(internal.chat.patchMessage, {
                messageId: assistantMessageId,
                content: renderConceptPacketMarkdown(extracted),
                status: "final",
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await ctx.runMutation(internal.chat.patchMessage, {
                messageId: assistantMessageId,
                status: "error",
                content: `Error: ${message}`,
            });
            await ctx.runMutation(internal.chat.createMessage, {
                projectId: project._id,
                scenarioId: scenario._id,
                threadId: args.threadId,
                role: "system",
                content: `Error: ${message}`,
                status: "error",
            });
        }

        return { ok: true, userMessageId, assistantMessageId };
    },
});

function renderConceptPacketMarkdown(packet: z.infer<typeof ConceptPacketSchema>) {
    const concepts = packet.concepts.create;
    if (!concepts.length) return "No concepts generated.";
    return concepts
        .map((concept, index) => {
            const candidates = concept.impliedItemCandidates.length
                ? concept.impliedItemCandidates.map((candidate) => `- ${candidate.name} (${candidate.category})${candidate.notes ? `: ${candidate.notes}` : ""}`)
                : ["- n/a"];
            return [
                `## Concept ${index + 1}: ${concept.title}`,
                `**${concept.oneLiner}**`,
                "",
                concept.narrative,
                "",
                "Style:",
                `- Materials: ${concept.style.materials.join(", ") || "n/a"}`,
                `- Colors: ${concept.style.colors.join(", ") || "n/a"}`,
                `- Lighting: ${concept.style.lighting.join(", ") || "n/a"}`,
                `- References: ${concept.style.references.join(", ") || "n/a"}`,
                "",
                "Feasibility:",
                `- Studio production: ${concept.feasibility.studioProduction}`,
                `- Purchases: ${concept.feasibility.purchases}`,
                `- Rentals: ${concept.feasibility.rentals}`,
                `- Moving: ${concept.feasibility.moving}`,
                `- Installation: ${concept.feasibility.installation}`,
                `- Main risks: ${concept.feasibility.mainRisks.join(", ") || "n/a"}`,
                "",
                "Implied item candidates:",
                ...candidates,
            ].join("\n");
        })
        .join("\n\n");
}
