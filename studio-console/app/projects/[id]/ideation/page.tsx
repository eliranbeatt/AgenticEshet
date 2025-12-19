"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentChatThread } from "../_components/chat/AgentChatThread";

export default function IdeationPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;

    const ensureThread = useMutation(api.chat.ensureDefaultThread);
    const runIdeation = useAction(api.agents.ideation.send);
    const conceptCards = useQuery(api.ideation.listConceptCards, { projectId });
    const clearCards = useMutation(api.ideation.clearConceptCards);

    const [threadId, setThreadId] = useState<Id<"chatThreads"> | null>(null);
    const [scenarioId, setScenarioId] = useState<Id<"projectScenarios"> | null>(null);

    useEffect(() => {
        if (threadId) return;
        void (async () => {
            const result = await ensureThread({ projectId, phase: "ideation", title: "Ideation" });
            setThreadId(result.threadId);
            setScenarioId(result.scenarioId);
        })();
    }, [ensureThread, projectId, threadId]);

    const cardsByThread = useMemo(() => {
        if (!conceptCards || !threadId) return [];
        return conceptCards.filter((c: Doc<"ideationConceptCards">) => c.threadId === threadId);
    }, [conceptCards, threadId]);

    if (!threadId || !scenarioId) {
        return <div className="p-4 text-sm text-gray-500">Initializing ideation…</div>;
    }

    return (
        <div className="grid gap-6 lg:grid-cols-[3fr,2fr]">
            <div className="space-y-4">
                <div className="bg-white border rounded p-4">
                    <h2 className="text-lg font-semibold">Ideation</h2>
                    <p className="text-sm text-gray-600 mt-1">
                        Ask for concept directions. The assistant streams its answer and saves extracted concept cards on
                        the right.
                    </p>
                </div>

                <AgentChatThread
                    threadId={threadId}
                    placeholder="Describe the event, vibe, constraints…"
                    onSend={async (content) => {
                        await runIdeation({ threadId, userContent: content });
                    }}
                />
            </div>

            <div className="space-y-4">
                <div className="bg-white border rounded p-4 flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Concept cards</h3>
                        <div className="text-xs text-gray-500 mt-1">{cardsByThread.length} saved</div>
                    </div>
                    <button
                        type="button"
                        onClick={async () => {
                            if (!confirm("Clear all ideation concept cards for this project?")) return;
                            await clearCards({ projectId });
                        }}
                        className="text-sm text-gray-600 hover:text-gray-900"
                        disabled={!conceptCards || conceptCards.length === 0}
                    >
                        Clear
                    </button>
                </div>

                <div className="space-y-3">
                    {conceptCards === undefined ? (
                        <div className="text-sm text-gray-500">Loading…</div>
                    ) : cardsByThread.length === 0 ? (
                        <div className="bg-white border rounded p-4 text-sm text-gray-500">
                            No concept cards yet. Send a message to generate 3 concepts.
                        </div>
                    ) : (
                        cardsByThread.map((card) => (
                            <div key={card._id} className="bg-white border rounded p-4 shadow-sm">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <h4 className="font-semibold text-gray-900">{card.title}</h4>
                                        <p className="text-sm text-gray-600 mt-1">{card.oneLiner}</p>
                                    </div>
                                    <div className="text-xs text-gray-400 whitespace-nowrap">
                                        {new Date(card.createdAt).toLocaleDateString()}
                                    </div>
                                </div>
                                <div className="prose prose-sm max-w-none mt-3">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{card.detailsMarkdown}</ReactMarkdown>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

