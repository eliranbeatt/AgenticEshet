"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id, type Doc } from "@/convex/_generated/dataModel";
import { useParams } from "next/navigation";
import { useState } from "react";

export default function ProjectInboxPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    
    // Switch to ChangeSets
    const changeSets = useQuery(api.changeSets.listByProject, { 
        projectId, 
        status: "pending" 
    });

    const [selectedId, setSelectedId] = useState<Id<"itemChangeSets"> | null>(null);

    return (
        <div className="flex h-full">
            {/* List View */}
            <div className="w-1/3 border-r border-gray-200 overflow-y-auto bg-gray-50">
                <div className="p-4 border-b border-gray-200 bg-white">
                    <h2 className="text-lg font-semibold">Inbox (Pending Changes)</h2>
                </div>
                <div className="divide-y divide-gray-200">
                    {changeSets?.map((cs) => (
                        <div 
                            key={cs._id} 
                            onClick={() => setSelectedId(cs._id)}
                            className={`p-4 cursor-pointer hover:bg-white transition-colors ${selectedId === cs._id ? 'bg-white border-l-4 border-blue-500 shadow-sm' : ''}`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <span className="font-bold text-gray-700">{cs.agentName}</span>
                                <span className="text-xs text-gray-400">{new Date(cs.createdAt).toLocaleDateString()}</span>
                            </div>
                            <div className="text-sm font-medium text-gray-900 mb-1">{cs.title || "(No Title)"}</div>
                            
                            {/* Counts badges */}
                            <div className="flex gap-2 flex-wrap mt-2">
                                {cs.counts?.items ? <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">+{cs.counts.items} Items</span> : null}
                                {cs.counts?.tasks ? <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">+{cs.counts.tasks} Tasks</span> : null}
                            </div>
                        </div>
                    ))}
                    {changeSets?.length === 0 && (
                        <div className="p-8 text-center text-gray-500">No pending changes.</div>
                    )}
                </div>
            </div>

            {/* Detail View */}
            <div className="w-2/3 overflow-y-auto p-6 bg-white">
                {selectedId ? (
                    <ChangeSetDetail changeSetId={selectedId} />
                ) : (
                    <div className="h-full flex items-center justify-center text-gray-400 flex-col gap-2">
                        <span className="text-4xl">📨</span>
                        <span>Select a ChangeSet to review</span>
                    </div>
                )}
            </div>
        </div>
    );
}

function ChangeSetDetail({ changeSetId }: { changeSetId: Id<"itemChangeSets"> }) {
    const data = useQuery(api.changeSets.getWithOps, { changeSetId });
    const applyMutation = useMutation(api.changeSets.apply);
    const rejectMutation = useMutation(api.changeSets.reject);
    const [processing, setProcessing] = useState(false);

    if (!data) return <div className="p-4 text-gray-500">Loading details...</div>;

    const { changeSet, ops } = data;

    const handleApply = async () => {
        if (!confirm("Apply these changes to the project?")) return;
        setProcessing(true);
        try {
            await applyMutation({ changeSetId, decidedBy: "user" });
        } catch (e) {
            alert("Error applying: " + e);
        } finally {
            setProcessing(false);
        }
    };

    const handleReject = async () => {
        if (!confirm("Reject these changes?")) return;
        setProcessing(true);
        try {
            await rejectMutation({ changeSetId, decidedBy: "user" });
        } catch (e) {
            alert("Error rejecting: " + e);
        } finally {
            setProcessing(false);
        }
    };

    // Group ops by type for display
    const createdItems = ops.filter(o => o.entityType === "item" && o.opType === "create");
    const createdTasks = ops.filter(o => o.entityType === "task" && o.opType === "create");
    const createdMaterials = ops.filter(o => o.entityType === "materialLine" && o.opType === "create");

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="border-b pb-4">
                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">{changeSet.title}</h1>
                        <div className="text-sm text-gray-500 mt-1">
                            Proposed by <span className="font-medium text-gray-700">{changeSet.agentName}</span> • {new Date(changeSet.createdAt).toLocaleString()}
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button 
                            onClick={handleReject}
                            disabled={processing}
                            className="px-4 py-2 bg-white border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
                        >
                            Reject
                        </button>
                        <button 
                            onClick={handleApply}
                            disabled={processing}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 shadow-sm disabled:opacity-50"
                        >
                            {processing ? "Applying..." : "Apply Changes"}
                        </button>
                    </div>
                </div>

                {/* Warnings / Assumptions */}
                {(changeSet.warnings?.length || changeSet.assumptions?.length) && (
                    <div className="mt-4 space-y-2">
                        {changeSet.warnings?.map((w, i) => (
                            <div key={i} className="bg-yellow-50 text-yellow-800 px-3 py-2 rounded text-sm border border-yellow-200 flex gap-2">
                                ⚠️ {w}
                            </div>
                        ))}
                        {changeSet.assumptions?.map((a, i) => (
                            <div key={i} className="bg-blue-50 text-blue-800 px-3 py-2 rounded text-sm border border-blue-100 flex gap-2">
                                ℹ️ Assumption: {a}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Content Preview */}
            <div className="space-y-6">
                
                {/* Items */}
                {createdItems.length > 0 && (
                    <section>
                        <h3 className="font-bold text-gray-700 mb-3 border-b border-gray-100 pb-1">Items to Create ({createdItems.length})</h3>
                        <div className="grid gap-3">
                            {createdItems.map(op => {
                                const payload = JSON.parse(op.payloadJson);
                                return (
                                    <div key={op._id} className="border rounded p-3 bg-white shadow-sm border-l-4 border-l-purple-400">
                                        <div className="font-semibold text-gray-900">{payload.name}</div>
                                        <div className="text-sm text-gray-600 flex gap-3 mt-1">
                                            <span className="bg-gray-100 px-2 rounded text-xs py-0.5 capitalize">{payload.kind}</span>
                                            <span className="bg-gray-100 px-2 rounded text-xs py-0.5">{payload.category}</span>
                                        </div>
                                        {payload.description && <div className="text-sm text-gray-500 mt-2">{payload.description}</div>}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* Tasks */}
                {createdTasks.length > 0 && (
                    <section>
                        <h3 className="font-bold text-gray-700 mb-3 border-b border-gray-100 pb-1">Tasks to Create ({createdTasks.length})</h3>
                        <div className="grid gap-3">
                            {createdTasks.map(op => {
                                const payload = JSON.parse(op.payloadJson);
                                return (
                                    <div key={op._id} className="border rounded p-3 bg-white shadow-sm border-l-4 border-l-green-400">
                                        <div className="font-semibold text-gray-900">{payload.title}</div>
                                        <div className="text-sm text-gray-600 mt-1 flex gap-4">
                                            <span>Role: <b>{payload.role || "Unassigned"}</b></span>
                                            <span>Effort: <b>{payload.durationHours ? (payload.durationHours/8).toFixed(2) : payload.effortDays} days</b></span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* Materials */}
                {createdMaterials.length > 0 && (
                    <section>
                        <h3 className="font-bold text-gray-700 mb-3 border-b border-gray-100 pb-1">Materials ({createdMaterials.length})</h3>
                        <div className="grid gap-2">
                            {createdMaterials.map(op => {
                                const payload = JSON.parse(op.payloadJson);
                                return (
                                    <div key={op._id} className="border-b border-dashed py-2 flex justify-between items-center last:border-0">
                                        <div className="flex-1">
                                            <div className="font-medium text-sm text-gray-900">{payload.label}</div>
                                            <div className="text-xs text-gray-500">{payload.category}</div>
                                        </div>
                                        <div className="text-sm font-mono bg-gray-50 px-2 py-1 rounded">
                                            {payload.plannedQuantity} {payload.unit}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

            </div>
        </div>
    );
}