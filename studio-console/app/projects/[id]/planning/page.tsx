"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export default function PlanningPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    
    const plans = useQuery(api.projects.getPlans, { projectId });
    const runPlanning = useAction(api.agents.planning.run);
    const setPlanActive = useMutation(api.projects.setPlanActive);
    
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [selection, setSelection] = useState<Id<"plans"> | null>(null);
    const [approvingPlanId, setApprovingPlanId] = useState<Id<"plans"> | null>(null);
    
    const selectedPlan = useMemo(() => {
        if (!plans || plans.length === 0) return null;
        if (!selection) return plans[0];
        return plans.find((plan) => plan._id === selection) ?? plans[0];
    }, [plans, selection]);

    const activePlan = useMemo(() => plans?.find((plan) => plan.isActive) ?? null, [plans]);

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

    return (
        <div className="flex h-[calc(100vh-12rem)] gap-6">
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

                <div className="bg-white p-4 rounded shadow-sm border flex flex-col">
                    <h3 className="font-bold text-sm mb-3">Version History</h3>
                    <div className="text-xs text-gray-500 mb-2 flex justify-between">
                        <span>{plans?.length || 0} versions</span>
                        {activePlan ? <span>Active: v{activePlan.version}</span> : <span>No active plan</span>}
                    </div>
                    <ul className="text-sm space-y-2 max-h-60 overflow-y-auto">
                        {plans?.map((plan) => (
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
                            <div className="whitespace-pre-wrap font-sans text-gray-800">
                                {selectedPlan.contentMarkdown}
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-400">
                            No plan generated yet.
                        </div>
                    )}
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
