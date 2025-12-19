"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useThinkingMode } from "../../../ThinkingModeContext";
import { AgentChatThread } from "../_components/chat/AgentChatThread";

export default function ClarificationPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    const { thinkingMode } = useThinkingMode();

    const ensureThread = useMutation(api.chat.ensureDefaultThread);
    const runClarification = useAction(api.agents.clarificationV2.send);
    const runPlanning = useAction(api.agents.planning.run);
    const setPlanActive = useMutation(api.projects.setPlanActive);

    const planMeta = useQuery(api.projects.getPlanPhaseMeta, { projectId });
    const plans = useQuery(api.projects.getPlans, { projectId });

    const clarificationDoc = useQuery(api.clarificationDocs.getLatest, { projectId });
    const saveClarificationDoc = useMutation(api.clarificationDocs.save);

    const [threadId, setThreadId] = useState<Id<"chatThreads"> | null>(null);
    const [clarificationMarkdown, setClarificationMarkdown] = useState("");
    const [isSavingDoc, setIsSavingDoc] = useState(false);

    useEffect(() => {
        if (threadId) return;
        void (async () => {
            const result = await ensureThread({ projectId, phase: "clarification", title: "Clarification" });
            setThreadId(result.threadId);
        })();
    }, [ensureThread, projectId, threadId]);

    useEffect(() => {
        if (clarificationDoc === undefined) return;
        setClarificationMarkdown(clarificationDoc?.contentMarkdown ?? "");
    }, [clarificationDoc]);

    const activePlan = useMemo<Doc<"plans"> | null>(
        () => plans?.find((plan: Doc<"plans">) => plan.isActive) ?? null,
        [plans],
    );

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

            <div className="grid gap-6 lg:grid-cols-[3fr,2fr]">
                <div className="space-y-6">
                    {threadId ? (
                        <AgentChatThread
                            threadId={threadId}
                            placeholder="Tell me what you know so far…"
                            onSend={async (content) => {
                                await runClarification({ threadId, userContent: content, thinkingMode });
                            }}
                        />
                    ) : (
                        <div className="bg-white rounded shadow-sm border p-4 text-sm text-gray-500">
                            Loading chat…
                        </div>
                    )}
                </div>

                <div className="space-y-6">
                    <PlanSidebar
                        plans={plans}
                        activePlan={activePlan}
                        onApprove={async (planId) => {
                            await setPlanActive({ projectId, planId });
                        }}
                        onGenerate={async () => {
                            const userRequest =
                                prompt("What should the planning agent do?", "Create or update the project plan.") ??
                                "";
                            if (!userRequest.trim()) return;
                            await runPlanning({ projectId, userRequest: userRequest.trim(), thinkingMode });
                        }}
                    />

                    <div className="bg-white rounded shadow-sm border">
                        <div className="flex justify-between items-center p-4 border-b">
                            <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                                Clarification document
                            </h3>
                            <button
                                type="button"
                                onClick={handleSaveDoc}
                                disabled={isSavingDoc}
                                className="text-sm text-blue-700 hover:text-blue-900 disabled:opacity-50"
                            >
                                {isSavingDoc ? "Saving…" : "Save"}
                            </button>
                        </div>
                        <div className="p-4">
                            <textarea
                                className="w-full h-[360px] border rounded p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder={`# Clarifications\n\n## Goals\n- ...\n\n## Scope\n- In scope: ...\n- Out of scope: ...\n\n## Assumptions\n- ...\n\n## Open questions\n- ...\n`}
                                value={clarificationMarkdown}
                                onChange={(e) => setClarificationMarkdown(e.target.value)}
                            />
                        </div>
                    </div>
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
                Clarification {projectReady ? "captured" : "pending"}
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">
                {activePlanLabel}
            </span>
        </div>
    );
}

function ActivePlanCard({ plan }: { plan: Doc<"plans"> | null }) {
    if (!plan) {
        return (
            <div className="bg-white rounded shadow-sm border p-4 text-sm text-gray-500">
                <p>No approved plan yet. Generate one and set it active.</p>
            </div>
        );
    }
    return (
        <div className="bg-white rounded shadow-sm border p-4 space-y-2">
            <div className="flex justify-between items-center">
                <div>
                    <h3 className="text-sm font-bold text-gray-800">Active Plan v{plan.version}</h3>
                    <p className="text-xs text-gray-500">Approved {new Date(plan.createdAt).toLocaleString()}</p>
                </div>
                <span className="text-xs uppercase bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Active</span>
            </div>
            {plan.reasoning && (
                <p className="text-xs text-blue-800 bg-blue-50 border border-blue-100 rounded p-2">{plan.reasoning}</p>
            )}
            <div className="prose prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan.contentMarkdown}</ReactMarkdown>
            </div>
        </div>
    );
}

function PlanSidebar({
    plans,
    activePlan,
    onApprove,
    onGenerate,
}: {
    plans: Doc<"plans">[] | undefined;
    activePlan: Doc<"plans"> | null;
    onApprove: (planId: Id<"plans">) => Promise<void>;
    onGenerate: () => Promise<void>;
}) {
    const sorted = useMemo(() => {
        if (!plans) return [];
        return [...plans].sort((a, b) => b.version - a.version);
    }, [plans]);

    return (
        <div className="bg-white rounded shadow-sm border">
            <div className="flex items-center justify-between p-4 border-b">
                <div>
                    <h3 className="text-sm font-semibold text-gray-600 uppercase">Plan sidebar</h3>
                    <div className="text-xs text-gray-500 mt-1">
                        {activePlan ? `Active v${activePlan.version}` : "No active plan"}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => void onGenerate()}
                    className="bg-blue-600 text-white px-3 py-2 rounded text-sm font-medium hover:bg-blue-700"
                >
                    Generate plan
                </button>
            </div>

            <div className="p-4 space-y-4">
                <ActivePlanCard plan={activePlan} />

                <div>
                    <div className="text-xs font-semibold text-gray-600 uppercase mb-2">All plan versions</div>
                    {plans === undefined ? (
                        <div className="text-sm text-gray-500">Loading…</div>
                    ) : sorted.length === 0 ? (
                        <div className="text-sm text-gray-500">No planning drafts yet.</div>
                    ) : (
                        <div className="space-y-2 max-h-56 overflow-y-auto">
                            {sorted.map((plan) => (
                                <div key={plan._id} className="border rounded p-3">
                                    <div className="flex items-center justify-between">
                                        <div className="text-sm font-medium">
                                            v{plan.version}{" "}
                                            {plan.isActive ? (
                                                <span className="text-xs text-green-700">(active)</span>
                                            ) : plan.isDraft ? (
                                                <span className="text-xs text-amber-700">(draft)</span>
                                            ) : (
                                                <span className="text-xs text-gray-500">(ready)</span>
                                            )}
                                        </div>
                                        {!plan.isActive && (
                                            <button
                                                type="button"
                                                onClick={() => void onApprove(plan._id)}
                                                className="text-sm text-blue-700 hover:underline"
                                            >
                                                Set active
                                            </button>
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-1">
                                        {new Date(plan.createdAt).toLocaleString()}
                                    </div>
                                    <div className="prose prose-sm max-w-none mt-2 text-gray-800">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {plan.contentMarkdown.slice(0, 600)}
                                        </ReactMarkdown>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="text-xs text-gray-400">Planning history stays in the Planning tab.</div>
            </div>
        </div>
    );
}

