import { z } from "zod";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { ItemSpecV2Schema } from "../lib/zodSchemas";
import type { Doc } from "../_generated/dataModel";

const DraftOpSchema = z.object({
    type: z.enum(["update_existing", "create_new"]),
    elementId: z.string().optional(),
    snapshot: ItemSpecV2Schema,
    reason: z.string().optional(),
});

const DisambiguationSchema = z.object({
    id: z.string(),
    question: z.string(),
    candidates: z.array(z.object({
        elementId: z.string(),
        title: z.string(),
    })).min(2),
    snapshot: ItemSpecV2Schema,
});

const PlannerOutputSchema = z.object({
    draftOps: z.array(DraftOpSchema),
    needsUserDisambiguation: z.array(DisambiguationSchema).optional(),
});

type DraftOp = z.infer<typeof DraftOpSchema>;
type Disambiguation = z.infer<typeof DisambiguationSchema>;

function summarizeSpec(spec: z.infer<typeof ItemSpecV2Schema>) {
    return [
        spec.identity.title,
        spec.identity.typeKey,
        spec.identity.description ? `Desc: ${spec.identity.description}` : "",
        `Tasks: ${spec.breakdown.subtasks.length}`,
        `Materials: ${spec.breakdown.materials.length}`,
        `Labor: ${spec.breakdown.labor.length}`,
    ].filter(Boolean).join(" | ");
}

function buildSystemPrompt() {
    return [
        "You are a planner that turns conversations into element drafts.",
        "You must be ID-aware and update existing elements by ID whenever possible.",
        "Only create new elements for net-new concepts.",
        "If you are unsure which existing element to update, return a disambiguation entry instead of writing drafts.",
        "Use ItemSpecV2 for every snapshot. Do not use legacy keys like itemType/title at the top level.",
        "Required keys in snapshot: version, identity, breakdown, state.",
        "identity must include title and typeKey. typeKey is a short lowercase identifier (e.g. \"runbook\", \"proposal\", \"set_piece\").",
        "",
        "Rules:",
        "1) Use update_existing with elementId from the provided index when it matches.",
        "2) Use create_new only when no existing element fits. If new, set elementId to \"NEW\".",
        "3) If ambiguous, add needsUserDisambiguation with candidates and snapshot. Also add a draftOp with type update_existing and elementId \"AMBIG:<id>\" that references the same snapshot.",
        "4) If ambiguous, do NOT create any other draftOps for that snapshot.",
        "5) Output full ItemSpecV2 snapshots in snapshot.",
        "",
        "ItemSpecV2 minimal template:",
        "{\"version\":\"ItemSpecV2\",\"identity\":{\"title\":\"\",\"typeKey\":\"\"},\"breakdown\":{\"subtasks\":[],\"materials\":[],\"labor\":[]},\"state\":{\"openQuestions\":[],\"assumptions\":[],\"decisions\":[]}}",
        "",
        "Return JSON that matches the schema exactly.",
    ].join("\n");
}

function buildUserPrompt(args: {
    project: Doc<"projects">;
    conversationMessages: Doc<"conversationMessages">[];
    structuredTranscript: string;
    approvedIndex: Array<{ elementId: string; summary: string }>;
    existingDrafts: Array<{ elementId: string; summary: string }>;
}) {
    return [
        `PROJECT: ${args.project.name}`,
        `CLIENT: ${args.project.clientName}`,
        `DEFAULT_LANGUAGE: ${args.project.defaultLanguage ?? "he"}`,
        `OVERVIEW: ${JSON.stringify(args.project.overview || {})}`,
        "",
        "APPROVED ELEMENT INDEX (ID -> SUMMARY):",
        args.approvedIndex.length > 0
            ? args.approvedIndex.map((entry) => `${entry.elementId}: ${entry.summary}`).join("\n")
            : "(none)",
        "",
        "EXISTING DRAFT SLOTS:",
        args.existingDrafts.length > 0
            ? args.existingDrafts.map((entry) => `${entry.elementId}: ${entry.summary}`).join("\n")
            : "(none)",
        "",
        "STRUCTURED ANSWERS (THIS CONVERSATION):",
        args.structuredTranscript || "(none)",
        "",
        "CONVERSATION HISTORY:",
        args.conversationMessages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n"),
        "",
        "Output JSON now.",
    ].join("\n");
}

function resolveDraftOps(args: {
    conversation: Doc<"projectConversations">;
    approvedById: Map<string, Doc<"projectItems">>;
    draftOps: DraftOp[];
    disambiguationSelections?: Record<string, string>;
}) {
    const contextIds = args.conversation.contextMode === "selected"
        ? new Set((args.conversation.contextElementIds ?? []).map((id) => String(id)))
        : null;

    const isAllowed = (elementId: string) => {
        if (!args.approvedById.has(elementId)) return false;
        if (args.conversation.contextMode === "none") return false;
        if (!contextIds) return true;
        return contextIds.has(elementId);
    };

    const resolvedOps: Array<{ type: DraftOp["type"]; elementId?: string; snapshot: DraftOp["snapshot"] }> = [];

    for (const op of args.draftOps) {
        let elementId = op.elementId;

        if (op.type === "update_existing" && !elementId) {
            throw new Error("update_existing requires elementId");
        }

        if (elementId?.startsWith("AMBIG:")) {
            const key = elementId.replace("AMBIG:", "");
            const chosen = args.disambiguationSelections?.[key];
            if (!chosen) {
                throw new Error(`Missing disambiguation selection for ${key}`);
            }
            elementId = chosen;
        } else if (elementId && !elementId.toUpperCase().startsWith("NEW")) {
            if (!isAllowed(elementId)) {
                throw new Error(`Element ${elementId} is not in the approved context.`);
            }
            if (op.type === "create_new") {
                throw new Error(`Element ${elementId} already exists; use update_existing instead.`);
            }
        }

        resolvedOps.push({ type: op.type, elementId, snapshot: op.snapshot });
    }

    return resolvedOps;
}

export const chatToDrafts = action({
    args: {
        projectId: v.id("projects"),
        conversationId: v.id("projectConversations"),
    },
    handler: async (ctx, args) => {
        const runId = await ctx.runMutation(internal.agentRuns.createRun, {
            projectId: args.projectId,
            agent: "planner.chatToDrafts",
            stage: "planner_start",
        });

        try {
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId,
                status: "running",
                stage: "building_context",
            });

            const conversation = await ctx.runQuery(api.projectConversations.getById, {
                projectId: args.projectId,
                conversationId: args.conversationId,
            });
            if (!conversation) {
                throw new Error("Conversation not found");
            }

            const project = await ctx.runQuery(api.projects.getProject, { projectId: args.projectId });
            if (!project) {
                throw new Error("Project not found");
            }

            const messages = await ctx.runQuery(api.projectConversations.listMessages, {
                projectId: args.projectId,
                conversationId: args.conversationId,
            });

            const stageMap: Record<string, "clarification" | "planning" | "solutioning"> = {
                "ideation": "clarification",
                "planning": "planning",
                "solutioning": "solutioning",
            };

            const structuredTranscript = await ctx.runQuery(internal.structuredQuestions.getTranscript, {
                projectId: args.projectId,
                conversationId: args.conversationId,
                stage: stageMap[conversation.stageTag] || "clarification",
            });

            const approvedWithSpecs = await ctx.runQuery(api.items.listApprovedWithSpecs, {
                projectId: args.projectId,
            }) as Array<{ item: Doc<"projectItems">; spec: z.infer<typeof ItemSpecV2Schema> }>;

            const approvedIndex = approvedWithSpecs
                .filter((entry) => {
                    if (conversation.contextMode === "none") return false;
                    if (conversation.contextMode === "all") return true;
                    const allowed = new Set((conversation.contextElementIds ?? []).map((id) => String(id)));
                    return allowed.has(String(entry.item._id));
                })
                .map((entry) => ({
                    elementId: String(entry.item._id),
                    summary: summarizeSpec(entry.spec),
                }));

            const drafts = await ctx.runQuery(api.elementDrafts.list, { projectId: args.projectId });
            const existingDrafts = drafts
                .filter((entry) => {
                    if (conversation.contextMode === "none") return false;
                    if (conversation.contextMode === "all") return true;
                    const allowed = new Set((conversation.contextElementIds ?? []).map((id) => String(id)));
                    return allowed.has(String(entry.draft.elementId));
                })
                .map((entry) => ({
                    elementId: String(entry.draft.elementId),
                    summary: summarizeSpec(ItemSpecV2Schema.parse(entry.draft.data)),
                }));

            const result = await callChatWithSchema(PlannerOutputSchema, {
                systemPrompt: buildSystemPrompt(),
                userPrompt: buildUserPrompt({
                    project,
                    conversationMessages: messages,
                    structuredTranscript,
                    approvedIndex,
                    existingDrafts,
                }),
                model: "gpt-5-mini",
                temperature: 0.2,
            });

            const disambiguation = result.needsUserDisambiguation ?? [];
            if (disambiguation.length > 0) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId,
                    level: "info",
                    stage: "needs_disambiguation",
                    message: `Planner returned ${disambiguation.length} disambiguation items.`,
                });
                await ctx.runMutation(internal.agentRuns.setStatus, {
                    runId,
                    status: "succeeded",
                    stage: "needs_disambiguation",
                });
                return {
                    status: "needs_disambiguation" as const,
                    disambiguation,
                    draftOps: result.draftOps,
                };
            }

            const approvedById = new Map<string, Doc<"projectItems">>();
            for (const entry of approvedWithSpecs) {
                approvedById.set(String(entry.item._id), entry.item);
            }
            const resolvedOps = resolveDraftOps({
                conversation,
                approvedById,
                draftOps: result.draftOps,
            });

            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId,
                status: "running",
                stage: "writing_drafts",
            });

            const applied = await ctx.runMutation(api.elementDrafts.applyDraftOps, {
                projectId: args.projectId,
                ops: resolvedOps,
            });

            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId,
                level: "info",
                stage: "done",
                message: `Drafts written. Created: ${applied.created}, Updated: ${applied.updated}.`,
            });

            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId,
                status: "succeeded",
                stage: "done",
            });

            return { status: "ok" as const, ...applied };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId,
                status: "failed",
                stage: "error",
                error: message,
            });
            throw error;
        }
    },
});

export const applyDraftOpsAction = action({
    args: {
        projectId: v.id("projects"),
        conversationId: v.id("projectConversations"),
        draftOps: v.any(),
        selections: v.optional(v.any()),
    },
    handler: async (ctx, args) => {
        const runId = await ctx.runMutation(internal.agentRuns.createRun, {
            projectId: args.projectId,
            agent: "planner.applyDraftOps",
            stage: "planner_start",
        });

        try {
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId,
                status: "running",
                stage: "validating",
            });

            const conversation = await ctx.runQuery(api.projectConversations.getById, {
                projectId: args.projectId,
                conversationId: args.conversationId,
            });
            if (!conversation) {
                throw new Error("Conversation not found");
            }

            const parsedOps = PlannerOutputSchema.shape.draftOps.parse(args.draftOps);
            const selections = (args.selections ?? {}) as Record<string, string>;
            const approvedWithSpecs = await ctx.runQuery(api.items.listApprovedWithSpecs, {
                projectId: args.projectId,
            }) as Array<{ item: Doc<"projectItems">; spec: z.infer<typeof ItemSpecV2Schema> }>;
            const approvedById = new Map<string, Doc<"projectItems">>();
            for (const entry of approvedWithSpecs) {
                approvedById.set(String(entry.item._id), entry.item);
            }

            const resolvedOps = resolveDraftOps({
                conversation,
                approvedById,
                draftOps: parsedOps,
                disambiguationSelections: selections,
            });

            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId,
                status: "running",
                stage: "writing_drafts",
            });

            const applied = await ctx.runMutation(api.elementDrafts.applyDraftOps, {
                projectId: args.projectId,
                ops: resolvedOps,
            });

            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId,
                level: "info",
                stage: "done",
                message: `Drafts written. Created: ${applied.created}, Updated: ${applied.updated}.`,
            });

            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId,
                status: "succeeded",
                stage: "done",
            });

            return { status: "ok" as const, ...applied };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId,
                status: "failed",
                stage: "error",
                error: message,
            });
            throw error;
        }
    },
});
