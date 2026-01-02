"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AgentChatThread } from "../chat/AgentChatThread";
import { useItemsContext } from "../items/ItemsContext";
import { ItemEditorPanel } from "../items/ItemEditorPanel";
import type { FlowScopeType, FlowTab } from "@/src/lib/flowScope";
import { buildFlowScopeKey } from "@/src/lib/flowScope";
import { FlowItemsPanel } from "./FlowItemsPanel";
import { SuggestedElementsPanel } from "./SuggestedElementsPanel";
import { useThinkingMode } from "@/app/_context/ThinkingModeContext";
import { useModel } from "@/app/_context/ModelContext";
import { StructuredQuestionsPanel } from "./StructuredQuestionsPanel";
import { FactsPanel } from "../facts/FactsPanel";
import { CurrentStatePanel } from "../facts/CurrentStatePanel";
import { CurrentKnowledgePanel } from "../facts/CurrentKnowledgePanel";
import { IdeasPanel } from "./IdeasPanel";
import { QuestionQueuePanel } from "../questions/QuestionQueuePanel";
import { ChangeSetReviewBanner } from "../changesets/ChangeSetReviewBanner";

type Mode = "clarify" | "generate";
type ViewMode = "structured" | "chat";

function loadMode(projectId: string, tab: FlowTab): ViewMode {
    try {
        const stored = localStorage.getItem(`flow.viewMode.${projectId}.${tab}`);
        return stored === "chat" ? "chat" : "structured";
    } catch {
        return "structured";
    }
}

function saveMode(projectId: string, tab: FlowTab, mode: ViewMode) {
    try {
        localStorage.setItem(`flow.viewMode.${projectId}.${tab}`, mode);
    } catch {
        // ignore
    }
}

export function FlowWorkbench({ projectId, tab }: { projectId: Id<"projects">; tab: FlowTab }) {
    const { selectedItemId, setSelectedItemId } = useItemsContext();
    const { thinkingMode } = useThinkingMode();
    const { selectedModel } = useModel();

    const ensureWorkspace = useMutation(api.flowWorkspaces.ensure);
    const saveWorkspaceText = useMutation(api.flowWorkspaces.saveText);
    const submitCurrentStateText = useMutation(api.currentState.submitCurrentStateText);
    const ensureThread = useMutation(api.chat.ensureThread);
    const sendFlowTurn = useAction(api.agents.flow.send);
    const generateUploadUrl = useMutation(api.assets.generateUploadUrl);
    const createAssetFromUpload = useMutation(api.assets.createAssetFromUpload);
    const project = useQuery(api.projects.getProject, { projectId });

    const [selectedAllProject, setSelectedAllProject] = useState(true);
    const [selectedItemIds, setSelectedItemIds] = useState<Array<Id<"projectItems">>>([]);
    const [reviewSignal, setReviewSignal] = useState(0);

    const scopeType: FlowScopeType = useMemo(() => {
        if (selectedAllProject || selectedItemIds.length === 0) return "allProject";
        if (selectedItemIds.length === 1) return "singleItem";
        return "multiItem";
    }, [selectedAllProject, selectedItemIds.length]);

    const scopeKey = useMemo(() => {
        return buildFlowScopeKey({
            scopeType,
            scopeItemIds: selectedAllProject ? null : selectedItemIds,
        });
    }, [scopeType, selectedAllProject, selectedItemIds]);

    const workspace = useQuery(api.flowWorkspaces.get, { projectId, tab, scopeKey });
    const derivedState = useQuery(api.currentState.getDerived, {
        projectId,
        scopeType,
        scopeItemIds: selectedAllProject ? undefined : selectedItemIds,
    });

    const [workspaceId, setWorkspaceId] = useState<Id<"flowWorkspaces"> | null>(null);
    const [textDraft, setTextDraft] = useState("");
    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
    const [isSubmittingState, setIsSubmittingState] = useState(false);
    const [hasRemoteUpdate, setHasRemoteUpdate] = useState(false);
    const [rightPanelTab, setRightPanelTab] = useState<"state" | "facts" | "questions" | "ideas" | "knowledge">("state");

    const lastLoadedScopeKeyRef = useRef<string | null>(null);
    const lastRemoteTextRef = useRef<string>("");
    const pendingRemoteTextRef = useRef<string | null>(null);

    useEffect(() => {
        void (async () => {
            const result = await ensureWorkspace({
                projectId,
                tab,
                scopeType,
                scopeItemIds: selectedAllProject ? undefined : selectedItemIds,
                initialText: "",
            });
            setWorkspaceId(result.workspaceId);
        })();
    }, [ensureWorkspace, projectId, tab, scopeType, selectedAllProject, selectedItemIds]);

    useEffect(() => {
        if (!workspace) return;
        if (lastLoadedScopeKeyRef.current === scopeKey) return;
        lastLoadedScopeKeyRef.current = scopeKey;
        lastRemoteTextRef.current = workspace.text ?? "";
        pendingRemoteTextRef.current = null;
        setHasRemoteUpdate(false);
        setTextDraft(workspace.text ?? "");
        setSaveStatus("idle");
    }, [scopeKey, workspace]);

    useEffect(() => {
        if (!derivedState?.markdown) return;
        if ((workspace?.text ?? "").trim()) return;
        if (textDraft.trim()) return;
        setTextDraft(derivedState.markdown);
    }, [derivedState?.markdown, textDraft, workspace?.text]);

    useEffect(() => {
        if (!workspace) return;
        if (lastLoadedScopeKeyRef.current !== scopeKey) return;
        const remoteText = workspace.text ?? "";
        if (remoteText === lastRemoteTextRef.current) return;

        const localDirty = textDraft !== lastRemoteTextRef.current;
        lastRemoteTextRef.current = remoteText;

        if (localDirty) {
            pendingRemoteTextRef.current = remoteText;
            setHasRemoteUpdate(true);
            return;
        }

        pendingRemoteTextRef.current = null;
        setHasRemoteUpdate(false);
        setTextDraft(remoteText);
        setSaveStatus("idle");
    }, [scopeKey, textDraft, workspace]);

    useEffect(() => {
        if (!workspaceId) return;
        if (textDraft === lastRemoteTextRef.current) return;

        setSaveStatus("saving");
        const handle = setTimeout(() => {
            void (async () => {
                await saveWorkspaceText({
                    workspaceId,
                    text: textDraft,
                    source: "user",
                    manualEditedAt: Date.now(),
                });
                lastRemoteTextRef.current = textDraft;
                setSaveStatus("saved");
            })();
        }, 600);

        return () => clearTimeout(handle);
    }, [saveWorkspaceText, textDraft, workspaceId]);

    // Keep the global selectedItemId in sync so ItemEditorPanel works.
    useEffect(() => {
        if (selectedAllProject) {
            if (selectedItemId) setSelectedItemId(null);
            return;
        }
        if (selectedItemIds.length === 0) {
            if (selectedItemId) setSelectedItemId(null);
            return;
        }
        if (selectedItemId && selectedItemIds.includes(selectedItemId)) return;
        setSelectedItemId(selectedItemIds[0]);
    }, [selectedAllProject, selectedItemId, selectedItemIds, setSelectedItemId]);

    const [threadId, setThreadId] = useState<Id<"chatThreads"> | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>("structured");
    const [mode, setMode] = useState<Mode>("generate");

    const applyRemoteUpdate = () => {
        const pending = pendingRemoteTextRef.current;
        if (pending === null) return;
        lastRemoteTextRef.current = pending;
        pendingRemoteTextRef.current = null;
        setHasRemoteUpdate(false);
        setTextDraft(pending);
        setSaveStatus("idle");
    };

    const handleSubmitCurrentState = async (text: string) => {
        if (!text.trim()) return;
        setIsSubmittingState(true);
        try {
            await submitCurrentStateText({
                projectId,
                scopeType,
                scopeItemIds: selectedAllProject ? undefined : selectedItemIds,
                text,
            });
        } finally {
            setIsSubmittingState(false);
        }
    };


    useEffect(() => {
        setViewMode(loadMode(String(projectId), tab));
    }, [projectId, tab]);

    useEffect(() => {
        saveMode(String(projectId), tab, viewMode);
    }, [viewMode, projectId, tab]);

    useEffect(() => {
        if (tab !== "ideation" && rightPanelTab === "ideas") {
            setRightPanelTab("state");
        }
    }, [rightPanelTab, tab]);

    const elementsCanonical = project?.features?.elementsCanonical ?? false;
    const factsEnabled = project?.features?.factsEnabled !== false;

    useEffect(() => {
        if (elementsCanonical && rightPanelTab === "state") {
            setRightPanelTab("knowledge");
        }
    }, [elementsCanonical, rightPanelTab]);

    useEffect(() => {
        void (async () => {
            const title = tab === "ideation" ? "Ideation" : tab === "planning" ? "Planning" : "Solutioning";
            const result = await ensureThread({
                projectId,
                phase: tab,
                scenarioKey: `flow:${tab}:${scopeKey}`,
                title,
            });
            setThreadId(result.threadId);
        })();
    }, [ensureThread, projectId, scopeKey, tab]);

    const [leftPanelOpen, setLeftPanelOpen] = useState(true);
    const [rightPanelOpen, setRightPanelOpen] = useState(true);

    const bottomTabs = selectedAllProject ? [] : selectedItemIds;
    const changeSetPhase = tab === "ideation" ? "convert" : tab;
    const hasSelection = !selectedAllProject && (selectedItemIds.length > 0 || !!selectedItemId);

    return (
        <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-gray-50 border-t">
            <ChangeSetReviewBanner projectId={projectId} phase={changeSetPhase} openSignal={reviewSignal} />

            {/* LEFT SIDEBAR - ELEMENTS */}
            {leftPanelOpen && (
                <div className="w-[280px] flex-shrink-0 bg-white border-r flex flex-col z-10 transition-all">
                    <div className="p-3 border-b flex items-center justify-between bg-gray-50/50">
                        <span className="text-xs font-bold text-gray-500 uppercase">Elements</span>
                        <button onClick={() => setLeftPanelOpen(false)} className="text-gray-400 hover:text-gray-600">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
                        <FlowItemsPanel
                            projectId={projectId}
                            selectedAllProject={selectedAllProject}
                            selectedItemIds={selectedItemIds}
                            multiSelectEnabled={true}
                            onToggleMultiSelect={() => { }}
                            onSelectAllProject={() => {
                                setSelectedAllProject(true);
                                setSelectedItemIds([]);
                            }}
                            onSetSelectedItemIds={(ids) => {
                                if (ids.length === 0) {
                                    setSelectedAllProject(true);
                                    setSelectedItemIds([]);
                                } else {
                                    setSelectedAllProject(false);
                                    setSelectedItemIds(ids);
                                }
                            }}
                        />
                        <div className="border-t pt-2 mt-2">
                            <SuggestedElementsPanel
                                projectId={projectId}
                                selectedAllProject={selectedAllProject}
                                selectedItemIds={selectedItemIds}
                                phase={changeSetPhase}
                                onGenerated={() => setReviewSignal((value) => value + 1)}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* CENTER MAIN CONTENT */}
            <div className="flex-1 flex flex-col min-w-0 bg-white relative h-full">
                {!leftPanelOpen && (
                    <div className="absolute top-2 left-2 z-20">
                        <button onClick={() => setLeftPanelOpen(true)} className="p-1 bg-white border shadow rounded text-gray-500 hover:text-blue-600">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </button>
                    </div>
                )}

                {/* Top Toolbar */}
                <div className="flex items-center justify-between px-4 py-2 border-b bg-white z-20 shadow-sm flex-shrink-0 h-12">
                    <div className="flex items-center gap-2 pl-6">
                        {/* Spacer */}
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex bg-gray-100 rounded p-1">
                            <button
                                onClick={() => setViewMode("structured")}
                                className={`px-3 py-1 text-xs rounded font-medium transition-colors ${viewMode === "structured" ? "bg-white shadow text-blue-600" : "text-gray-600 hover:text-gray-900"
                                    }`}
                            >
                                Structured
                            </button>
                            <button
                                onClick={() => setViewMode("chat")}
                                className={`px-3 py-1 text-xs rounded font-medium transition-colors ${viewMode === "chat" ? "bg-white shadow text-blue-600" : "text-gray-600 hover:text-gray-900"
                                    }`}
                            >
                                Chat
                            </button>
                        </div>
                        {viewMode === "chat" && (
                            <div className="flex bg-gray-100 rounded p-1">
                                <button
                                    onClick={() => setMode("clarify")}
                                    className={`px-2 py-1 text-xs rounded font-medium transition-colors ${mode === "clarify" ? "bg-white shadow text-blue-600" : "text-gray-600 hover:text-gray-900"
                                        }`}
                                >
                                    Clarify
                                </button>
                                <button
                                    onClick={() => setMode("generate")}
                                    className={`px-2 py-1 text-xs rounded font-medium transition-colors ${mode === "generate" ? "bg-white shadow text-blue-600" : "text-gray-600 hover:text-gray-900"
                                        }`}
                                >
                                    Generate
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="w-8">
                        {/* Spacer */}
                    </div>
                </div>

                {/* MAIN CONTENT SPLIT */}
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    {/* 1. TOP PANE: CHAT/STRUCTURED */}
                    <div className={`flex flex-col relative w-full ${hasSelection ? 'h-[55%] border-b shadow-sm' : 'h-full'}`}>
                        {viewMode === "structured" ? (
                            <div className="absolute inset-0 overflow-y-auto">
                                <StructuredQuestionsPanel
                                    projectId={projectId}
                                    stage={tab === "ideation" ? "clarification" : tab}
                                />
                            </div>
                        ) : (
                            !threadId ? (
                                <div className="flex-1 flex items-center justify-center text-sm text-gray-500">Initializing workspace...</div>
                            ) : (
                                <AgentChatThread
                                    threadId={threadId}
                                    placeholder="Ask for generation..."
                                    onSend={async (content) => {
                                        await sendFlowTurn({
                                            threadId,
                                            userContent: content,
                                            tab,
                                            mode,
                                            scopeType,
                                            scopeItemIds: selectedAllProject ? undefined : selectedItemIds,
                                            model: selectedModel,
                                            thinkingMode,
                                        });
                                    }}
                                    onUpload={async (file) => {
                                        const postUrl = await generateUploadUrl();
                                        const result = await fetch(postUrl, {
                                            method: "POST",
                                            headers: { "Content-Type": file.type },
                                            body: file,
                                        });
                                        if (!result.ok) throw new Error("Upload failed");
                                        const { storageId } = await result.json();
                                        const { url } = await createAssetFromUpload({
                                            projectId,
                                            storageId,
                                            mimeType: file.type,
                                            filename: file.name,
                                        });
                                        return `![${file.name}](${url})`;
                                    }}
                                    heightClassName="h-full border-none shadow-none rounded-none"
                                />
                            )
                        )}
                    </div>

                    {/* 2. BOTTOM PANE: EDITOR (Only if selection) */}
                    {hasSelection && (
                        <div className="flex-1 bg-gray-50 flex flex-col min-h-0 overflow-hidden">
                            <div className="p-2 border-b bg-white flex items-center justify-between flex-shrink-0">
                                <div className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                    Selected Element Editor
                                </div>
                                <button
                                    onClick={() => setSelectedItemId(null)}
                                    className="text-xs text-gray-500 hover:text-gray-800"
                                >
                                    Close
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4">
                                <ItemEditorPanel />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* RIGHT SIDEBAR - CONTEXT */}
            {rightPanelOpen && (
                <div className="w-[320px] flex-shrink-0 bg-white border-l flex flex-col z-10 transition-all">
                    <div className="p-2 border-b bg-gray-50 flex items-center justify-between">
                        <div className="flex gap-1 overflow-x-auto no-scrollbar">
                            {["state", "knowledge", "facts", "questions", "ideas"].map((t) => {
                                if (t === "facts" && (!factsEnabled || elementsCanonical)) return null;
                                if (t === "ideas" && tab !== "ideation") return null;
                                if (t === "knowledge" && elementsCanonical && rightPanelTab === "state") return null;

                                return (
                                    <button
                                        key={t}
                                        onClick={() => setRightPanelTab(t as any)}
                                        className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded whitespace-nowrap ${rightPanelTab === t ? "bg-white shadow text-blue-600 border" : "text-gray-500 hover:text-gray-800"
                                            }`}
                                    >
                                        {t === "state" ? "State" : t.charAt(0).toUpperCase() + t.slice(1)}
                                    </button>
                                );
                            })}
                        </div>
                        <button onClick={() => setRightPanelOpen(false)} className="ml-2 text-gray-400 hover:text-gray-600">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto relative">
                        {rightPanelTab === "knowledge" ? (
                            <CurrentKnowledgePanel projectId={projectId} />
                        ) : rightPanelTab === "state" ? (
                            <CurrentStatePanel
                                text={textDraft}
                                onChange={setTextDraft}
                                onSubmit={handleSubmitCurrentState}
                                isSubmitting={isSubmittingState}
                                saveStatus={saveStatus}
                                updatedAt={workspace?.updatedAt}
                                hasRemoteUpdate={hasRemoteUpdate}
                                onApplyRemote={applyRemoteUpdate}
                            />
                        ) : rightPanelTab === "facts" ? (
                            <FactsPanel projectId={projectId} />
                        ) : rightPanelTab === "questions" ? (
                            <QuestionQueuePanel projectId={projectId} />
                        ) : (
                            <IdeasPanel projectId={projectId} />
                        )}
                    </div>
                </div>
            )}
            {!rightPanelOpen && (
                <div className="absolute top-2 right-2 z-20">
                    <button onClick={() => setRightPanelOpen(true)} className="p-1 bg-white border shadow rounded text-gray-500 hover:text-blue-600">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                </div>
            )}
        </div>
    );
}
