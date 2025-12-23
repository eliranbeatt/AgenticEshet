import { v } from "convex/values";
import { z } from "zod";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithSchema, streamChatText } from "../lib/openai";
import { ConceptPacketSchema } from "../lib/zodSchemas";
import { chatRules, extractGuardrails, ideationPrompt, sharedContextContract } from "../prompts/itemsPromptPack";

const FALLBACK_SYSTEM_PROMPT = [sharedContextContract, extractGuardrails, chatRules, ideationPrompt].join("\n\n");

type ParsedConcept = {
    title: string;
    oneLiner: string;
    narrative: string;
};

function parseConceptMarkdown(markdown: string): ParsedConcept[] {
    const results: ParsedConcept[] = [];
    const regex = /^##\s*Concept\s*\d+\s*:?\s*(.+)?$/gim;
    const matches = [...markdown.matchAll(regex)];
    if (matches.length === 0) return results;

    for (let idx = 0; idx < matches.length; idx += 1) {
        const match = matches[idx];
        const title = (match[1] ?? "").trim() || `Concept ${idx + 1}`;
        const sectionStart = (match.index ?? 0) + match[0].length;
        const sectionEnd = idx + 1 < matches.length ? (matches[idx + 1].index ?? markdown.length) : markdown.length;
        const section = markdown.slice(sectionStart, sectionEnd).trim();

        const boldMatch = section.match(/\*\*(.+?)\*\*/);
        const oneLiner = (boldMatch?.[1] ?? "").trim();
        const narrative = section.replace(/\*\*(.+?)\*\*/, "").trim() || section;

        results.push({
            title,
            oneLiner: oneLiner || title,
            narrative: narrative || title,
        });
    }

    return results;
}

function buildFallbackPacket(projectId: string, concepts: ParsedConcept[]) {
    const summary = concepts.map((concept) => concept.title).join("; ").slice(0, 180) || "Ideation concepts";
    return {
        type: "ConceptPacket" as const,
        projectId,
        agentName: "IDEATION_AGENT",
        summary,
        assumptions: [],
        openQuestions: [],
        concepts: {
            create: concepts.map((concept, index) => ({
                tempId: `fallback-${index + 1}`,
                title: concept.title,
                oneLiner: concept.oneLiner,
                narrative: concept.narrative,
                style: {
                    materials: [],
                    colors: [],
                    lighting: [],
                    references: [],
                },
                feasibility: {
                    studioProduction: "medium",
                    purchases: "medium",
                    rentals: "medium",
                    moving: "medium",
                    installation: "medium",
                    mainRisks: [],
                },
                impliedItemCandidates: [],
            })),
            patch: [],
        },
    };
}

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
            const fallbackPrompt = [
                "Generate exactly 3 concept directions.",
                "Output plain Markdown only (no JSON).",
                "Use headings:",
                "## Concept 1: <title>",
                "## Concept 2: <title>",
                "## Concept 3: <title>",
                "Under each concept include:",
                "- One-liner (bold)",
                "- Visual language keywords",
                "- Materials / build approach",
                "- Timeline (high level)",
                "- Risks + mitigations",
                "- Budget fit",
                "",
                "Project context:",
                `Name: ${project.name}`,
                `Client: ${project.clientName}`,
                `Stage: ${project.stage ?? "ideation"}`,
                `Budget tier: ${project.budgetTier ?? "unknown"}`,
                `Project types: ${(project.projectTypes ?? []).join(", ") || "none"}`,
            ].join("\n");

            let markdownOutput = "";
            try {
                markdownOutput = await streamChatText({
                    model,
                    systemPrompt,
                    userPrompt: fallbackPrompt,
                    language: project.defaultLanguage === "en" ? "en" : "he",
                    onDelta: async (delta) => {
                        markdownOutput += delta;
                    },
                });
            } catch {
                markdownOutput = "";
            }

            const parsed = parseConceptMarkdown(markdownOutput);
            const normalized = parsed.length > 0 ? parsed.slice(0, 3) : [
                { title: "Concept 1", oneLiner: "Concept 1", narrative: "Concept 1" },
                { title: "Concept 2", oneLiner: "Concept 2", narrative: "Concept 2" },
                { title: "Concept 3", oneLiner: "Concept 3", narrative: "Concept 3" },
            ];
            const fallbackPacket = buildFallbackPacket(project._id, normalized);

            const concepts = fallbackPacket.concepts.create.slice(0, 7).map((concept) => ({
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
                    "- n/a",
                ].join("\n"),
            }));

            await ctx.runMutation(internal.agents.ideation.upsertConceptCards, {
                projectId: project._id,
                threadId: args.threadId,
                concepts,
            });

            const fallbackContent = markdownOutput.trim() ? markdownOutput : renderConceptPacketMarkdown(fallbackPacket);
            await ctx.runMutation(internal.chat.patchMessage, {
                messageId: assistantMessageId,
                content: fallbackContent,
                status: "final",
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
