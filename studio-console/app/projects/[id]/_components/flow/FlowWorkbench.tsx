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
import { useThinkingMode } from "@/app/_context/ThinkingModeContext";
import { useModel } from "@/app/_context/ModelContext";
import { StructuredQuestionsPanel } from "./StructuredQuestionsPanel";
import { FactsPanel } from "../facts/FactsPanel";
import { CurrentStatePanel } from "../facts/CurrentStatePanel";
import { IdeasPanel } from "./IdeasPanel";
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
    const ensureThread = useMutation(api.chat.ensureThread);
    const sendFlowTurn = useAction(api.agents.flow.send);
    const generateUploadUrl = useMutation(api.assets.generateUploadUrl);
    const createAssetFromUpload = useMutation(api.assets.createAssetFromUpload);

    const [selectedAllProject, setSelectedAllProject] = useState(true);
    const [selectedItemIds, setSelectedItemIds] = useState<Array<Id<"projectItems">>>([]);

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

    const [workspaceId, setWorkspaceId] = useState<Id<"flowWorkspaces"> | null>(null);
    const [textDraft, setTextDraft] = useState("");
    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
    const [hasRemoteUpdate, setHasRemoteUpdate] = useState(false);
    const [rightPanelTab, setRightPanelTab] = useState<"state" | "facts" | "ideas">("state");

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

    const derivedState = useQuery(api.currentState.getDerived, {
        projectId,
        scopeType,
        scopeItemIds: selectedAllProject ? undefined : selectedItemIds,
    });


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

    const bottomTabs = selectedAllProject ? [] : selectedItemIds;

    return (
        <div className="flex flex-col gap-8 pb-20">
            {tab === "ideation" && (
                <ChangeSetReviewBanner projectId={projectId} phase="convert" />
            )}
            {/* Top row: left / center / right */}
            <div className="grid gap-4 h-[85vh] grid-cols-[260px_minmax(0,1fr)_420px]">
                <FlowItemsPanel
                    projectId={projectId}
                    selectedAllProject={selectedAllProject}
                    selectedItemIds={selectedItemIds}
                    multiSelectEnabled={true}
                    onToggleMultiSelect={() => {}}
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

                <div className="bg-white border rounded-lg shadow-sm flex flex-col min-h-0">
                    <div className="p-3 border-b flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Chat</div>
                            <div className="text-xs text-gray-500 mt-1 truncate">Scope: {scopeKey}</div>
                        </div>
                        <div className="flex items-center gap-2">
                            {viewMode === "chat" && (
                                <div className="flex items-center bg-gray-100 rounded p-1 gap-1 mr-2">
                                    <button
                                        onClick={() => setMode("clarify")}
                                        className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
                                            mode === "clarify" ? "bg-white shadow text-blue-600" : "text-gray-600 hover:text-gray-900"
                                        }`}
                                        title="Ask clarification questions"
                                    >
                                        Clarify
                                    </button>
                                    <button
                                        onClick={() => setMode("generate")}
                                        className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
                                            mode === "generate" ? "bg-white shadow text-blue-600" : "text-gray-600 hover:text-gray-900"
                                        }`}
                                        title="Generate ideas and content"
                                    >
                                        Generate
                                    </button>
                                </div>
                            )}

                            <div className="flex items-center bg-gray-100 rounded p-1 gap-1">
                                <button
                                    onClick={() => setViewMode("structured")}
                                    className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                                        viewMode === "structured" ? "bg-white shadow text-blue-600" : "text-gray-600 hover:text-gray-900"
                                    }`}
                                >
                                    Structured Questions
                                </button>
                                <button
                                    onClick={() => setViewMode("chat")}
                                    className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                                        viewMode === "chat" ? "bg-white shadow text-blue-600" : "text-gray-600 hover:text-gray-900"
                                    }`}
                                >
                                    Generation Chat
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 relative">
                        {viewMode === "structured" ? (
                            <div className="absolute inset-0">
                                <StructuredQuestionsPanel 
                                    projectId={projectId} 
                                    stage={tab === "ideation" ? "clarification" : tab} 
                                />
                            </div>
                        ) : (
                            !threadId ? (
                                <div className="p-4 text-sm text-gray-500">Initializing chat...</div>
                            ) : (
                                <AgentChatThread
                                    threadId={threadId}
                                    placeholder="Ask to generate/expand ideas and execution approaches"
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
                                heightClassName="h-full"
                            />
                        ))}
                    </div>
                </div>

                    <div className="bg-white border rounded-lg shadow-sm flex flex-col min-h-0">
                        <div className="p-3 border-b flex items-center justify-between bg-gray-50">
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => setRightPanelTab("state")}
                                    className={`text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded ${rightPanelTab === "state" ? "bg-white shadow text-blue-600" : "text-gray-500"}`}
                                >
                                    Current State
                                </button>
                                <button 
                                    onClick={() => setRightPanelTab("facts")}
                                    className={`text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded ${rightPanelTab === "facts" ? "bg-white shadow text-blue-600" : "text-gray-500"}`}
                                >
                                    Facts Ledger
                                </button>
                                {tab === "ideation" && (
                                    <button
                                        onClick={() => setRightPanelTab("ideas")}
                                        className={`text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded ${rightPanelTab === "ideas" ? "bg-white shadow text-blue-600" : "text-gray-500"}`}
                                    >
                                        Ideas
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="flex-1 min-h-0 relative">
                            {rightPanelTab === "state" ? (
                                <CurrentStatePanel
                                    derivedMarkdown={derivedState?.markdown ?? ""}
                                    text={textDraft}
                                    onChange={setTextDraft}
                                    saveStatus={saveStatus}
                                    updatedAt={workspace?.updatedAt}
                                    hasRemoteUpdate={hasRemoteUpdate}
                                    onApplyRemote={applyRemoteUpdate}
                                />
                            ) : rightPanelTab === "facts" ? (
                                <FactsPanel projectId={projectId} />
                            ) : (
                                <IdeasPanel projectId={projectId} />
                            )}
                    </div>
                </div>
            </div>

            {/* Bottom row: structured editor */}
            <div className="bg-white border rounded-lg shadow-sm flex flex-col">
                <div className="p-3 border-b flex items-center justify-between">
                    <div>
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Structured editor</div>
                        <div className="text-xs text-gray-500 mt-1">
                            {selectedAllProject
                                ? "Select an item to edit"
                                : bottomTabs.length > 1
                                    ? "Multiple items selected"
                                    : ""}
                        </div>
                    </div>
                </div>

                {bottomTabs.length > 1 && (
                    <div className="px-3 py-2 border-b flex flex-wrap gap-2">
                        {bottomTabs.map((id) => {
                            const isActive = selectedItemId === id;
                            return (
                                <button
                                    key={String(id)}
                                    type="button"
                                    onClick={() => setSelectedItemId(id)}
                                    className={`text-xs px-3 py-1 rounded border ${
                                        isActive ? "bg-blue-50 border-blue-300 text-blue-800" : "bg-white hover:bg-gray-50"
                                    }`}
                                >
                                    {String(id).slice(-6)}
                                </button>
                            );
                        })}
                    </div>
                )}

                <div className="p-3">
                    <ItemEditorPanel />
                </div>
            </div>
        </div>
    );
}

