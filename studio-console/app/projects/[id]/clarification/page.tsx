"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useParams } from "next/navigation";
import { useThinkingMode } from "../../../ThinkingModeContext";
import { AgentChatThread } from "../_components/chat/AgentChatThread";
import { ItemsTreeSidebar } from "../_components/items/ItemsTreeSidebar";
import { ItemEditorPanel } from "../_components/items/ItemEditorPanel";
import { useItemsContext } from "../_components/items/ItemsContext";

export default function PlanningChatPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    const { thinkingMode } = useThinkingMode();
    const { selectedItemId } = useItemsContext();

    const ensureThread = useMutation(api.chat.ensureDefaultThread);
    const runClarification = useAction(api.agents.clarificationV2.send);

    const planMeta = useQuery(api.projects.getPlanPhaseMeta, { projectId });

    const clarificationDoc = useQuery(api.clarificationDocs.getLatest, { projectId });
    const saveClarificationDoc = useMutation(api.clarificationDocs.save);

    const [threadId, setThreadId] = useState<Id<"chatThreads"> | null>(null);
    const [clarificationMarkdown, setClarificationMarkdown] = useState("");
    const [isSavingDoc, setIsSavingDoc] = useState(false);

    useEffect(() => {
        if (threadId) return;
        void (async () => {
        const result = await ensureThread({ projectId, phase: "clarification", title: "Planning" });
            setThreadId(result.threadId);
        })();
    }, [ensureThread, projectId, threadId]);

    useEffect(() => {
        if (clarificationDoc === undefined) return;
        setClarificationMarkdown(clarificationDoc?.contentMarkdown ?? "");
    }, [clarificationDoc]);

    const handleSaveDoc = async () => {
        setIsSavingDoc(true);
        try {
            await saveClarificationDoc({
                projectId,
                contentMarkdown: clarificationMarkdown,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to save clarification document";
            alert(message);
        } finally {
            setIsSavingDoc(false);
        }
    };

    return (
        <div className="space-y-6">
            <PhaseBadges
                projectReady={Boolean(clarificationDoc?.contentMarkdown?.trim())}
                activePlanLabel={
                    planMeta?.activePlan ? `Active plan v${planMeta.activePlan.version}` : "Plan pending approval"
                }
            />

            <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)_minmax(0,1fr)]">
                <ItemsTreeSidebar />

                <div className="space-y-4 min-h-0">
                    {threadId ? (
                        <AgentChatThread
                            threadId={threadId}
                            placeholder="Tell me what you know so far..."
                            onSend={async (content) => {
                                await runClarification({
                                    threadId,
                                    userContent: content,
                                    thinkingMode,
                                    itemId: selectedItemId ?? undefined,
                                });
                            }}
                        />
                    ) : (
                        <div className="bg-white rounded shadow-sm border p-4 text-sm text-gray-500">
                            Loading chat...
                        </div>
                    )}
                    {!selectedItemId && (
                        <div className="text-xs text-gray-500">
                            Select an item to focus the clarification chat on a specific scope.
                        </div>
                    )}
                </div>

                <div className="min-h-0">
                    <ItemEditorPanel />
                </div>
            </div>

            <div className="bg-white rounded shadow-sm border">
                <div className="flex justify-between items-center p-4 border-b">
                    <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                        Planning document
                    </h3>
                    <button
                        type="button"
                        onClick={handleSaveDoc}
                        disabled={isSavingDoc}
                        className="text-sm text-blue-700 hover:text-blue-900 disabled:opacity-50"
                    >
                        {isSavingDoc ? "Saving..." : "Save"}
                    </button>
                </div>
                <div className="p-4">
                    <textarea
                        className="w-full h-[360px] border rounded p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder={`# Planning Notes\n\n## Goals\n- ...\n\n## Scope\n- In scope: ...\n- Out of scope: ...\n\n## Assumptions\n- ...\n\n## Open questions\n- ...\n`}
                        value={clarificationMarkdown}
                        onChange={(e) => setClarificationMarkdown(e.target.value)}
                    />
                </div>
            </div>
        </div>
    );
}

function PhaseBadges({ projectReady, activePlanLabel }: { projectReady: boolean; activePlanLabel: string }) {
    return (
        <div className="flex flex-wrap gap-3">
            <span
                className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    projectReady ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
                }`}
            >
                Planning {projectReady ? "captured" : "pending"}
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">
                {activePlanLabel}
            </span>
        </div>
    );
}
