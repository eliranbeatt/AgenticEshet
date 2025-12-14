"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";

export default function PlanningPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    
    const planMeta = useQuery(api.projects.getPlanPhaseMeta, { projectId });
    const plans = useQuery(api.projects.getPlans, { projectId });
    const transcript = useQuery(api.conversations.recentByPhase, { projectId, phase: "planning", limit: 10 });
    const clarificationDoc = useQuery(api.clarificationDocs.getLatest, { projectId });
    const runPlanning = useAction(api.agents.planning.run);
    const setPlanActive = useMutation(api.projects.setPlanActive);
    const updateDraftMarkdown = useMutation(api.costPlanDocs.updateDraftMarkdown);
    
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [selection, setSelection] = useState<Id<"plans"> | null>(null);
    const [approvingPlanId, setApprovingPlanId] = useState<Id<"plans"> | null>(null);
    const [isEditingMarkdown, setIsEditingMarkdown] = useState(false);
    const [markdownDraft, setMarkdownDraft] = useState("");
    const [isSavingMarkdown, setIsSavingMarkdown] = useState(false);
    
    const activePlan = useMemo<Doc<"plans"> | null>(
        () => plans?.find((plan: Doc<"plans">) => plan.isActive) ?? null,
        [plans],
    );

    const selectedPlan = useMemo(() => {
        if (!plans || plans.length === 0) return null;
        if (!selection) return activePlan ?? plans[0];
        return plans.find((plan: Doc<"plans">) => plan._id === selection) ?? (activePlan ?? plans[0]);
    }, [plans, selection, activePlan]);

    useEffect(() => {
        if (!selectedPlan) return;
        setMarkdownDraft(selectedPlan.contentMarkdown ?? "");
        setIsEditingMarkdown(false);
    }, [selectedPlan]);

    const handleGenerate = async () => {
        if (!input.trim()) return;
        setIsLoading(true);
        try {
            await runPlanning({
                projectId,
                userRequest: input,
            });
            setInput("");
        } catch (err) {
            console.error(err);
            alert("Failed to generate plan");
        } finally {
            setIsLoading(false);
        }
    };

    const handleApprove = async (planId: Id<"plans">) => {
        setApprovingPlanId(planId);
        try {
            await setPlanActive({ projectId, planId });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to update plan status";
            alert(message);
        } finally {
            setApprovingPlanId(null);
        }
    };

    const handleSaveMarkdown = async () => {
        if (!selectedPlan) return;
        setIsSavingMarkdown(true);
        try {
            await updateDraftMarkdown({ planId: selectedPlan._id, contentMarkdown: markdownDraft });
            setIsEditingMarkdown(false);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to save plan markdown";
            alert(message);
        } finally {
            setIsSavingMarkdown(false);
        }
    };

    return (
        <div className="space-y-6">
            <PhaseBadges
                clarificationReady={Boolean(clarificationDoc?.contentMarkdown?.trim())}
                planningLabel={
                    activePlan
                        ? `Active plan v${activePlan.version}`
                        : planMeta?.latestPlan
                            ? planMeta.latestPlan.isDraft
                                ? "Draft pending approval"
                                : `Latest plan v${planMeta.latestPlan.version}`
                            : "No plan yet"
                }
            />
            <div className="flex h-[calc(100vh-14rem)] gap-6">
                {/* Left: Controls */}
                <div className="w-1/3 flex flex-col space-y-4">
                <div className="bg-white p-4 rounded shadow-sm border flex-1 flex flex-col">
                    <h2 className="text-lg font-bold mb-4">Planning Agent</h2>
                    <p className="text-sm text-gray-600 mb-4">
                        Describe the scope or ask for changes to the plan.
                    </p>
                    
                    <div className="flex-1 overflow-y-auto mb-4 bg-gray-50 p-3 rounded border">
                        <p className="text-xs text-gray-500 italic">
                            Try: &ldquo;Create a 3-phase plan for a video shoot&rdquo; or &ldquo;Add a risk assessment section&rdquo;
                        </p>
                    </div>

                    <div className="space-y-2">
                        <textarea
                            className="w-full border rounded p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            rows={4}
                            placeholder="Instructions for the planner..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                        />
                        <button
                            onClick={handleGenerate}
                            disabled={isLoading}
                            className="w-full bg-blue-600 text-white px-4 py-2 rounded font-medium disabled:opacity-50 hover:bg-blue-700"
                        >
                            {isLoading ? "Generating Plan..." : "Generate / Update Plan"}
                        </button>
                    </div>
                </div>

                <ActivePlanCallout plan={activePlan} />

                <div className="bg-white p-4 rounded shadow-sm border flex flex-col">
                    <h3 className="font-bold text-sm mb-3">Version History</h3>
                    <div className="text-xs text-gray-500 mb-2 flex justify-between">
                        <span>{plans?.length || 0} versions</span>
                        {activePlan ? <span>Active: v{activePlan.version}</span> : <span>No active plan</span>}
                    </div>
                    <ul className="text-sm space-y-2 max-h-60 overflow-y-auto">
                        {plans?.map((plan: Doc<"plans">) => (
                            <li
                                key={plan._id}
                                className={`border rounded px-3 py-2 cursor-pointer transition ${selectedPlan?._id === plan._id ? "border-blue-500 bg-blue-50" : "hover:bg-gray-50"}`}
                                onClick={() => setSelection(plan._id)}
                            >
                                <div className="flex justify-between items-center">
                                    <span className="font-semibold text-gray-700">v{plan.version}</span>
                                    <span className="text-xs text-gray-400">{new Date(plan.createdAt).toLocaleString()}</span>
                                </div>
                                <div className="flex gap-2 mt-1 text-xs">
                                    <PlanStatusBadge label={plan.isActive ? "Active" : plan.isDraft ? "Draft" : "Archived"} tone={plan.isActive ? "green" : plan.isDraft ? "amber" : "gray"} />
                                    <PlanStatusBadge label={plan.phase} tone="blue" />
                                </div>
                            </li>
                        ))}
                        {(!plans || plans.length === 0) && <li className="text-gray-400 italic">No plans yet</li>}
                    </ul>
                </div>

                <TranscriptPanel conversations={transcript || []} />
            </div>

            {/* Right: Plan Preview */}
                <div className="flex-1 bg-white rounded shadow-sm border flex flex-col">
                <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                    <div>
                        <h2 className="font-bold text-gray-800">
                            {selectedPlan ? `Plan v${selectedPlan.version}` : "No plan selected"}
                        </h2>
                        {selectedPlan && (
                            <div className="flex gap-2 mt-1 text-xs">
                                <PlanStatusBadge label={selectedPlan.isActive ? "Active" : selectedPlan.isDraft ? "Draft" : "Archived"} tone={selectedPlan.isActive ? "green" : selectedPlan.isDraft ? "amber" : "gray"} />
                                <span className="text-gray-500">Generated {new Date(selectedPlan.createdAt).toLocaleString()}</span>
                            </div>
                        )}
                    </div>
                    {selectedPlan && (
                        <div className="flex gap-2">
                            {!selectedPlan.isActive && (
                                <button
                                    onClick={() => handleApprove(selectedPlan._id)}
                                    disabled={approvingPlanId === selectedPlan._id}
                                    className="bg-green-600 text-white px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
                                >
                                    {selectedPlan.isDraft ? "Approve Plan" : "Set Active"}
                                </button>
                            )}
                            {selectedPlan.isActive && (
                                <span className="text-xs text-green-600 font-semibold uppercase">Active Plan</span>
                            )}
                        </div>
                    )}
                </div>
                
                <div className="flex-1 overflow-y-auto p-8 prose prose-sm max-w-none">
                    {selectedPlan ? (
                        <div>
                            {selectedPlan.reasoning && (
                                <div className="mb-6 bg-blue-50 p-4 rounded border border-blue-100 text-blue-900 text-sm italic">
                                    <strong>Agent Reasoning:</strong> {selectedPlan.reasoning}
                                </div>
                            )}
                            {selectedPlan.isDraft ? (
                                <div className="space-y-3">
                                    <div className="flex gap-2">
                                        {!isEditingMarkdown ? (
                                            <button
                                                onClick={() => setIsEditingMarkdown(true)}
                                                className="border border-gray-300 bg-white text-gray-800 px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-100"
                                            >
                                                Edit Markdown
                                            </button>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={handleSaveMarkdown}
                                                    disabled={isSavingMarkdown}
                                                    className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
                                                >
                                                    {isSavingMarkdown ? "Saving..." : "Save"}
                                                </button>
                                                <button
                                                    onClick={() => setIsEditingMarkdown(false)}
                                                    className="border border-gray-300 bg-white text-gray-800 px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-100"
                                                >
                                                    Cancel
                                                </button>
                                            </>
                                        )}
                                    </div>
                                    {isEditingMarkdown ? (
                                        <textarea
                                            className="w-full min-h-[520px] border rounded p-3 text-sm font-mono"
                                            value={markdownDraft}
                                            onChange={(e) => setMarkdownDraft(e.target.value)}
                                        />
                                    ) : (
                                        <div className="whitespace-pre-wrap font-sans text-gray-800">{selectedPlan.contentMarkdown}</div>
                                    )}
                                </div>
                            ) : (
                                <div className="whitespace-pre-wrap font-sans text-gray-800">{selectedPlan.contentMarkdown}</div>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-400">
                            No plan generated yet.
                        </div>
                    )}
                </div>
                </div>
            </div>
        </div>
    );
}

function PlanStatusBadge({ label, tone }: { label: string; tone: "green" | "amber" | "gray" | "blue" }) {
    const palette: Record<typeof tone, { bg: string; text: string }> = {
        green: { bg: "bg-green-100", text: "text-green-800" },
        amber: { bg: "bg-yellow-100", text: "text-yellow-800" },
        gray: { bg: "bg-gray-100", text: "text-gray-700" },
        blue: { bg: "bg-blue-100", text: "text-blue-700" },
    };
    const colors = palette[tone];
    return <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${colors.bg} ${colors.text}`}>{label}</span>;
}

function TranscriptPanel({ conversations }: { conversations: Doc<"conversations">[] }) {
    return (
        <div className="bg-white rounded shadow-sm border p-4 flex flex-col flex-1">
            <h3 className="text-sm font-semibold text-gray-600 uppercase mb-3">Planning transcript</h3>
            <div className="space-y-3 max-h-48 overflow-y-auto">
                {conversations.map((conversation) => {
                    const content = parseLatestAssistant(conversation.messagesJson);
                    return (
                        <div key={conversation._id} className="border rounded p-3 text-sm text-gray-700">
                            <div className="text-xs text-gray-500 flex justify-between mb-1">
                                <span>{new Date(conversation.createdAt).toLocaleString()}</span>
                                <span className="capitalize">{conversation.agentRole.replace("_", " ")}</span>
                            </div>
                            <p className="line-clamp-3 whitespace-pre-line">{content || "No assistant output"}</p>
                        </div>
                    );
                })}
                {conversations.length === 0 && <p className="text-xs text-gray-400">No planning runs logged yet.</p>}
            </div>
        </div>
    );
}

function parseLatestAssistant(messagesJson: string) {
    try {
        const parsed = JSON.parse(messagesJson) as { role: string; content: string }[];
        return [...parsed].reverse().find((msg) => msg.role === "assistant")?.content ?? "";
    } catch {
        return "";
    }
}

function ActivePlanCallout({ plan }: { plan: Doc<"plans"> | null }) {
    if (!plan) {
        return (
            <div className="bg-white p-4 rounded shadow-sm border text-sm text-gray-500">
                Approve a plan to expose it here while prompting the planner.
            </div>
        );
    }
    return (
        <div className="bg-white p-4 rounded shadow-sm border space-y-2">
            <div className="flex justify-between items-center text-sm">
                <span className="font-semibold text-gray-800">Active Plan v{plan.version}</span>
                <PlanStatusBadge label="Active" tone="green" />
            </div>
            <p className="text-xs text-gray-500">Approved {new Date(plan.createdAt).toLocaleString()}</p>
            <p className="text-sm text-gray-700 line-clamp-4 whitespace-pre-line">{plan.contentMarkdown}</p>
        </div>
    );
}

function PhaseBadges({ clarificationReady, planningLabel }: { clarificationReady: boolean; planningLabel: string }) {
    return (
        <div className="flex flex-wrap gap-3 text-xs">
            <span className={`px-3 py-1 rounded-full font-semibold ${clarificationReady ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                Clarification {clarificationReady ? "captured" : "pending"}
            </span>
            <span className="px-3 py-1 rounded-full font-semibold bg-blue-50 text-blue-700">{planningLabel}</span>
        </div>
    );
}
