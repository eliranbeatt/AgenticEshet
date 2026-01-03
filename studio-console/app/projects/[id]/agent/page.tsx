"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { ChatComposer } from "../_components/chat/ChatComposer";
import { AgentActivityPanel } from "../_components/AgentActivityPanel";
import { FactsPanel } from "../_components/facts/FactsPanel";
import { useModel } from "@/app/_context/ModelContext";
import { useThinkingMode } from "@/app/_context/ThinkingModeContext";

const STAGES = [
    "auto",
    "ideation",
    "planning",
    "solutioning",
    "procurement",
    "scheduling",
    "critique",
    "retro",
    "printing",
    "trello",
] as const;

const CHANNELS = ["auto", "structured", "free"] as const;

type StagePin = typeof STAGES[number];
type ChannelPin = typeof CHANNELS[number];

type ControllerOutput = {
    mode: "ask_questions" | "artifacts" | "pending_changeset" | "done";
    stage: string;
    assistantSummary: string;
    questions: Array<{ id?: string; text?: string; type?: string; options?: string[] }>;
    artifacts: Record<string, unknown>;
    pendingChangeSet: { summary?: string } | null;
    nextSuggestedActions: Array<{ skillKey?: string; label?: string }>;
};

type SuggestionItem = {
    id: string;
    kind?: string;
    title: string;
    summary?: string;
    rationaleBullets?: string[];
    impact?: { cost?: string; time?: string; risk?: string };
    dependencies?: string[];
    previewActions?: string[];
};

type SuggestionSet = {
    suggestionSetId: string;
    stage?: string;
    sections: Array<{ title: string; items: SuggestionItem[] }>;
};

type ChangeSetDetail = {
    changeSet: Doc<"itemChangeSets">;
    ops: Doc<"itemChangeSetOps">[];
};

type WorkspaceArtifactsIndex = {
    lastControllerOutput?: ControllerOutput;
    lastSuggestedActions?: unknown[];
    lastStage?: string;
    lastMode?: string;
    pendingChangeSet?: unknown | null;
};

const SUGGESTION_CHIPS = [
    "Cheaper",
    "Faster",
    "More premium",
    "More options",
    "Only local vendors",
    "No PVC",
];

function formatDate(value?: number) {
    if (!value) return "";
    return new Date(value).toLocaleDateString();
}

function MessageBubble({ message }: { message: Doc<"conversationMessages"> }) {
    const isUser = message.role === "user";
    const isSystem = message.role === "system";
    const base = "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap border shadow-sm";

    if (isSystem) {
        return (
            <div className="flex justify-center">
                <div className="max-w-[90%] rounded border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-xs">
                    {message.content}
                </div>
            </div>
        );
    }

    return (
        <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
            <div
                className={`${base} ${isUser ? "bg-blue-600 text-white border-blue-700" : "bg-white text-gray-900 border-gray-200"
                    }`}
            >
                <div dir="rtl">
                    {isUser ? message.content : <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>}
                </div>
            </div>
        </div>
    );
}

export default function AgentPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    const router = useRouter();
    const searchParams = useSearchParams();
    const { selectedModel } = useModel();
    const { thinkingMode } = useThinkingMode();

    const [stagePinned, setStagePinned] = useState<StagePin>("auto");
    const [skillPinned, setSkillPinned] = useState<string>("auto");
    const [channelPinned, setChannelPinned] = useState<ChannelPin>("auto");
    const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
    const [suggestionSelections, setSuggestionSelections] = useState<Record<string, boolean>>({});
    const [suggestionInstruction, setSuggestionInstruction] = useState("");
    const [runStatus, setRunStatus] = useState<"idle" | "running">("idle");
    const [runError, setRunError] = useState<string | null>(null);
    const [activeChangeSetId, setActiveChangeSetId] = useState<Id<"itemChangeSets"> | null>(null);
    const [inspectorTab, setInspectorTab] = useState<
        "overview" | "facts" | "elements" | "tasks" | "printing" | "trello" | "raw"
    >("overview");

    const conversations = useQuery(api.projectConversations.list, {
        projectId,
        includeArchived: false,
    }) as Doc<"projectConversations">[] | undefined;

    const selectedConversationId = searchParams.get("conversationId") as Id<"projectConversations"> | null;
    const selectedConversation = useQuery(
        api.projectConversations.getById,
        selectedConversationId ? { projectId, conversationId: selectedConversationId } : "skip"
    );

    const messages = useQuery(
        api.projectConversations.listMessages,
        selectedConversationId ? { projectId, conversationId: selectedConversationId } : "skip"
    ) as Doc<"conversationMessages">[] | undefined;

    const ensureWorkspace = useMutation(api.projectWorkspaces.ensure);
    const setPins = useMutation(api.projectWorkspaces.setPins);
    const workspace = useQuery(
        api.projectWorkspaces.getByConversation,
        selectedConversationId ? { projectId, conversationId: selectedConversationId } : "skip"
    );

    const skillOptions = useQuery(api.agents.skills.listEnabled, {
        stage: stagePinned === "auto" ? undefined : stagePinned,
    }) as Doc<"skills">[] | undefined;

    const suggestionSets = useQuery(
        api.agentSuggestionSets.listLatestByConversation,
        selectedConversationId ? { projectId, conversationId: selectedConversationId, limit: 1 } : "skip"
    ) as Doc<"agentSuggestionSets">[] | undefined;

    const pendingChangeSets = useQuery(api.changeSets.listByProject, {
        projectId,
        status: "pending",
    }) as Doc<"itemChangeSets">[] | undefined;

    const trelloConfig = useQuery(api.trelloSync.getConfig, { projectId });
    const trelloSyncState = useQuery(api.trelloSync.getSyncState, { projectId });
    const printingSummary = useQuery(api.printing.getSummary, { projectId });

    const createConversation = useMutation(api.projectConversations.create);
    const renameConversation = useMutation(api.projectConversations.rename);
    const archiveConversation = useMutation(api.projectConversations.archive);
    const runController = useAction(api.agents.controller.continueRun);

    useEffect(() => {
        if (!selectedConversationId) return;
        void ensureWorkspace({ projectId, conversationId: selectedConversationId });
    }, [ensureWorkspace, projectId, selectedConversationId]);

    useEffect(() => {
        if (!workspace) return;
        if (workspace.stagePinned) setStagePinned(workspace.stagePinned as StagePin);
        if (workspace.skillPinned) setSkillPinned(workspace.skillPinned);
        if (workspace.channelPinned) setChannelPinned(workspace.channelPinned as ChannelPin);
    }, [workspace]);

    useEffect(() => {
        if (selectedConversationId || !conversations || conversations.length === 0) return;
        const first = conversations[0];
        const next = new URLSearchParams(searchParams.toString());
        next.set("conversationId", String(first._id));
        router.replace(`/projects/${projectId}/agent?${next.toString()}`);
    }, [conversations, projectId, router, searchParams, selectedConversationId]);

    const updateParam = (id: Id<"projectConversations">) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set("conversationId", String(id));
        router.replace(`/projects/${projectId}/agent?${next.toString()}`);
    };

    const handleCreateConversation = async () => {
        const result = await createConversation({
            projectId,
            stageTag: "planning",
            defaultChannel: "free",
        });
        updateParam(result.conversationId);
    };

    const handleArchive = async (conversationId: Id<"projectConversations">) => {
        await archiveConversation({ conversationId });
        if (selectedConversationId === conversationId) {
            const next = new URLSearchParams(searchParams.toString());
            next.delete("conversationId");
            router.replace(`/projects/${projectId}/agent?${next.toString()}`);
        }
    };

    const persistPins = async (next: { stage?: StagePin; skill?: string; channel?: ChannelPin }) => {
        if (!workspace?._id) return;
        await setPins({
            workspaceId: workspace._id,
            stagePinned: next.stage ?? stagePinned,
            skillPinned: next.skill ?? skillPinned,
            channelPinned: next.channel ?? channelPinned,
        });
    };

    const artifactsIndex = (workspace?.artifactsIndex as WorkspaceArtifactsIndex | undefined) ?? undefined;
    const controllerOutput = artifactsIndex?.lastControllerOutput;
    const suggestedActions = controllerOutput?.nextSuggestedActions ?? [];
    const questions = controllerOutput?.questions ?? [];
    const hasQuestions = controllerOutput?.mode === "ask_questions" && questions.length > 0;
    const latestSuggestionSet = suggestionSets?.[0] as (Doc<"agentSuggestionSets"> & SuggestionSet) | undefined;
    const hasSuggestions = !!latestSuggestionSet && (latestSuggestionSet.sections ?? []).length > 0;
    const isApprovalStop = controllerOutput?.mode === "pending_changeset";
    const activeChangeSet = useQuery(
        api.changeSets.getWithOps,
        activeChangeSetId ? { changeSetId: activeChangeSetId } : "skip"
    ) as ChangeSetDetail | null | undefined;
    const applyChangeSet = useMutation(api.changeSets.apply);
    const rejectChangeSet = useMutation(api.changeSets.reject);

    const runControllerWithMessage = async (message: string) => {
        if (!selectedConversationId) return;
        setRunStatus("running");
        setRunError(null);
        try {
            await runController({
                projectId,
                conversationId: selectedConversationId,
                userMessage: message,
                mode: "continue",
                stagePinned: stagePinned === "auto" ? null : stagePinned,
                skillPinned: skillPinned === "auto" ? null : skillPinned,
                channelPinned: channelPinned === "auto" ? null : channelPinned,
                model: selectedModel,
                thinkingMode,
            });
        } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            setRunError(messageText);
        } finally {
            setRunStatus("idle");
        }
    };

    const handleQuestionSubmit = async () => {
        const lines = questions.map((q, idx) => {
            const id = q.id ?? `Q${idx + 1}`;
            const answer = questionAnswers[id] ?? "";
            return `${id}: ${answer}`;
        });
        await runControllerWithMessage(lines.join("\n"));
    };

    const submitSuggestions = async (mode: "USE_SELECTION" | "USE_NONE" | "REGENERATE") => {
        if (!latestSuggestionSet) return;
        const selected = Object.entries(suggestionSelections)
            .filter(([, checked]) => checked)
            .map(([id]) => id);
        const rejected = (latestSuggestionSet.sections ?? [])
            .flatMap((section) => section.items ?? [])
            .map((item) => item.id)
            .filter((id) => !selected.includes(id));
        const payload = [
            "SUGGESTIONS_SUBMIT",
            `mode=${mode}`,
            `stage=${latestSuggestionSet.stage ?? controllerOutput?.stage ?? ""}`,
            `suggestionSetId=${latestSuggestionSet.suggestionSetId}`,
            `selected=${selected.join(",")}`,
            `rejected=${rejected.join(",")}`,
            `instruction=${suggestionInstruction.trim() || "-"}`,
        ].join("\n");
        await runControllerWithMessage(payload);
        setSuggestionSelections({});
        setSuggestionInstruction("");
    };

    const selectedSuggestionItems = useMemo(() => {
        if (!latestSuggestionSet) return [];
        const selectedIds = new Set(
            Object.entries(suggestionSelections)
                .filter(([, checked]) => checked)
                .map(([id]) => id)
        );
        return (latestSuggestionSet.sections ?? [])
            .flatMap((section) => section.items ?? [])
            .filter((item) => selectedIds.has(item.id));
    }, [latestSuggestionSet, suggestionSelections]);

    const skillList = useMemo(() => {
        const options = skillOptions ?? [];
        return options
            .filter((skill) => skill.enabled !== false)
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [skillOptions]);

    useEffect(() => {
        if (!latestSuggestionSet?.suggestionSetId) return;
        setSuggestionSelections({});
        setSuggestionInstruction("");
    }, [latestSuggestionSet?.suggestionSetId]);

    useEffect(() => {
        if (!pendingChangeSets || pendingChangeSets.length === 0) {
            setActiveChangeSetId(null);
            return;
        }
        if (activeChangeSetId && pendingChangeSets.some((set) => set._id === activeChangeSetId)) return;
        setActiveChangeSetId(pendingChangeSets[0]._id);
    }, [activeChangeSetId, pendingChangeSets]);

    return (
        <div className="flex flex-col gap-4 h-[calc(100vh-2rem)] min-h-0 overflow-hidden">
            <div className="bg-white border rounded-lg shadow-sm p-4 flex flex-wrap items-center gap-4 justify-between">
                <div className="flex flex-wrap items-center gap-3">
                    <label className="text-sm flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Stage</span>
                        <select
                            value={stagePinned}
                            onChange={(event) => {
                                const next = event.target.value as StagePin;
                                setStagePinned(next);
                                void persistPins({ stage: next });
                            }}
                            className="border rounded px-2 py-1 text-sm"
                        >
                            {STAGES.map((option) => (
                                <option key={option} value={option}>
                                    {option}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="text-sm flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Skill</span>
                        <select
                            value={skillPinned}
                            onChange={(event) => {
                                const next = event.target.value;
                                setSkillPinned(next);
                                void persistPins({ skill: next });
                            }}
                            className="border rounded px-2 py-1 text-sm min-w-[220px]"
                        >
                            <option value="auto">auto</option>
                            {skillList.map((skill) => (
                                <option key={skill._id} value={skill.skillKey ?? skill.name}>
                                    {skill.skillKey ?? skill.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="text-sm flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Channel</span>
                        <select
                            value={channelPinned}
                            onChange={(event) => {
                                const next = event.target.value as ChannelPin;
                                setChannelPinned(next);
                                void persistPins({ channel: next });
                            }}
                            className="border rounded px-2 py-1 text-sm"
                        >
                            {CHANNELS.map((option) => (
                                <option key={option} value={option}>
                                    {option}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    {selectedConversation ? `Active: ${selectedConversation.title}` : "Create a conversation to begin."}
                </div>
            </div>

            <div className="grid gap-4 min-h-0 grid-cols-[260px_minmax(0,1fr)_360px]">
                <div className="bg-white border rounded-lg shadow-sm flex flex-col min-h-0 overflow-hidden">
                    <div className="p-3 border-b flex items-center justify-between">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Threads</div>
                        <button
                            type="button"
                            onClick={handleCreateConversation}
                            className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700"
                        >
                            New
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-2 p-2">
                        {(conversations ?? []).length === 0 ? (
                            <div className="text-xs text-gray-500">No conversations yet.</div>
                        ) : (
                            (conversations ?? []).map((conversation) => {
                                const isActive = conversation._id === selectedConversationId;
                                return (
                                    <div
                                        key={conversation._id}
                                        className={`border rounded p-2 text-xs cursor-pointer ${isActive ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
                                            }`}
                                        onClick={() => updateParam(conversation._id)}
                                    >
                                        <div className="font-semibold text-gray-800 truncate">{conversation.title}</div>
                                        <div className="text-[10px] text-gray-500 mt-1">
                                            {conversation.stageTag} • {formatDate(conversation.lastMessageAt ?? conversation.updatedAt)}
                                        </div>
                                        {isActive && (
                                            <div className="mt-2 flex gap-2">
                                                <button
                                                    type="button"
                                                    className="text-[10px] text-blue-700 hover:underline"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        const next = prompt("Conversation title:", conversation.title) ?? "";
                                                        if (!next.trim()) return;
                                                        void renameConversation({
                                                            conversationId: conversation._id,
                                                            title: next.trim(),
                                                        });
                                                    }}
                                                >
                                                    Rename
                                                </button>
                                                <button
                                                    type="button"
                                                    className="text-[10px] text-gray-500 hover:underline"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        void handleArchive(conversation._id);
                                                    }}
                                                >
                                                    Archive
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                <div className="bg-white border rounded-lg shadow-sm flex flex-col min-h-0 overflow-hidden">
                    <div className="p-3 border-b flex items-center justify-between">
                        <div>
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Agent</div>
                            <div className="text-xs text-gray-500 mt-1">
                                Stage pin: {stagePinned} | Skill pin: {skillPinned}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                if (!selectedConversationId) return;
                                void runControllerWithMessage("Continue");
                            }}
                            className="text-xs px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                            disabled={!selectedConversationId || runStatus === "running"}
                        >
                            {runStatus === "running" ? "Running..." : skillPinned === "auto" ? "Continue (Auto)" : "Run Skill"}
                        </button>
                    </div>

                    {runError && (
                        <div className="mx-3 mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                            {runError}
                        </div>
                    )}

                    <div className="flex flex-col gap-3 p-3 border-b bg-gray-50">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Suggested actions</div>
                        <div className="flex flex-wrap gap-2">
                            {suggestedActions.length === 0 ? (
                                <span className="text-xs text-gray-500">No suggestions yet.</span>
                            ) : (
                                suggestedActions.slice(0, 3).map((action, idx) => (
                                    <button
                                        key={`${action.skillKey ?? "action"}-${idx}`}
                                        type="button"
                                        className="text-xs px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-white"
                                        onClick={() => {
                                            if (!action.skillKey) return;
                                            setSkillPinned(action.skillKey);
                                            void persistPins({ skill: action.skillKey });
                                        }}
                                    >
                                        {action.label ?? action.skillKey ?? "Action"}
                                    </button>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-hidden">
                        {hasQuestions ? (
                            <div className="p-4 space-y-4 overflow-y-auto">
                                <div className="text-sm font-semibold text-gray-800">Questions</div>
                                {questions.map((question, index) => {
                                    const id = question.id ?? `Q${index + 1}`;
                                    return (
                                        <label key={id} className="block text-xs text-gray-700 space-y-1">
                                            <span>{question.text ?? `Question ${index + 1}`}</span>
                                            <input
                                                className="w-full border rounded px-2 py-1 text-xs"
                                                value={questionAnswers[id] ?? ""}
                                                onChange={(event) =>
                                                    setQuestionAnswers((prev) => ({ ...prev, [id]: event.target.value }))
                                                }
                                            />
                                        </label>
                                    );
                                })}
                                <button
                                    type="button"
                                    onClick={() => void handleQuestionSubmit()}
                                    className="text-xs px-3 py-2 rounded bg-blue-600 text-white"
                                >
                                    Send answers & continue
                                </button>
                            </div>
                        ) : hasSuggestions ? (
                            <div className="p-4 flex flex-col gap-4 overflow-y-auto">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-semibold text-gray-800">Suggestions</div>
                                        <div className="text-xs text-gray-500 mt-1">
                                            Stop • Stage: {latestSuggestionSet.stage ?? controllerOutput?.stage ?? "-"}
                                        </div>
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        Batch: {latestSuggestionSet.suggestionSetId}
                                    </div>
                                </div>

                                <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border rounded-lg px-3 py-2 flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-semibold text-gray-600">
                                        Selected: {selectedSuggestionItems.length}
                                    </span>
                                    {selectedSuggestionItems.slice(0, 4).map((item) => (
                                        <span
                                            key={`chip-${item.id}`}
                                            className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100"
                                        >
                                            {item.title}
                                        </span>
                                    ))}
                                    {selectedSuggestionItems.length > 4 && (
                                        <span className="text-[10px] text-gray-500">
                                            +{selectedSuggestionItems.length - 4} more
                                        </span>
                                    )}
                                </div>

                                <div className="space-y-4">
                                    {(latestSuggestionSet.sections ?? []).map((section) => (
                                        <div key={section.title} className="border rounded-lg bg-white">
                                            <div className="px-3 py-2 border-b text-xs font-semibold text-gray-600 uppercase tracking-wide">
                                                {section.title} ({section.items.length})
                                            </div>
                                            <div className="divide-y">
                                                {section.items.map((item) => {
                                                    const checked = suggestionSelections[item.id] ?? false;
                                                    return (
                                                        <label key={item.id} className="flex gap-3 p-3 text-xs cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={(event) =>
                                                                    setSuggestionSelections((prev) => ({
                                                                        ...prev,
                                                                        [item.id]: event.target.checked,
                                                                    }))
                                                                }
                                                            />
                                                            <div className="flex-1 space-y-1">
                                                                <div className="text-sm font-semibold text-gray-800">
                                                                    {item.title}
                                                                </div>
                                                                {item.summary && (
                                                                    <div className="text-xs text-gray-600">
                                                                        {item.summary}
                                                                    </div>
                                                                )}
                                                                {item.rationaleBullets && item.rationaleBullets.length > 0 && (
                                                                    <ul className="text-[11px] text-gray-500 list-disc pl-4">
                                                                        {item.rationaleBullets.slice(0, 3).map((line, idx) => (
                                                                            <li key={`${item.id}-why-${idx}`}>{line}</li>
                                                                        ))}
                                                                    </ul>
                                                                )}
                                                                {item.previewActions && item.previewActions.length > 0 && (
                                                                    <div className="text-[11px] text-gray-500">
                                                                        Actions: {item.previewActions.join(", ")}
                                                                    </div>
                                                                )}
                                                                {item.dependencies && item.dependencies.length > 0 && (
                                                                    <div className="text-[11px] text-gray-500">
                                                                        Dependencies: {item.dependencies.join(", ")}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="border rounded-lg p-3 bg-white space-y-2">
                                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                                        Instruction
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {SUGGESTION_CHIPS.map((chip) => (
                                            <button
                                                key={chip}
                                                type="button"
                                                className="text-[10px] px-2 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
                                                onClick={() =>
                                                    setSuggestionInstruction((prev) =>
                                                        prev.includes(chip) ? prev : `${prev ? `${prev}, ` : ""}${chip}`
                                                    )
                                                }
                                            >
                                                {chip}
                                            </button>
                                        ))}
                                    </div>
                                    <textarea
                                        className="w-full border rounded px-2 py-2 text-xs min-h-[72px]"
                                        placeholder="Give feedback or constraints (budget, materials, vendors, etc.)"
                                        value={suggestionInstruction}
                                        onChange={(event) => setSuggestionInstruction(event.target.value)}
                                    />
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        className="text-xs px-3 py-2 rounded bg-blue-600 text-white"
                                        onClick={() => void submitSuggestions("USE_SELECTION")}
                                        disabled={selectedSuggestionItems.length === 0}
                                    >
                                        Use selected
                                    </button>
                                    <button
                                        type="button"
                                        className="text-xs px-3 py-2 rounded border border-gray-300 text-gray-700"
                                        onClick={() => void submitSuggestions("USE_NONE")}
                                    >
                                        Use none (continue)
                                    </button>
                                    <button
                                        type="button"
                                        className="text-xs px-3 py-2 rounded border border-gray-300 text-gray-700"
                                        onClick={() => void submitSuggestions("REGENERATE")}
                                    >
                                        Regenerate with instructions
                                    </button>
                                </div>
                            </div>
                        ) : isApprovalStop ? (
                            <div className="p-4 flex flex-col gap-4 overflow-y-auto">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-semibold text-gray-800">Approval</div>
                                        <div className="text-xs text-gray-500 mt-1">
                                            Stop • Pending ChangeSet review
                                        </div>
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {pendingChangeSets?.length ?? 0} pending
                                    </div>
                                </div>

                                {controllerOutput?.pendingChangeSet?.summary && (
                                    <div className="border rounded p-3 text-xs bg-yellow-50 text-yellow-900">
                                        {controllerOutput.pendingChangeSet.summary}
                                    </div>
                                )}

                                {!pendingChangeSets || pendingChangeSets.length === 0 ? (
                                    <div className="text-xs text-gray-500">No pending ChangeSets yet.</div>
                                ) : (
                                    <div className="grid gap-3 grid-cols-[200px_minmax(0,1fr)]">
                                        <div className="border rounded bg-white p-2 space-y-2 max-h-[360px] overflow-y-auto">
                                            {pendingChangeSets.map((changeSet) => (
                                                <button
                                                    key={changeSet._id}
                                                    type="button"
                                                    className={`w-full text-left border rounded p-2 text-xs ${activeChangeSetId === changeSet._id ? "border-blue-500 bg-blue-50" : "hover:bg-gray-50"}`}
                                                    onClick={() => setActiveChangeSetId(changeSet._id)}
                                                >
                                                    <div className="font-semibold text-gray-800">
                                                        {changeSet.title ?? "Untitled"}
                                                    </div>
                                                    <div className="text-[10px] text-gray-500">
                                                        {new Date(changeSet.createdAt).toLocaleString()}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>

                                        <div className="border rounded bg-white p-3 space-y-3">
                                            {!activeChangeSet?.changeSet ? (
                                                <div className="text-xs text-gray-500">Select a ChangeSet.</div>
                                            ) : (
                                                <>
                                                    <div>
                                                        <div className="text-sm font-semibold text-gray-800">
                                                            {activeChangeSet.changeSet.title ?? "Untitled"}
                                                        </div>
                                                        <div className="text-xs text-gray-500">
                                                            Agent: {activeChangeSet.changeSet.agentName}
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                                                        <span>Elements: {activeChangeSet.changeSet.counts?.items ?? 0}</span>
                                                        <span>Tasks: {activeChangeSet.changeSet.counts?.tasks ?? 0}</span>
                                                        <span>Materials: {activeChangeSet.changeSet.counts?.materialLines ?? 0}</span>
                                                        <span>Accounting: {activeChangeSet.changeSet.counts?.accountingLines ?? 0}</span>
                                                    </div>
                                                    <div className="text-[11px] text-gray-500">
                                                        Ops: {activeChangeSet.ops?.length ?? 0}
                                                    </div>
                                                    {activeChangeSet.ops && activeChangeSet.ops.length > 0 && (
                                                        <div className="border rounded bg-gray-50 p-2 max-h-40 overflow-y-auto text-[11px] text-gray-600 space-y-1">
                                                            {activeChangeSet.ops.slice(0, 8).map((op) => (
                                                                <div key={op._id}>
                                                                    {op.entityType} • {op.opType}
                                                                </div>
                                                            ))}
                                                            {activeChangeSet.ops.length > 8 && (
                                                                <div className="text-[10px] text-gray-500">
                                                                    +{activeChangeSet.ops.length - 8} more ops
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    <div className="flex gap-2">
                                                        <button
                                                            type="button"
                                                            className="text-xs px-3 py-2 rounded bg-green-600 text-white"
                                                            onClick={async () => {
                                                                if (!activeChangeSet?.changeSet) return;
                                                                await applyChangeSet({ changeSetId: activeChangeSet.changeSet._id });
                                                            }}
                                                        >
                                                            Approve
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="text-xs px-3 py-2 rounded border border-red-200 text-red-700"
                                                            onClick={async () => {
                                                                if (!activeChangeSet?.changeSet) return;
                                                                await rejectChangeSet({ changeSetId: activeChangeSet.changeSet._id });
                                                            }}
                                                        >
                                                            Reject
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col h-full">
                                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                                    {!messages ? (
                                        <div className="text-sm text-gray-500">Loading...</div>
                                    ) : messages.length === 0 ? (
                                        <div className="text-sm text-gray-500">No messages yet.</div>
                                    ) : (
                                        messages.map((message) => <MessageBubble key={message._id} message={message} />)
                                    )}
                                </div>
                                <ChatComposer
                                    placeholder="Tell the agent what to do next"
                                    disabled={!selectedConversationId || runStatus === "running"}
                                    onSend={async (content) => {
                                        await runControllerWithMessage(content);
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-white border rounded-lg shadow-sm flex flex-col min-h-0 overflow-hidden">
                    <div className="p-3 border-b">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Timeline</div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden">
                        <AgentActivityPanel projectId={projectId} />
                    </div>
                </div>
            </div>

            <div className="grid gap-4 min-h-0 grid-cols-[1fr_360px]">
                <div className="bg-white border rounded-lg shadow-sm p-4 space-y-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Controller output</div>
                    {controllerOutput ? (
                        <div className="text-sm text-gray-800 whitespace-pre-wrap">
                            {controllerOutput.assistantSummary}
                        </div>
                    ) : (
                        <div className="text-sm text-gray-500">No controller output yet.</div>
                    )}
                    {controllerOutput?.pendingChangeSet?.summary && (
                        <div className="border rounded p-3 text-xs bg-yellow-50 text-yellow-900">
                            Pending change set: {controllerOutput.pendingChangeSet.summary}
                        </div>
                    )}
                </div>
                <div className="bg-white border rounded-lg shadow-sm p-4 space-y-3 flex flex-col min-h-0">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Inspector</div>
                    <div className="flex flex-wrap gap-2">
                        {["overview", "facts", "elements", "tasks", "printing", "trello", "raw"].map((tab) => (
                            <button
                                key={tab}
                                type="button"
                                className={`text-[10px] px-2 py-1 rounded border ${inspectorTab === tab ? "border-blue-500 text-blue-700" : "border-gray-200 text-gray-500"}`}
                                onClick={() => setInspectorTab(tab as typeof inspectorTab)}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto border rounded p-3 bg-gray-50">
                        {inspectorTab === "overview" && (
                            <div className="text-xs text-gray-700 whitespace-pre-wrap">
                                {controllerOutput?.assistantSummary ?? "No summary yet."}
                            </div>
                        )}
                        {inspectorTab === "facts" && <FactsPanel projectId={projectId} />}
                        {inspectorTab === "elements" && (
                            <div className="text-xs text-gray-600 space-y-2">
                                <div>Elements view is in the Elements tab.</div>
                                <button
                                    type="button"
                                    className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600"
                                    onClick={() => router.push(`/projects/${projectId}/elements`)}
                                >
                                    Open Elements
                                </button>
                            </div>
                        )}
                        {inspectorTab === "tasks" && (
                            <div className="text-xs text-gray-600 space-y-2">
                                <div>Tasks view is in the Tasks tab.</div>
                                <button
                                    type="button"
                                    className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600"
                                    onClick={() => router.push(`/projects/${projectId}/tasks`)}
                                >
                                    Open Tasks
                                </button>
                            </div>
                        )}
                        {inspectorTab === "printing" && (
                            <div className="text-xs text-gray-700 space-y-2">
                                <div className="font-semibold text-gray-800">Printing</div>
                                <div>Groups: {printingSummary?.groupCount ?? 0}</div>
                                <div>Files: {printingSummary?.fileCount ?? 0}</div>
                                {printingSummary?.lastQaRun ? (
                                    <div className="border rounded p-2 bg-white text-[11px] text-gray-600 space-y-1">
                                        <div>Last QA: {new Date(printingSummary.lastQaRun.createdAt).toLocaleString()}</div>
                                        <div>Verdict: {printingSummary.lastQaRun.componentVerdict ?? "-"}</div>
                                        <div>Score: {printingSummary.lastQaRun.score ?? "-"}</div>
                                    </div>
                                ) : (
                                    <div className="text-[11px] text-gray-500">No QA runs yet.</div>
                                )}
                            </div>
                        )}
                        {inspectorTab === "trello" && (
                            <div className="text-xs text-gray-700 space-y-2">
                                <div className="font-semibold text-gray-800">Trello</div>
                                <div>Board: {trelloConfig?.boardId ?? "Not configured"}</div>
                                <div>
                                    Last sync:{" "}
                                    {trelloSyncState?.lastSyncedAt
                                        ? new Date(trelloSyncState.lastSyncedAt).toLocaleString()
                                        : "Never"}
                                </div>
                                <div>
                                    Mapped tasks: {trelloSyncState?.mappedTaskCount ?? 0} / {trelloSyncState?.totalTasks ?? 0}
                                </div>
                                <button
                                    type="button"
                                    className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600"
                                    onClick={() => router.push(`/projects/${projectId}/trello-view`)}
                                >
                                    Open Trello
                                </button>
                            </div>
                        )}
                        {inspectorTab === "raw" && (
                            <pre className="text-[11px] text-gray-700 whitespace-pre-wrap">
                                {controllerOutput?.artifacts
                                    ? JSON.stringify(controllerOutput.artifacts, null, 2)
                                    : "No artifacts yet."}
                            </pre>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
