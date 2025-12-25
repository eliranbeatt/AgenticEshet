"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ItemSpecV2 } from "@/convex/lib/zodSchemas";
import { AgentChatThread } from "../chat/AgentChatThread";
import { useItemsContext } from "../items/ItemsContext";
import { ItemEditorPanel } from "../items/ItemEditorPanel";
import type { FlowScopeType, FlowTab } from "@/src/lib/flowScope";
import { buildFlowScopeKey } from "@/src/lib/flowScope";
import { FlowItemsPanel } from "./FlowItemsPanel";
import { useThinkingMode } from "@/app/_context/ThinkingModeContext";
import { useModel } from "@/app/_context/ModelContext";
import { StructuredQuestionsPanel } from "./StructuredQuestionsPanel";

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

function systemPromptFor(tab: FlowTab, mode: Mode) {
    const focus =
        tab === "ideation"
            ? "Ideation"
            : tab === "planning"
                ? "Planning"
                : "Solutioning";

    if (mode === "generate") {
        return [
            `You are assisting in ${focus}.`,
            "Generate/Expand mode: propose alternatives and expansions.",
            "Do not claim to have updated any structured fields.",
            "If you suggest item updates, express them as candidates only.",
        ].join("\n");
    }

    return [
        `You are assisting in ${focus}.`,
        "Clarify & Suggest mode:",
        "Return exactly 3 targeted clarification questions and exactly 3 actionable suggestions.",
        "Use this markdown format:",
        "## Clarification questions\n1. ...\n2. ...\n3. ...\n\n## Suggestions\n1. **Title**: ...\n   - Details: ...\n   - Why it helps: ...\n2. ...\n3. ...",
        "Do not output a full item spec. Do not say you updated fields.",
    ].join("\n");
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

    const [multiSelectEnabled, setMultiSelectEnabled] = useState(false);
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

    const lastLoadedScopeKeyRef = useRef<string | null>(null);
    const lastRemoteTextRef = useRef<string>("");

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
        setTextDraft(workspace.text ?? "");
        setSaveStatus("idle");
    }, [scopeKey, workspace]);

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

    const generateItemUpdate = useAction(api.agents.flow.generateItemUpdate);
    const applySpec = useMutation(api.items.applySpec);
    const [previewSpec, setPreviewSpec] = useState<ItemSpecV2 | null>(null);
    const [isGeneratingSpec, setIsGeneratingSpec] = useState(false);
    const [isApplyingSpec, setIsApplyingSpec] = useState(false);

    const handleTurnIntoItem = async () => {
        if (!threadId || !textDraft) return;
        setIsGeneratingSpec(true);
        try {
            const result = await generateItemUpdate({
                threadId,
                workspaceText: textDraft,
                model: selectedModel,
            });
            
            // Auto-apply the spec
            await applySpec({
                projectId,
                itemId: selectedItemId ? (selectedItemId as Id<"projectItems">) : undefined,
                spec: result as ItemSpecV2,
            });
            
            // setPreviewSpec(result as ItemSpecV2); // Skipped preview
        } catch (e) {
            console.error("Failed to generate spec", e);
            alert("Failed to generate item spec. See console.");
        } finally {
            setIsGeneratingSpec(false);
        }
    };

    const handleApplySpec = async () => {
        if (!previewSpec || !projectId) return;
        setIsApplyingSpec(true);
        try {
            await applySpec({
                projectId,
                itemId: selectedItemId ? (selectedItemId as Id<"projectItems">) : undefined,
                spec: previewSpec,
            });
            setPreviewSpec(null);
        } catch (e) {
            console.error("Failed to apply spec", e);
            alert("Failed to apply spec. See console.");
        } finally {
            setIsApplyingSpec(false);
        }
    };


    useEffect(() => {
        setViewMode(loadMode(String(projectId), tab));
    }, [projectId, tab]);

    useEffect(() => {
        saveMode(String(projectId), tab, viewMode);
    }, [viewMode, projectId, tab]);

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
                            
                            <button
                                type="button"
                                className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
                                onClick={handleTurnIntoItem}
                                disabled={isGeneratingSpec || !threadId}
                                title="Generate item spec from current understanding"
                            >
                                {isGeneratingSpec ? "Generating..." : "Turn into item"}
                            </button>
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
                    <div className="p-3 border-b flex items-center justify-between">
                        <div>
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                Current understanding
                            </div>
                            <div className="text-xs text-gray-500 mt-1">{saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : ""}</div>
                        </div>
                    </div>
                    <div className="flex-1 min-h-0 p-3">
                        <textarea
                            className="w-full h-full border rounded p-3 text-sm font-mono"
                            value={textDraft}
                            onChange={(e) => setTextDraft(e.target.value)}
                            placeholder="Project summary + per-item blocks (markdown)"
                            dir="rtl"
                        />
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

            {previewSpec && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl w-[800px] max-h-[90vh] flex flex-col">
                        <div className="p-4 border-b flex items-center justify-between">
                            <h3 className="font-semibold">Preview Item Update</h3>
                            <button onClick={() => setPreviewSpec(null)} className="text-gray-500 hover:text-gray-700">
                                ✕
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto flex-1 font-mono text-xs">
                            <pre>{JSON.stringify(previewSpec, null, 2)}</pre>
                        </div>
                        <div className="p-4 border-t flex justify-end gap-2">
                            <button
                                onClick={() => setPreviewSpec(null)}
                                className="px-3 py-1 border rounded hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleApplySpec}
                                disabled={isApplyingSpec}
                                className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                                {isApplyingSpec ? "Applying..." : "Apply Changes"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
