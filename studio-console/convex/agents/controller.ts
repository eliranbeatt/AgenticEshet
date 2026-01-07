import { action, query } from "../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { runSkill } from "../lib/skills";
import { buildSkillInput } from "./inputs";
import { mapPatchOpsToChangeSet } from "./patchMapper";

// 2. Controller Implementation

export type ControllerStatus = "CONTINUE" | "STOP_QUESTIONS" | "STOP_APPROVAL" | "STOP_SUGGESTIONS" | "DONE";

export type ControllerStepResult = {
    status: ControllerStatus;
    questions?: any[];
    changeSet?: any;
    artifacts?: any;
    error?: string;
    thought?: string;
    runId?: Id<"agentRuns">;
    sessionId?: Id<"agentQuestionSessions">;
};

function isContinueSignal(userMessage: string | undefined | null) {
    const trimmed = (userMessage ?? "").trim();
    if (trimmed.length === 0) return true;
    const lower = trimmed.toLowerCase();
    if (lower === "continue") return true;
    // UI uses this as a control payload (not a literal user message).
    if (trimmed.startsWith("SUGGESTIONS_SUBMIT")) return true;
    return false;
}

function parseSuggestionsSubmitPayload(payload: string | undefined | null): null | {
    mode: "USE_SELECTION" | "USE_NONE" | "REGENERATE";
    stage?: string;
    suggestionSetId?: string;
    selectedIds: string[];
    rejectedIds: string[];
    instruction?: string;
} {
    const text = (payload ?? "").trim();
    if (!text.startsWith("SUGGESTIONS_SUBMIT")) return null;
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const map = new Map<string, string>();
    for (const line of lines.slice(1)) {
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1);
        map.set(key, value);
    }
    const modeRaw = map.get("mode") ?? "";
    const mode = (modeRaw === "USE_SELECTION" || modeRaw === "USE_NONE" || modeRaw === "REGENERATE")
        ? modeRaw
        : "USE_NONE";
    const selectedIds = (map.get("selected") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const rejectedIds = (map.get("rejected") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const instructionRaw = (map.get("instruction") ?? "").trim();
    const instruction = instructionRaw && instructionRaw !== "-" ? instructionRaw : undefined;
    return {
        mode,
        stage: map.get("stage") ?? undefined,
        suggestionSetId: map.get("suggestionSetId") ?? undefined,
        selectedIds,
        rejectedIds,
        instruction,
    };
}

function parseSuggestionItemId(id: string): { skillKey: string; stage?: string; channel?: string } {
    const parts = String(id).split("::");
    const skillKey = parts[0] ?? "";
    const stage = parts[1] || undefined;
    const channel = parts[2] || undefined;
    return { skillKey, stage, channel };
}

function toChannelPin(value: string | undefined): string | null {
    if (!value) return null;
    if (value === "free_chat" || value === "free") return "free";
    if (value === "structured_questions" || value === "structured") return "structured";
    return null;
}

function normalizePinnedString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (value === "auto") return null;
    return typeof value === "string" ? value : String(value);
}

function toStructuredStage(value: unknown, fallback: string): string {
    if (value === "clarification" || value === "planning" || value === "solutioning") return value;
    if (value === "ideation") return "clarification";
    return fallback;
}

function pickSuggestedSkillKeys(params: {
    enabledSkillKeys: string[];
    activeSkillKey: string | null;
    lastShownSkillKeys: string[];
    count: number;
}) {
    // Basic implementation for now to satisfy usage in continueRun
    const { enabledSkillKeys, count } = params;
    return enabledSkillKeys.slice(0, count);
}

function parseStructuredAnswers(
    userMessage: string,
    questions: Array<{ id?: string; text?: string; title?: string }>
) {
    const questionIds = new Set(
        questions.map((q) => (q.id ? String(q.id) : "")).filter((id) => id.length > 0)
    );
    const answers: Array<{ questionId: string; quick: string; text?: string }> = [];
    const extraLines: string[] = [];

    for (const rawLine of userMessage.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        const match = line.match(/^([^:]+):\s*(.+)$/);
        if (!match) {
            extraLines.push(line);
            continue;
        }
        const questionId = match[1].trim();
        const text = match[2].trim();
        if (!questionIds.has(questionId)) {
            extraLines.push(line);
            continue;
        }
        answers.push({
            questionId,
            quick: "yes",
            text: text.length > 0 ? text : undefined,
        });
    }

    return { answers, userInstructions: extraLines.join("\n").trim() || undefined };
}

// The core logic (helper)
export async function runControllerStepLogic(
    ctx: any,
    args: {
        projectId: Id<"projects">;
        threadId?: Id<"chatThreads">;
        conversationId?: Id<"projectConversations">;
        userMessage?: string;
    }
): Promise<ControllerStepResult> {

    // 1. Read Context (Workspace, Memory, Session)
    const [state, runningMemory] = await Promise.all([
        ctx.runQuery(api.agents.controller.getWorkspaceState, {
            projectId: args.projectId,
            conversationId: args.conversationId,
        }),
        ctx.runQuery(api.memory.getRunningMemoryMarkdown, { projectId: args.projectId })
    ]);

    const workspace = state?.workspace;
    const latestSession = state?.latestSession;

    const conversation = args.conversationId
        ? await ctx.runQuery(api.projectConversations.getById, {
            projectId: args.projectId,
            conversationId: args.conversationId,
        })
        : null;

    const pinnedStage = normalizePinnedString(workspace?.stagePinned);
    const effectiveStage = pinnedStage ?? conversation?.stageTag ?? "planning";
    const effectiveChannel = workspace?.channelPinned ?? conversation?.defaultChannel ?? "free";

    const forcedSkillKey = normalizePinnedString((workspace as any)?.activeSkillKey ?? workspace?.skillPinned ?? null);

    let finalUserMessage = args.userMessage || "Continue planning";
    if (latestSession && latestSession.status === "skipped") {
        console.log("Controller detected SKIPPED session. Injecting note.");
        const note = "\n\n[System Note: The user explicitly SKIPPED the previous structured questions session. Do NOT ask more questions immediately. Assume the user wants to proceed with current info or wants you to propose a plan based on what you have.]";
        finalUserMessage += note;
    }

    if (!workspace) {
        console.warn("Workspace not found, creating empty context.");
    }

    // 1.5 Create Agent Run
    const runId = await ctx.runMutation(internal.agentRuns.createRun, {
        projectId: args.projectId,
        agent: "controller",
        stage: effectiveStage,
        initialMessage: "Controller loop started"
    });

    // 2. Run the Router (Brain) unless a skill is explicitly pinned.
    let skillKey: string;
    let nextStage: string;
    let nextChannel: string;
    let thought: string;

    if (forcedSkillKey) {
        skillKey = forcedSkillKey;
        nextStage = effectiveStage;
        nextChannel = effectiveChannel;
        thought = `Pinned skill: ${forcedSkillKey}`;
        await ctx.runMutation(internal.agentRuns.appendEvent, {
            runId,
            level: "info",
            message: `Skipping router: pinned skill '${forcedSkillKey}'.`
        });
    } else {
        console.log("Running Router...");
        await ctx.runMutation(internal.agentRuns.appendEvent, {
            runId,
            level: "info",
            message: "Invoking Router..."
        });

        const enabledSkills = await ctx.runQuery(api.agents.skills.listEnabled, { stage: effectiveStage });
        const candidateSkills = (enabledSkills || []).map((s: any) => s.skillKey);

        const routerInput = {
            userMessage: finalUserMessage,
            uiPins: { stage: effectiveStage, channel: effectiveChannel },
            workspaceSummary: runningMemory || "", // ensure string
            candidateSkills: candidateSkills
        };

        const routerResult = await runSkill(ctx, {
            skillKey: "router.stageChannelSkill",
            input: routerInput
        });

        if (!routerResult.success) {
            const err = routerResult.error;
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId,
                status: "failed",
                error: err
            });
            return { status: "DONE", error: err, runId };
        }

        const { skillKey: routerSkillKey, stage: rawNextStage, channel: routerChannel, why_he } = routerResult.data;
        skillKey = routerSkillKey;
        nextStage = rawNextStage === "cross" ? effectiveStage : rawNextStage;
        nextChannel = routerChannel;
        thought = why_he;

        await ctx.runMutation(internal.agentRuns.appendEvent, {
            runId,
            level: "info",
            message: `Router decided: ${skillKey} (${nextStage}/${nextChannel}). Reason: ${why_he}`
        });
    }

    // 4. Build Input for Selected Skill
    const skillInput = await buildSkillInput(ctx, skillKey, {
        projectId: args.projectId,
        conversationId: args.conversationId,
        userMessage: finalUserMessage,
        runningMemory: runningMemory || "",
        state
    });

    // 5. Run Selected Skill
    console.log(`Delegating to skill: ${skillKey}`);
    const subSkillResult = await runSkill(ctx, {
        skillKey,
        input: skillInput
    });

    if (!subSkillResult.success) {
        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "failed", error: subSkillResult.error });
        return { status: "DONE", error: subSkillResult.error, thought, runId };
    }

    const output = subSkillResult.data;
    console.log("Skill Output:", JSON.stringify(output, null, 2));

    // 6. Map Output to Controller Status
    // a. Questions (questions.pack5 or any skill returning questions)
    if (output.questions && Array.isArray(output.questions) && output.questions.length > 0) {
        // Start Session logic
        const sessionId = await ctx.runMutation(api.structuredQuestions.startSession, {
            projectId: args.projectId,
            stage: nextStage,
            conversationId: args.conversationId
        });

        // Map questions
        const mappedQuestions = output.questions.map((q: any) => ({
            id: q.id,
            title: q.text_he || q.text || "Untitled Question", // Handle Hebrew text field
            prompt: (q.options_he || []).join(", "),
            questionType: (q.type === "multi" || q.type === "select") ? "text" : "text", // Defaulting to text for now
            expectsFreeText: true,
            blocking: true,
            stage: nextStage
        }));

        await ctx.runMutation(internal.structuredQuestions.internal_createTurn, {
            projectId: args.projectId,
            stage: nextStage,
            sessionId,
            turnNumber: 1,
            questions: mappedQuestions,
            agentRunId: runId
        });
        await ctx.runMutation(internal.structuredQuestions.internal_updateSessionTurn, {
            sessionId,
            turnNumber: 1
        });

        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
        return { status: "STOP_QUESTIONS", questions: output.questions, thought, runId, sessionId };
    }

    // b. ChangeSet (patchOps)
    if (output.patchOps && Array.isArray(output.patchOps)) {
        // Map ops to categories
        const mapped = mapPatchOpsToChangeSet(output.patchOps);

        // Construct changeSet object
        const changeSet = {
            type: "ChangeSet",
            projectId: args.projectId,
            phase: nextStage,
            agentName: skillKey,
            summary: output.recap_he || "Proposed Changes",
            // patchOps: output.patchOps, // Removed to satisfy strict Zod schema
            assumptions: output.assumptions_he || [],
            openQuestions: output.questions_he || [],
            warnings: output.warnings_he || [],
            items: mapped.items,
            tasks: mapped.tasks,
            accountingLines: mapped.accountingLines,
            materialLines: mapped.materialLines,
            uiHints: { focusItemIds: [], expandItemIds: [], nextSuggestedAction: "approve_changeset" }
        };

        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
        return { status: "STOP_APPROVAL", changeSet, thought, runId };
    }

    // c. Suggestions (ux.suggestionsPanel)
    if (skillKey === "ux.suggestionsPanel" && output.suggestions) {
        const items = (Array.isArray(output.suggestions) ? output.suggestions : []).map((s: any, idx: number) => {
            const skillKey = typeof s?.skillKey === "string" ? s.skillKey : "";
            const stage = typeof s?.stage === "string" ? s.stage : undefined;
            const channel = typeof s?.channel === "string" ? s.channel : undefined;
            return {
                id: `${skillKey}::${stage ?? ""}::${channel ?? ""}`,
                kind: "RUN_SKILL",
                title: (typeof s?.label_he === "string" && s.label_he.trim().length > 0)
                    ? s.label_he
                    : skillKey || `Suggestion ${idx + 1}`,
                summary: typeof s?.why_he === "string" ? s.why_he : undefined,
                skillKey,
                stage,
                channel,
            };
        });

        await ctx.runMutation(api.agentSuggestionSets.create, {
            projectId: args.projectId,
            conversationId: args.conversationId,
            stage: effectiveStage,
            suggestionSetId: `auto-${Date.now()}`,
            sections: [{ title: "Suggestions", items }]
        });
        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
        return { status: "STOP_SUGGESTIONS", thought, runId };
    }

    // d. Default / Artifacts (Just chat or plan)
    // We treat everything else as "Artifacts" or "Done"
    await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
    return { status: "CONTINUE", artifacts: output, thought, runId };
}

// The Public Action
export const runControllerStep = action({
    args: { projectId: v.id("projects"), threadId: v.id("chatThreads") },
    handler: async (ctx, args) => {
        return await runControllerStepLogic(ctx, args);
    }
});

// Public Query (used by the Studio UI)
export const getWorkspaceState = query({
    args: { projectId: v.id("projects"), conversationId: v.optional(v.id("projectConversations")) },
    handler: async (ctx, args) => {
        const workspace = args.conversationId
            ? await ctx.db
                .query("projectWorkspaces")
                .withIndex("by_project_conversation", (q) =>
                    q.eq("projectId", args.projectId).eq("conversationId", args.conversationId)
                )
                .first()
            : await ctx.db
                .query("projectWorkspaces")
                .withIndex("by_project", q => q.eq("projectId", args.projectId))
                .first();

        // Fetch most recent structured session to check for skips or transcript
        const sessions = await ctx.db
            .query("structuredQuestionSessions")
            .withIndex("by_project_stage", q => q.eq("projectId", args.projectId))
            .order("desc")
            .take(1);

        const latestSession = sessions.length > 0 ? sessions[0] : null;
        let transcript = "";
        if (latestSession) {
            const turns = await ctx.db
                .query("structuredQuestionTurns")
                .withIndex("by_session_turn", (q) => q.eq("sessionId", latestSession._id))
                .collect();

            turns.sort((a, b) => a.turnNumber - b.turnNumber);

            transcript = turns.map(t => {
                const qText = (t.questions as any[]).map((q: any) => `- Q: ${q.title}`).join("\n");
                const aText = (t.answers as any[]) && (t.answers as any[]).length > 0
                    ? (t.answers as any[]).map((a: any) => `- A: [${a.quick}] ${a.text || ""}`).join("\n")
                    : "(No answers yet)";
                return `Turn ${t.turnNumber}:\n${qText}\n${aText}`;
            }).join("\n\n");
        }

        return {
            workspace,
            latestSession,
            transcript
        };
    }
});

// Mock Skill Action
export const mockSkillRun = action({
    args: { projectId: v.id("projects"), input: v.any() },
    handler: async (ctx, args) => {
        return {
            artifacts: {},
            pendingChangeSet: null
        };
    }
});

export const continueRun = action({
    args: {
        projectId: v.id("projects"),
        conversationId: v.id("projectConversations"),
        userMessage: v.optional(v.string()),
        mode: v.union(v.literal("continue"), v.literal("retry")),
        stagePinned: v.optional(v.union(v.string(), v.null())),
        skillPinned: v.optional(v.union(v.string(), v.null())),
        channelPinned: v.optional(v.union(v.string(), v.null())),
        model: v.optional(v.string()),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const suggestionsSubmit = parseSuggestionsSubmitPayload(args.userMessage);

        // 1. Ensure Workspace
        const { workspaceId } = await ctx.runMutation(api.projectWorkspaces.ensure, {
            projectId: args.projectId,
            conversationId: args.conversationId
        });

        const [workspace, conversation] = await Promise.all([
            ctx.runQuery(api.projectWorkspaces.getByConversation, {
                projectId: args.projectId,
                conversationId: args.conversationId,
            }),
            ctx.runQuery(api.projectConversations.getById, {
                projectId: args.projectId,
                conversationId: args.conversationId,
            }),
        ]);

        if (!workspace) {
            throw new Error(`Workspace not found after ensure: ${String(workspaceId)}`);
        }
        if (!conversation) {
            throw new Error("Conversation not found");
        }

        const pinnedStageArg = normalizePinnedString(args.stagePinned);
        const pinnedStageWorkspace = normalizePinnedString(workspace?.stagePinned);
        const resolvedStage = pinnedStageArg ?? pinnedStageWorkspace ?? conversation?.stageTag ?? "planning";

        let resolvedChannel =
            args.channelPinned ?? workspace?.channelPinned ?? conversation?.defaultChannel ?? "free";

        // Suggestions panel submit can override pins.
        let submitPinnedSkill: string | null | undefined = undefined;
        let submitPinnedStage: string | null | undefined = undefined;
        let submitPinnedChannel: string | null | undefined = undefined;

        if (suggestionsSubmit) {
            if (suggestionsSubmit.mode === "REGENERATE") {
                submitPinnedSkill = "ux.suggestionsPanel";
            } else if (suggestionsSubmit.mode === "USE_NONE") {
                submitPinnedSkill = null;
            } else {
                const first = suggestionsSubmit.selectedIds[0];
                if (first) {
                    const parsed = parseSuggestionItemId(first);
                    submitPinnedSkill = parsed.skillKey || null;
                    submitPinnedStage = parsed.stage || null;
                    submitPinnedChannel = toChannelPin(parsed.channel) ?? null;
                } else {
                    submitPinnedSkill = null;
                }
            }

            if (submitPinnedStage) {
                // Only adopt known stage keys; otherwise keep existing.
                submitPinnedStage = normalizePinnedString(submitPinnedStage);
            }
            if (submitPinnedChannel) {
                resolvedChannel = submitPinnedChannel;
            }
        }

        const enabledSkills = await ctx.runQuery(api.agents.skills.listEnabled, {
            stage: resolvedStage ?? undefined,
        });

        const enabledSkillKeys = (enabledSkills ?? [])
            .map((s: any) => s.skillKey)
            .filter((k: any): k is string => typeof k === "string" && k.length > 0);

        const lastShownSkillKeys =
            (workspace as any)?.lastSuggestionsState?.shownSkillKeys ?? ([] as string[]);
        const activeSkillKey =
            (args.skillPinned ?? (workspace as any)?.activeSkillKey ?? workspace?.skillPinned ?? null) as
            | string
            | null;

        const agentMode = (workspace as any)?.agentMode ?? "manual";

        const suggestedSkillKeys = pickSuggestedSkillKeys({
            enabledSkillKeys,
            activeSkillKey,
            lastShownSkillKeys,
            count: 4,
        });

        const resolvedSkillPinned =
            agentMode === "workflow"
                ? (submitPinnedSkill !== undefined ? submitPinnedSkill : (args.skillPinned ?? workspace?.skillPinned ?? null))
                : (submitPinnedSkill !== undefined
                    ? submitPinnedSkill
                    : (args.skillPinned ??
                    workspace?.skillPinned ??
                    (isContinueSignal(args.userMessage) ? (suggestedSkillKeys[0] ?? null) : null));

        // Persist pins & suggestion state for stable UX
        await ctx.runMutation(api.projectWorkspaces.setPins, {
            workspaceId,
            stagePinned: submitPinnedStage ?? pinnedStageArg,
            skillPinned: resolvedSkillPinned,
            channelPinned: submitPinnedChannel ?? args.channelPinned,
        });
        await ctx.runMutation(api.projectWorkspaces.setActiveSkill, {
            workspaceId,
            activeSkillKey: resolvedSkillPinned,
        });
        await ctx.runMutation(api.projectWorkspaces.setLastSuggestionsState, {
            workspaceId,
            shownSkillKeys: suggestedSkillKeys,
            shownAt: Date.now(),
        });

        // Append user message only when it is actual user input (not Continue / control payload)
        if (args.userMessage && !isContinueSignal(args.userMessage)) {
            await ctx.runMutation(internal.projectConversations.appendMessage, {
                conversationId: args.conversationId,
                projectId: args.projectId,
                role: "user",
                content: args.userMessage,
                stage: resolvedStage as any,
                channel: resolvedChannel as any,
            });
            await ctx.runMutation(internal.projectConversations.touchConversation, {
                conversationId: args.conversationId,
                updatedAt: Date.now(),
                lastMessageAt: Date.now(),
            });
        }

        if (args.userMessage && !isContinueSignal(args.userMessage)) {
            const lastControllerOutput = (workspace as any)?.artifactsIndex?.lastControllerOutput;
            const pendingQuestions = lastControllerOutput?.questions ?? [];
            if (Array.isArray(pendingQuestions) && pendingQuestions.length > 0) {
                const { answers, userInstructions } = parseStructuredAnswers(args.userMessage, pendingQuestions);
                if (answers.length > 0) {
                    const [clarification, planning, solutioning] = await Promise.all([
                        ctx.runQuery(api.structuredQuestions.getActiveSession, {
                            projectId: args.projectId,
                            conversationId: args.conversationId,
                            stage: "clarification",
                        }),
                        ctx.runQuery(api.structuredQuestions.getActiveSession, {
                            projectId: args.projectId,
                            conversationId: args.conversationId,
                            stage: "planning",
                        }),
                        ctx.runQuery(api.structuredQuestions.getActiveSession, {
                            projectId: args.projectId,
                            conversationId: args.conversationId,
                            stage: "solutioning",
                        }),
                    ]);
                    const sessions = [clarification, planning, solutioning].filter(Boolean);
                    const session = sessions.sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
                    if (session) {
                        await ctx.runMutation(api.structuredQuestions.saveAnswers, {
                            sessionId: session._id,
                            turnNumber: session.currentTurnNumber,
                            answers,
                            userInstructions,
                        });
                    }
                }
            }
        }

        // 2. Run Logic
        try {
            const result = await runControllerStepLogic(ctx, {
                projectId: args.projectId,
                threadId: undefined as any,
                conversationId: args.conversationId,
                userMessage: args.userMessage
            });

            if (result.error) {
                await ctx.runMutation(internal.projectConversations.appendMessage, {
                    conversationId: args.conversationId,
                    projectId: args.projectId,
                    role: "assistant",
                    content: `System Error: ${result.error}`,
                    stage: resolvedStage as any,
                    channel: resolvedChannel as any,
                });
                return { success: false, error: result.error };
            }

            // 2.5 Persist ChangeSet outputs (so UI can show approvals and Elements/Tasks can update after approval)
            let pendingChangeSetId: Id<"itemChangeSets"> | null | undefined = undefined;
            if (result.status === "STOP_APPROVAL" && result.changeSet) {
                const created = await ctx.runMutation(api.changeSets.create, {
                    changeSet: result.changeSet,
                });
                pendingChangeSetId = created?.changeSetId as Id<"itemChangeSets">;
            }

            // 3. Map Result
            let mode = "done";
            if (result.status === "STOP_QUESTIONS") mode = "ask_questions";
            if (result.status === "STOP_APPROVAL") mode = "pending_changeset";
            if (result.status === "CONTINUE" || result.status === "STOP_SUGGESTIONS") mode = "artifacts";

            const controllerOutput = {
                mode,
                stage: resolvedStage ?? "planning",
                assistantSummary: result.thought || "",
                questions: result.questions || [],
                artifacts: result.artifacts || {},
                pendingChangeSet: result.changeSet || null,
                nextSuggestedActions: suggestedSkillKeys.map((skillKey) => ({
                    skillKey,
                    label: (enabledSkills ?? []).find((s: any) => s.skillKey === skillKey)?.name ?? skillKey,
                }))
            };


            // 4. Persist
            await ctx.runMutation(internal.projectWorkspaces.updateFromController, {
                workspaceId,
                artifactsIndex: { ...(workspace.artifactsIndex || {}), lastControllerOutput: controllerOutput },
                pendingChangeSetId
            });

            let finalContent = result.thought || "";

            // Auto-format specific known artifacts for chat visibility
            if (result.status === "CONTINUE" && result.artifacts) {
                const art = result.artifacts;

                // 1. Master Plan
                if (art.plan_he) {
                    finalContent += "\n\n### תוכנית אב (Master Plan)\n";
                    if (art.plan_he.phases) {
                        art.plan_he.phases.forEach((p: any, idx: number) => {
                            finalContent += `\n**שלב ${idx + 1}: ${p.name_he}**\n${p.goal_he}\n`;
                            p.milestones_he?.forEach((m: string) => finalContent += `- משני: ${m}\n`);
                        });
                    }
                    if (art.plan_he.criticalPath_he) {
                        finalContent += `\n**נתיב קריטי:**\n${art.plan_he.criticalPath_he.join(" ← ")}\n`;
                    }
                }

                // 2. Generic "nextActions_he"
                if (art.nextActions_he && Array.isArray(art.nextActions_he)) {
                    finalContent += "\n\n**פעולות הבאות מומלצות:**\n" + art.nextActions_he.map((a: string) => `- ${a}`).join("\n");
                }

                // 3. Procurement Plan
                if (art.procurementPlan_he || art.shoppingList) {
                    if (art.procurementPlan_he) finalContent += `\n\n### תוכנית רכש\n${art.procurementPlan_he}\n`;
                    if (art.shoppingList) {
                        finalContent += `\n**רשימת קניות:**\n`;
                        art.shoppingList.forEach((item: any) => {
                            finalContent += `- **${item.elementName_he}**: ${item.item_he} (${item.needBy || "מיידי"})\n`;
                        });
                    }
                }

                // 4. Element Ideas (Ideation)
                if (art.elementIdeas && Array.isArray(art.elementIdeas)) {
                    finalContent += "\n\n### רעיונות לאלמנטים (Ideation)\n";
                    art.elementIdeas.forEach((e: any, idx: number) => {
                        finalContent += `\n**${idx + 1}. ${e.name_he}** (${e.heroOrSupport === "hero" ? "Hero" : "Support"})\n`;
                        finalContent += `> ${e.concept_he}\n`;
                        if (e.roughBudgetNIS) finalContent += `- תקציב משוער: ₪${e.roughBudgetNIS.min}-${e.roughBudgetNIS.max}\n`;
                        if (e.leadTimeDays) finalContent += `- זמן ייצור: ${e.leadTimeDays.min}-${e.leadTimeDays.max} ימים\n`;
                    });
                }

                // 5. Solutioning Options
                if (art.elementName_he && art.options && Array.isArray(art.options)) {
                    finalContent += `\n\n### חלופות ביצוע: ${art.elementName_he}\n`;
                    art.options.forEach((opt: any, idx: number) => {
                        finalContent += `\n**אפשרות ${idx + 1}: ${opt.optionName_he}**\n`;
                        finalContent += `${opt.whatItIs_he}\n`;
                        if (opt.roughCostImpact_he) finalContent += `- עלות: ${opt.roughCostImpact_he}\n`;
                    });
                }
            }

        if (finalContent.trim().length > 0) {
            await ctx.runMutation(internal.projectConversations.appendMessage, {
                conversationId: args.conversationId,
                projectId: args.projectId,
                role: "assistant",
                    content: finalContent,
                    stage: resolvedStage as any,
                    channel: resolvedChannel as any,
            });
            await ctx.runMutation(internal.projectConversations.touchConversation, {
                conversationId: args.conversationId,
                updatedAt: Date.now(),
                lastMessageAt: Date.now(),
            });
        }

        if (args.userMessage && !isContinueSignal(args.userMessage)) {
            const assistantText = finalContent.trim().length > 0 ? finalContent : "(empty)";
            await ctx.scheduler.runAfter(0, internal.memory.appendTurnSummary, {
                projectId: args.projectId,
                stage: resolvedStage ?? "planning",
                channel: resolvedChannel ?? "free",
                userText: args.userMessage,
                assistantText,
            });
        }

        return { success: true };

        } catch (error: any) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("Controller continueRun failed:", message);
            await ctx.runMutation(internal.projectConversations.appendMessage, {
                conversationId: args.conversationId,
                projectId: args.projectId,
                role: "assistant",
                content: `System Critical Error: ${message}`,
                stage: resolvedStage as any,
                channel: resolvedChannel as any,
            });
            return { success: false, error: message };
        }
    }
});
