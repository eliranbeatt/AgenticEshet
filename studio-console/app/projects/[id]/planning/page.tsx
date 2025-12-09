"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export default function PlanningPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    
    const plans = useQuery(api.projects.getPlans, { projectId });
    const runPlanning = useAction(api.agents.planning.run);
    
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    
    // We display the latest plan (either from DB or just generated)
    const latestPlan = plans?.[0];

    const handleGenerate = async () => {
        if (!input.trim()) return;
        setIsLoading(true);
        try {
            await runPlanning({
                projectId,
                userRequest: input,
            });
            setInput("");
            // The query 'plans' will auto-update via Convex reactivity
        } catch (err) {
            console.error(err);
            alert("Failed to generate plan");
        } finally {
            setIsLoading(false);
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
                        {/* Simple instruction history or tips could go here */}
                        <p className="text-xs text-gray-500 italic">
                            Try: "Create a 3-phase plan for a video shoot" or "Add a risk assessment section"
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

                <div className="bg-white p-4 rounded shadow-sm border">
                    <h3 className="font-bold text-sm mb-2">Version History</h3>
                    <ul className="text-sm space-y-2 max-h-40 overflow-y-auto">
                        {plans?.map((p) => (
                            <li key={p._id} className="flex justify-between text-gray-600">
                                <span>v{p.version}</span>
                                <span className="text-xs text-gray-400">{new Date(p.createdAt).toLocaleTimeString()}</span>
                            </li>
                        ))}
                        {(!plans || plans.length === 0) && <li className="text-gray-400 italic">No plans yet</li>}
                    </ul>
                </div>
            </div>

            {/* Right: Plan Preview */}
            <div className="flex-1 bg-white rounded shadow-sm border flex flex-col">
                <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                    <h2 className="font-bold text-gray-800">
                        Current Plan {latestPlan ? `(v${latestPlan.version})` : ""}
                    </h2>
                    {latestPlan && (
                        <span className="text-xs uppercase px-2 py-1 bg-yellow-100 text-yellow-800 rounded">
                            {latestPlan.isDraft ? "Draft" : "Active"}
                        </span>
                    )}
                </div>
                
                <div className="flex-1 overflow-y-auto p-8 prose prose-sm max-w-none">
                    {latestPlan ? (
                        <div>
                            {latestPlan.reasoning && (
                                <div className="mb-6 bg-blue-50 p-4 rounded border border-blue-100 text-blue-900 text-sm italic">
                                    <strong>Agent Reasoning:</strong> {latestPlan.reasoning}
                                </div>
                            )}
                            <div className="whitespace-pre-wrap font-sans text-gray-800">
                                {latestPlan.contentMarkdown}
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
