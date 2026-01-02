"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { StructuredQuestionsPanel } from "../_components/flow/StructuredQuestionsPanel";
import { ElementsPanel } from "../_components/elements/ElementsPanel";
import { ElementsInspectorPanel } from "../_components/elements/ElementsInspectorPanel";
import { useItemsContext } from "../_components/items/ItemsContext";
import { ChatComposer } from "../_components/chat/ChatComposer";
import { useModel } from "@/app/_context/ModelContext";
import { useThinkingMode } from "@/app/_context/ThinkingModeContext";

const STAGES = ["ideation", "planning", "solutioning"] as const;
const CHANNELS = ["structured", "free"] as const;
const CONTEXT_MODES = ["none", "selected", "all"] as const;

type Stage = typeof STAGES[number];
type Channel = typeof CHANNELS[number];
type ContextMode = typeof CONTEXT_MODES[number];

function formatDate(value?: number) {
    if (!value) return "—";
    return new Date(value).toLocaleDateString();
}

function stageBadge(stage: Stage) {
    return stage === "ideation" ? "Ideation" : stage === "planning" ? "Planning" : "Solutioning";
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
                <div className={`text-[10px] mt-2 ${isUser ? "text-blue-100" : "text-gray-400"}`}>
                    {stageBadge(message.stage)} · {message.channel}
                </div>
            </div>
        </div>
    );
}

export default function AgentPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    const searchParams = useSearchParams();
    const router = useRouter();
    const { selectedItemId, setSelectedItemId, setSelectedItemMode, setShowDraftItems } = useItemsContext();
    const { thinkingMode } = useThinkingMode();
    const { selectedModel } = useModel();

    const [stageFilter, setStageFilter] = useState<Stage | "all">("all");
    const [searchTerm, setSearchTerm] = useState("");
    const [draftStage, setDraftStage] = useState<Stage>("ideation");
    const [draftChannel, setDraftChannel] = useState<Channel>("free");
    const [contextSearch, setContextSearch] = useState("");
    const [contextPickerOpen, setContextPickerOpen] = useState(false);
    const [plannerStatus, setPlannerStatus] = useState<"idle" | "running">("idle");
    const [plannerNotice, setPlannerNotice] = useState<string | null>(null);
    const [disambiguationData, setDisambiguationData] = useState<{
        draftOps: Array<{ type: string; elementId?: string; snapshot: any }>;
        entries: Array<{ id: string; question: string; candidates: Array<{ elementId: string; title: string }> }>;
    } | null>(null);
    const [disambiguationSelections, setDisambiguationSelections] = useState<Record<string, string>>({});
    const [summaryModalOpen, setSummaryModalOpen] = useState(false);
    const [summaryText, setSummaryText] = useState("");
    const [summaryStatus, setSummaryStatus] = useState<"idle" | "loading">("idle");

    const conversations = useQuery(api.projectConversations.list, {
        projectId,
        stageTag: stageFilter === "all" ? undefined : stageFilter,
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

    const itemsSidebar = useQuery(api.items.listSidebarTree, { projectId, includeDrafts: true });
    const approvedItems = useQuery(api.items.listApproved, { projectId });
    const draftList = useQuery(api.elementDrafts.list, { projectId });
    const itemsById = useMemo(() => {
        const map = new Map<string, string>();
        (itemsSidebar?.items ?? []).forEach((item) => {
            map.set(String(item._id), item.title);
        });
        return map;
    }, [itemsSidebar?.items]);
    const approvedById = useMemo(() => {
        const map = new Map<string, string>();
        (approvedItems ?? []).forEach((item) => {
            map.set(String(item._id), item.title);
        });
        return map;
    }, [approvedItems]);

    const createConversation = useMutation(api.projectConversations.create);
    const archiveConversation = useMutation(api.projectConversations.archive);
    const setStage = useMutation(api.projectConversations.setStage);
    const setChannel = useMutation(api.projectConversations.setChannel);
    const setContext = useMutation(api.projectConversations.setContext);
    const sendMessage = useAction(api.projectConversations.sendMessage);
    const renameConversation = useMutation(api.projectConversations.rename);
    const regenerateTitle = useAction(api.projectConversations.regenerateTitle);
    const runPlanner = useAction(api.agents.planner.chatToDrafts);
    const applyDraftOps = useAction(api.agents.planner.applyDraftOpsAction);
    const summarizeConversation = useAction(api.agents.summary.summarizeConversation);

    useEffect(() => {
        setShowDraftItems(true);
    }, [setShowDraftItems]);

    useEffect(() => {
        if (selectedConversationId || !conversations || conversations.length === 0) return;
        const first = conversations[0];
        const next = new URLSearchParams(searchParams.toString());
        next.set("conversationId", String(first._id));
        const nextQuery = next.toString();
        if (nextQuery === searchParams.toString()) return;
        router.replace(`/projects/${projectId}/agent?${nextQuery}`);
    }, [conversations, projectId, router, searchParams, selectedConversationId]);

    useEffect(() => {
        if (!selectedConversation) return;
        if (searchParams.get("stage") === selectedConversation.stageTag) return;
        const next = new URLSearchParams(searchParams.toString());
        next.set("stage", selectedConversation.stageTag);
        const nextQuery = next.toString();
        if (nextQuery === searchParams.toString()) return;
        router.replace(`/projects/${projectId}/agent?${nextQuery}`);
    }, [projectId, router, searchParams, selectedConversation]);

    const currentStage = (selectedConversation?.stageTag ?? draftStage) as Stage;
    const currentChannel = (selectedConversation?.defaultChannel ?? draftChannel) as Channel;
    const contextMode = (selectedConversation?.contextMode ?? "all") as ContextMode;
    const contextElementIds = selectedConversation?.contextElementIds ?? [];

    const filteredConversations = useMemo(() => {
        if (!conversations) return [];
        const term = searchTerm.trim().toLowerCase();
        if (!term) return conversations;
        return conversations.filter((conversation) => conversation.title.toLowerCase().includes(term));
    }, [conversations, searchTerm]);

    const updateParam = (id: Id<"projectConversations">) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set("conversationId", String(id));
        router.replace(`/projects/${projectId}/agent?${next.toString()}`);
    };

    const structuredStage = currentStage === "ideation" ? "clarification" : currentStage;
    const plannerPhase = currentStage === "ideation" ? "convert" : currentStage;

    const handleCreateConversation = async () => {
        const result = await createConversation({
            projectId,
            stageTag: currentStage,
            defaultChannel: currentChannel,
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

    const handleContextMode = async (mode: ContextMode) => {
        if (!selectedConversationId) return;
        let nextIds = contextElementIds;
        if (mode !== "selected") {
            nextIds = [];
            setContextPickerOpen(false);
        } else {
            const approvedSet = new Set(approvedItems?.map((item) => String(item._id)) ?? []);
            nextIds = contextElementIds.filter((id) => approvedSet.has(String(id)));
            if (nextIds.length === 0 && selectedItemId && approvedSet.has(String(selectedItemId))) {
                nextIds = [selectedItemId];
            }
            setContextPickerOpen(true);
        }
        await setContext({
            conversationId: selectedConversationId,
            contextMode: mode,
            contextElementIds: nextIds,
        });
    };

    const handleToggleElement = async (elementId: Id<"projectItems">) => {
        if (!selectedConversationId) return;
        const exists = contextElementIds.includes(elementId);
        const next = exists
            ? contextElementIds.filter((id) => id !== elementId)
            : [...contextElementIds, elementId];
        await setContext({
            conversationId: selectedConversationId,
            contextMode: "selected",
            contextElementIds: next,
        });
    };

    const handleRemoveElement = async (elementId: Id<"projectItems">) => {
        if (!selectedConversationId) return;
        const next = contextElementIds.filter((id) => id !== elementId);
        await setContext({
            conversationId: selectedConversationId,
            contextMode: next.length === 0 ? "none" : "selected",
            contextElementIds: next,
        });
    };

    const filteredApproved = useMemo(() => {
        const term = contextSearch.trim().toLowerCase();
        if (!term) return approvedItems ?? [];
        return (approvedItems ?? []).filter((item) => item.title.toLowerCase().includes(term));
    }, [approvedItems, contextSearch]);

    const focusDrafts = () => {
        const firstDraft = draftList?.[0];
        if (!firstDraft) return;
        setSelectedItemMode("draft");
        setSelectedItemId(firstDraft.draft.elementId);
    };

    return (
        <div className="flex flex-col gap-4 min-h-[85vh]">
            <div className="bg-white border rounded-lg shadow-sm p-4 flex flex-wrap items-center gap-4 justify-between">
                <div className="flex flex-wrap items-center gap-3">
                    <label className="text-sm flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Stage</span>
                        <select
                            value={currentStage}
                            onChange={(event) => {
                                const next = event.target.value as Stage;
                                if (selectedConversationId) {
                                    void setStage({ conversationId: selectedConversationId, stageTag: next });
                                } else {
                                    setDraftStage(next);
                                    const params = new URLSearchParams(searchParams.toString());
                                    params.set("stage", next);
                                    router.replace(`/projects/${projectId}/agent?${params.toString()}`);
                                }
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
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Channel</span>
                        <select
                            value={currentChannel}
                            onChange={(event) => {
                                const next = event.target.value as Channel;
                                if (selectedConversationId) {
                                    void setChannel({ conversationId: selectedConversationId, defaultChannel: next });
                                } else {
                                    setDraftChannel(next);
                                }
                            }}
                            className="border rounded px-2 py-1 text-sm"
                        >
                            {CHANNELS.map((option) => (
                                <option key={option} value={option}>
                                    {option === "structured" ? "structured questions" : "free chat"}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="text-sm flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Context</span>
                        <select
                            value={contextMode}
                            onChange={(event) => void handleContextMode(event.target.value as ContextMode)}
                            className="border rounded px-2 py-1 text-sm"
                            disabled={!selectedConversationId}
                        >
                            {CONTEXT_MODES.map((option) => (
                                <option key={option} value={option}>
                                    {option}
                                </option>
                            ))}
                        </select>
                    </label>
                    {contextMode === "selected" && (
                        <button
                            type="button"
                            onClick={() => setContextPickerOpen((value) => !value)}
                            className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700"
                            disabled={!selectedConversationId}
                        >
                            {contextPickerOpen ? "Hide elements" : "Select elements"}
                        </button>
                    )}
                </div>
                <div className="text-xs text-gray-500">
                    {selectedConversation ? `Active: ${selectedConversation.title}` : "Create a conversation to begin."}
                </div>
            </div>

            {plannerNotice && (
                <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded px-3 py-2">
                    {plannerNotice}
                </div>
            )}

            {selectedConversationId && contextMode === "selected" && contextPickerOpen && (
                <div className="bg-white border rounded-lg shadow-sm p-3 space-y-3">
                    <div className="flex items-center gap-2">
                        <input
                            className="flex-1 border rounded px-2 py-1 text-xs"
                            placeholder="Search approved elements..."
                            value={contextSearch}
                            onChange={(event) => setContextSearch(event.target.value)}
                        />
                        <span className="text-[10px] text-gray-500">
                            {contextElementIds.length} selected
                        </span>
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-2">
                        {filteredApproved.length === 0 ? (
                            <div className="text-xs text-gray-500">No approved elements found.</div>
                        ) : (
                            filteredApproved.map((item) => {
                                const checked = contextElementIds.includes(item._id);
                                return (
                                    <label key={item._id} className="flex items-center gap-2 text-xs text-gray-700">
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => void handleToggleElement(item._id)}
                                        />
                                        <span className="truncate">{item.title}</span>
                                    </label>
                                );
                            })
                        )}
                    </div>
                    {contextElementIds.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {contextElementIds.map((id) => (
                                <span
                                    key={String(id)}
                                    className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 flex items-center gap-2"
                                >
                                    {approvedById.get(String(id)) ?? itemsById.get(String(id)) ?? String(id).slice(-6)}
                                    <button
                                        type="button"
                                        onClick={() => void handleRemoveElement(id)}
                                        className="text-[10px] text-gray-500 hover:text-gray-700"
                                    >
                                        Remove
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="grid gap-4 min-h-0 grid-cols-[260px_minmax(0,1fr)]">
                <div className="bg-white border rounded-lg shadow-sm p-3 flex flex-col min-h-0">
                    <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Conversations</div>
                        <button
                            type="button"
                            onClick={() => void handleCreateConversation()}
                            className="text-xs px-2 py-1 rounded bg-blue-600 text-white"
                        >
                            New
                        </button>
                    </div>
                    <div className="mt-3 space-y-2">
                        <input
                            className="w-full border rounded px-2 py-1 text-xs"
                            placeholder="Search conversations..."
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                        />
                        <select
                            className="w-full border rounded px-2 py-1 text-xs"
                            value={stageFilter}
                            onChange={(event) => setStageFilter(event.target.value as Stage | "all")}
                        >
                            <option value="all">All stages</option>
                            {STAGES.map((stage) => (
                                <option key={stage} value={stage}>
                                    {stage}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="mt-3 flex-1 overflow-y-auto space-y-2">
                        {filteredConversations.length === 0 ? (
                            <div className="text-xs text-gray-500">No conversations yet.</div>
                        ) : (
                            filteredConversations.map((conversation) => {
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
                                            {stageBadge(conversation.stageTag)} · {formatDate(conversation.lastMessageAt ?? conversation.updatedAt)}
                                        </div>
                                        <div className="mt-2 flex justify-between items-center">
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                                {conversation.defaultChannel}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    void handleArchive(conversation._id);
                                                }}
                                                className="text-[10px] text-gray-400 hover:text-gray-600"
                                            >
                                                Archive
                                            </button>
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
                                                        void regenerateTitle({
                                                            projectId,
                                                            conversationId: conversation._id,
                                                        });
                                                    }}
                                                >
                                                    Auto-title from chat
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                <div className="grid grid-rows-2 gap-4 min-h-0">
                    <div className="bg-white border rounded-lg shadow-sm flex flex-col min-h-0">
                        <div className="p-3 border-b flex items-center justify-between">
                            <div>
                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Agent</div>
                                <div className="text-xs text-gray-500 mt-1">
                                    Stage: {currentStage} | Channel: {currentChannel}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={async () => {
                                        if (!selectedConversationId) return;
                                        setSummaryModalOpen(true);
                                        setSummaryStatus("loading");
                                        try {
                                            const result = await summarizeConversation({
                                                projectId,
                                                conversationId: selectedConversationId,
                                            });
                                            setSummaryText(result.text);
                                        } catch (error) {
                                            const message = error instanceof Error ? error.message : String(error);
                                            setSummaryText(`Summary failed: ${message}`);
                                        } finally {
                                            setSummaryStatus("idle");
                                        }
                                    }}
                                    className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 disabled:opacity-50"
                                    disabled={!selectedConversation}
                                >
                                    Summary
                                </button>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        if (!selectedConversationId) return;
                                        setPlannerStatus("running");
                                        setPlannerNotice(null);
                                        try {
                                            const result = await runPlanner({ projectId, conversationId: selectedConversationId });
                                            if (result.status === "needs_disambiguation") {
                                                setDisambiguationData({
                                                    draftOps: result.draftOps,
                                                    entries: result.disambiguation,
                                                });
                                                setPlannerNotice("Planner needs disambiguation before writing drafts.");
                                            } else {
                                                setPlannerNotice(`Drafts updated: ${result.updated}, created: ${result.created}.`);
                                                focusDrafts();
                                            }
                                        } catch (error) {
                                            const message = error instanceof Error ? error.message : String(error);
                                            setPlannerNotice(`Planner failed: ${message}`);
                                        } finally {
                                            setPlannerStatus("idle");
                                        }
                                    }}
                                    className="text-xs px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
                                    disabled={plannerStatus === "running" || !selectedConversation}
                                >
                                    {plannerStatus === "running" ? "Planning..." : "Turn chat into Draft Elements"}
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 min-h-0 relative">
                            {!selectedConversation ? (
                                <div className="p-4 text-sm text-gray-500">
                                    Select a conversation or create a new one to begin.
                                </div>
                            ) : currentChannel === "structured" ? (
                                <div className="absolute inset-0">
                                    <StructuredQuestionsPanel
                                        projectId={projectId}
                                        stage={structuredStage}
                                        conversationId={selectedConversation._id}
                                    />
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
                                        placeholder="Ask for ideas, constraints, or solution approaches"
                                        disabled={!selectedConversation}
                                        onSend={async (content) => {
                                            await sendMessage({
                                                projectId,
                                                conversationId: selectedConversation._id,
                                                userContent: content,
                                                model: selectedModel,
                                                thinkingMode,
                                            });
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="grid gap-4 min-h-0 grid-cols-[1fr_minmax(0,1fr)_420px]">
                        <div className="min-h-0">
                            <ElementsPanel />
                        </div>
                        <div className="min-h-0">
                            <ElementsInspectorPanel />
                        </div>
                    </div>
                </div>
            </div>

            {disambiguationData && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
                    <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b">
                            <div className="text-sm font-semibold text-gray-800">Resolve disambiguation</div>
                            <button
                                type="button"
                                className="text-xs text-gray-500 hover:text-gray-700"
                                onClick={() => setDisambiguationData(null)}
                            >
                                Close
                            </button>
                        </div>
                        <div className="p-4 space-y-4 text-sm">
                            {disambiguationData.entries.map((entry) => (
                                <div key={entry.id} className="space-y-2">
                                    <div className="text-xs font-semibold text-gray-600">{entry.question}</div>
                                    <select
                                        className="w-full border rounded px-2 py-1 text-sm"
                                        value={disambiguationSelections[entry.id] ?? ""}
                                        onChange={(event) =>
                                            setDisambiguationSelections((prev) => ({
                                                ...prev,
                                                [entry.id]: event.target.value,
                                            }))
                                        }
                                    >
                                        <option value="">Select element...</option>
                                        {entry.candidates.map((candidate) => (
                                            <option key={candidate.elementId} value={candidate.elementId}>
                                                {candidate.title}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>
                        <div className="px-4 py-3 border-t flex justify-end gap-2">
                            <button
                                type="button"
                                className="text-xs px-3 py-2 rounded border border-gray-300"
                                onClick={() => setDisambiguationData(null)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="text-xs px-3 py-2 rounded bg-blue-600 text-white"
                                onClick={async () => {
                                    if (!selectedConversationId) return;
                                    const selections = disambiguationSelections;
                                    const missing = disambiguationData.entries.filter(
                                        (entry) => !selections[entry.id],
                                    );
                                    if (missing.length > 0) {
                                        setPlannerNotice("Pick an element for each disambiguation.");
                                        return;
                                    }
                                    const result = await applyDraftOps({
                                        projectId,
                                        conversationId: selectedConversationId,
                                        draftOps: disambiguationData.draftOps,
                                        selections,
                                    });
                                    setDisambiguationData(null);
                                    setPlannerNotice(`Drafts updated: ${result.updated}, created: ${result.created}.`);
                                    focusDrafts();
                                }}
                            >
                                Apply drafts
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {summaryModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
                    <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b">
                            <div className="text-sm font-semibold text-gray-800">Conversation summary</div>
                            <button
                                type="button"
                                className="text-xs text-gray-500 hover:text-gray-700"
                                onClick={() => setSummaryModalOpen(false)}
                            >
                                Close
                            </button>
                        </div>
                        <div className="p-4">
                            {summaryStatus === "loading" ? (
                                <div className="text-sm text-gray-500">Generating summary...</div>
                            ) : (
                                <textarea
                                    className="w-full min-h-[240px] border rounded p-3 text-xs"
                                    value={summaryText}
                                    onChange={(event) => setSummaryText(event.target.value)}
                                />
                            )}
                        </div>
                        <div className="px-4 py-3 border-t flex justify-end gap-2">
                            <button
                                type="button"
                                className="text-xs px-3 py-2 rounded border border-gray-300"
                                onClick={() => setSummaryModalOpen(false)}
                            >
                                Close
                            </button>
                            <button
                                type="button"
                                className="text-xs px-3 py-2 rounded bg-blue-600 text-white"
                                onClick={async () => {
                                    await navigator.clipboard.writeText(summaryText);
                                }}
                                disabled={!summaryText.trim()}
                            >
                                Copy to clipboard
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
