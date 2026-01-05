import { action, query } from "../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { runSkill } from "../lib/skills";

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
    return trimmed.length === 0 || trimmed.toLowerCase() === "continue";
}

function shouldSuggestSkill(skillKey: string) {
    if (!skillKey) return false;
    const blacklist = new Set(["controller.autonomousPlanner", "ux.suggestedActionsTop3"]);
    if (blacklist.has(skillKey)) return false;
    if (skillKey.startsWith("ux.")) return false;
    if (skillKey.startsWith("controller.")) return false;
    return true;
}

function pickSuggestedSkillKeys(params: {
    enabledSkillKeys: string[];
    activeSkillKey: string | null;
    lastShownSkillKeys: string[];
    count: number;
}) {
    const { enabledSkillKeys, activeSkillKey, lastShownSkillKeys, count } = params;
    const filtered = enabledSkillKeys
        .filter(shouldSuggestSkill)
        .filter((k) => k !== activeSkillKey);

    const lastSet = new Set(lastShownSkillKeys);
    const scored = filtered.map((k) => ({
        skillKey: k,
        score: lastSet.has(k) ? -1 : 0,
    }));

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.skillKey.localeCompare(b.skillKey);
    });

    return scored.slice(0, count).map((s) => s.skillKey);
}

type StructuredStage = "clarification" | "planning" | "solutioning";

function normalizePinnedString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (value === "auto") return null;
    return typeof value === "string" ? value : String(value);
}

function toStructuredStage(value: unknown, fallback: StructuredStage): StructuredStage {
    if (value === "clarification" || value === "planning" || value === "solutioning") return value;
    if (value === "ideation") return "clarification";
    return fallback;
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

    // 1. Read Workspace State
    // 1. Read Workspace State
    const state = await ctx.runQuery(api.agents.controller.getWorkspaceState, {
        projectId: args.projectId,
        conversationId: args.conversationId,
    });
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
    const structuredStage = toStructuredStage(effectiveStage, "planning");
    const effectiveChannel = workspace?.channelPinned ?? conversation?.defaultChannel ?? "free";

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

    // 2. Run the Brain (Controller Skill)
    console.log("Running Controller Brain...");
    await ctx.runMutation(internal.agentRuns.appendEvent, {
        runId,
        level: "info",
        message: "Invoking autonomous planner..."
    });

    const runningMemory = await ctx.runQuery(api.memory.getRunningMemoryMarkdown, { projectId: args.projectId });
    
    const input = {
        ...(workspace || {}),
        projectId: args.projectId,
        stagePinned: effectiveStage,
        channelPinned: effectiveChannel,
        skillPinned: workspace?.skillPinned || null,
        userMessage: finalUserMessage,
        recentTranscript: (state as any)?.transcript || "",
        mode: "continue",
        runningMemory, // NEW MEMORY
    };
    // @ts-ignore
    delete input.facts; // Remove old facts

    const brainResult = await runSkill(ctx, {
        skillKey: "controller.autonomousPlanner",
        input
    });

    if (!brainResult.success) {
        await ctx.runMutation(internal.agentRuns.setStatus, {
            runId,
            status: "failed",
            error: brainResult.error
        });
        return { status: "DONE", error: brainResult.error, runId };
    }

    const data = brainResult.data;
    console.log("Controller Result Data:", JSON.stringify(data, null, 2));

    const { mode, assistantSummary, questions, pendingChangeSet, skillCall, artifacts, suggestionSet } = data || {};
    const thought = assistantSummary;

    await ctx.runMutation(internal.agentRuns.appendEvent, {
        runId,
        level: "info",
        message: `Brain decided: ${mode}. Summary: ${thought?.slice(0, 50)}...`
    });

    if (!mode) {
        const err = "Controller produced no mode. Data: " + JSON.stringify(data);
        console.error(err);
        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "failed", error: err });

        return { status: "DONE", error: err, thought, runId };
    }

    // 3. Handle Decision
    if (mode === "ask_questions") {
        const stage = structuredStage;

        // 1. Start a Structured Session (Archives old ones, creates new 'active' one)
        const sessionId = await ctx.runMutation(api.structuredQuestions.startSession, {
            projectId: args.projectId,
            stage: stage as any,
            conversationId: args.conversationId
        });

        // 2. Map Brain Questions to StructuredQuestions Schema
        // Brain: { id, text, type, options }
        // SQ: { id, title, prompt, questionType: 'text'|'boolean', expectsFreeText, ... }
        const mappedQuestions = (questions || []).map((q: any) => ({
            id: q.id,
            title: q.text,
            prompt: q.options?.join(", "), // unexpected in SQ but storing options in prompt for now
            questionType: (q.type === "select" && q.options?.includes("yes")) ? "boolean" : "text",
            expectsFreeText: true,
            blocking: true,
            stage: stage
        }));

        // 3. Create Turn 1
        await ctx.runMutation(internal.structuredQuestions.internal_createTurn, {
            projectId: args.projectId,
            stage: stage as any,
            sessionId,
            turnNumber: 1,
            questions: mappedQuestions,
            agentRunId: runId
        });

        // 4. Update Session Pointer
        await ctx.runMutation(internal.structuredQuestions.internal_updateSessionTurn, {
            sessionId,
            turnNumber: 1
        });

        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
        return { status: "STOP_QUESTIONS", questions: questions || [], thought, runId, sessionId };
    }

    if (mode === "pending_changeset") {
        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
        return { status: "STOP_APPROVAL", changeSet: pendingChangeSet, thought, runId };
    }

    if (mode === "suggestions") {
        if (suggestionSet) {
            await ctx.runMutation(api.agentSuggestionSets.create, {
                projectId: args.projectId,
                stage: effectiveStage,
                suggestionSetId: `auto-${Date.now()}`,
                sections: [{ title: suggestionSet.title || "Suggestions", items: suggestionSet.items || [] }]
            });
        }
        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
        return { status: "STOP_SUGGESTIONS", thought, runId };
    }

    if (mode === "run_skill" && skillCall) {
        const { skillKey, input } = skillCall;

        console.log(`Controller delegating to skill: ${skillKey}`);
        await ctx.runMutation(internal.agentRuns.appendEvent, {
            runId,
            level: "info",
            message: `Delegating to skill: ${skillKey}`
        });

        const subSkillResult = await runSkill(ctx, {
            skillKey,
            input: input || workspace || {}
        });

        if (!subSkillResult.success) {
            await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "failed", error: subSkillResult.error });
            return { status: "DONE", error: subSkillResult.error, thought, runId };
        }

        const subArtifacts = subSkillResult.data;

        // CHECK FOR BUBBLED UP GATES (ChangeSet / Suggestions) in subArtifacts
        // Many skills return { proposedChangeSet: ... } or { concepts: ... }

        // 1. ChangeSet Bubble Up
        if (subArtifacts && subArtifacts.proposedChangeSet) {
            await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
            return {
                status: "STOP_APPROVAL",
                changeSet: subArtifacts.proposedChangeSet,
                thought: thought + " (Proposed by " + skillKey + ")",
                runId
            };
        }

        // 2. Suggestions Bubble Up (e.g. concepts)
        if (subArtifacts && Array.isArray(subArtifacts.concepts)) {
            await ctx.runMutation(api.agentSuggestionSets.create, {
                projectId: args.projectId,
                stage: effectiveStage,
                suggestionSetId: `auto-${Date.now()}`,
                sections: [{ title: "Generated Concepts", items: subArtifacts.concepts }]
            });
            await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
            return { status: "STOP_SUGGESTIONS", thought: thought + " (Concepts generated)", runId };
        }

        // Update workspace with artifacts
        if (workspace && subArtifacts) {
            await ctx.runMutation(internal.projectWorkspaces.updateFromController, {
                workspaceId: workspace._id,
                artifactsIndex: { ...(workspace.artifactsIndex || {}), ...subArtifacts }
            });
        }

        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });

        return {
            status: "CONTINUE",
            artifacts: subArtifacts,
            thought,
            runId
        };
    }

    if (mode === "artifacts") {
        if (workspace && artifacts) {
            await ctx.runMutation(internal.projectWorkspaces.updateFromController, {
                workspaceId: workspace._id,
                artifactsIndex: { ...(workspace.artifactsIndex || {}), ...artifacts }
            });
        }
        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
        return { status: "CONTINUE", artifacts, thought, runId };
    }

    if (mode === "done") {
        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });
        return { status: "DONE", thought, runId };
    }

    await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "failed", error: "Unknown mode" });
    return { status: "DONE", thought, error: "Unknown mode", runId };
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
        const resolvedChannel =
            args.channelPinned ?? workspace?.channelPinned ?? conversation?.defaultChannel ?? "free";

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
                ? (args.skillPinned ?? workspace?.skillPinned ?? null)
                : (args.skillPinned ??
                    workspace?.skillPinned ??
                    (isContinueSignal(args.userMessage) ? (suggestedSkillKeys[0] ?? null) : null));

        // Persist pins & suggestion state for stable UX
        await ctx.runMutation(api.projectWorkspaces.setPins, {
            workspaceId,
            stagePinned: pinnedStageArg,
            skillPinned: resolvedSkillPinned,
            channelPinned: args.channelPinned,
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

        // Append user message only when it is actual user input (not Continue)
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

            if (result.thought && result.thought.trim().length > 0) {
                await ctx.runMutation(internal.projectConversations.appendMessage, {
                    conversationId: args.conversationId,
                    projectId: args.projectId,
                    role: "assistant",
                    content: result.thought,
                    stage: resolvedStage as any,
                    channel: resolvedChannel as any,
                });
                await ctx.runMutation(internal.projectConversations.touchConversation, {
                    conversationId: args.conversationId,
                    updatedAt: Date.now(),
                    lastMessageAt: Date.now(),
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
