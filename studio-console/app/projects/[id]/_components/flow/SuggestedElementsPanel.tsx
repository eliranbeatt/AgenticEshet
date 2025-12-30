"use client";

import { useMemo, useState } from "react";
import { useAction, useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Props = {
    projectId: Id<"projects">;
    selectedAllProject: boolean;
    selectedItemIds: Array<Id<"projectItems">>;
    phase: "planning" | "solutioning" | "accounting" | "tasks" | "item_edit" | "convert" | "element_edit" | "procurement" | "runbook" | "closeout";
    onGenerated?: () => void;
};

type Strategy = {
    key: string;
    label: string;
    description: string;
};

const STRATEGIES: Strategy[] = [
    { key: "ideation", label: "Ideation", description: "New elements or scope expansion ideas." },
    { key: "planning", label: "Planning", description: "Execution steps, dependencies, and sequencing." },
    { key: "solutioning", label: "Solutioning", description: "Production methods, materials, and tools." },
    { key: "critique", label: "Critique", description: "Quality risks and missing details." },
    { key: "stress_test", label: "Stress Test", description: "Check feasibility, schedule, and budget pressure." },
    { key: "risk_scan", label: "Risk Scan", description: "Operational and delivery risks to flag." },
    { key: "improve", label: "Improve", description: "Optimize for cost, speed, or clarity." },
    { key: "dependencies", label: "Dependencies", description: "Find missing dependencies or blockers." },
];

export function SuggestedElementsPanel({ projectId, selectedAllProject, selectedItemIds, phase, onGenerated }: Props) {
    const project = useQuery(api.projects.getProject, { projectId });
    const sidebar = useQuery(api.items.listTreeSidebar, {
        projectId,
        includeDrafts: true,
    });

    // For canonical flow
    const suggestionDrafts = useQuery(
        api.revisions.listSuggestionDrafts,
        project?.features?.elementsCanonical ? { projectId } : "skip"
    );
    const approveRevision = useMutation(api.revisions.approve);
    const discardRevision = useMutation(api.revisions.discard);

    const generateBatch = useAction(api.agents.suggestions.generateBatch);
    const [isRunning, setIsRunning] = useState<string | null>(null);
    const [userInstructions, setUserInstructions] = useState("");
    const [previewDraftId, setPreviewDraftId] = useState<Id<"revisions"> | null>(null);

    const allItems = useMemo(() => sidebar?.items ?? [], [sidebar?.items]);
    const scopeItemIds = useMemo(() => {
        if (selectedAllProject) return allItems.map((item) => item._id);
        return selectedItemIds;
    }, [allItems, selectedAllProject, selectedItemIds]);

    const scopeLabel = selectedAllProject
        ? `All elements (${scopeItemIds.length})`
        : `Selected (${scopeItemIds.length})`;

    const canRun = scopeItemIds.length > 0 && !isRunning;

    const previewElementIds = useMemo(() => {
        if (!previewDraftId || !suggestionDrafts) return [];
        const draft = suggestionDrafts.find((entry) => entry._id === previewDraftId);
        return draft?.changes.map((change) => change.elementId) ?? [];
    }, [previewDraftId, suggestionDrafts]);

    const previewSnapshots = useQuery(
        api.revisions.previewSnapshots,
        previewDraftId && previewElementIds.length > 0
            ? { revisionId: previewDraftId, elementIds: previewElementIds }
            : "skip"
    ) as Array<{
        elementId: Id<"projectItems">;
        counts?: { base: { tasks: number; materials: number; labor: number }; next: { tasks: number; materials: number; labor: number } };
    }> | undefined;

    const previewCountsByElement = useMemo(() => {
        const map = new Map<string, { base: { tasks: number; materials: number; labor: number }; next: { tasks: number; materials: number; labor: number } }>();
        (previewSnapshots ?? []).forEach((entry) => {
            if (entry.counts) {
                map.set(String(entry.elementId), entry.counts);
            }
        });
        return map;
    }, [previewSnapshots]);

    const handleRun = async (strategy: Strategy) => {
        if (!canRun) return;
        setIsRunning(strategy.key);
        try {
            await generateBatch({
                projectId,
                itemIds: scopeItemIds,
                strategy: strategy.key,
                phase,
                userInstructions: userInstructions.trim() || undefined,
            });
            alert("Suggestions queued.");
            onGenerated?.();
        } catch (error) {
            alert("Failed to generate suggestions: " + error);
        } finally {
            setIsRunning(null);
        }
    };

    const handleApprove = async (revisionId: Id<"revisions">) => {
        try {
            await approveRevision({ revisionId });
        } catch (error) {
            alert("Failed to approve: " + error);
        }
    };

    const handleDiscard = async (revisionId: Id<"revisions">) => {
        try {
            await discardRevision({ revisionId });
        } catch (error) {
            alert("Failed to discard: " + error);
        }
    };

    const elementsCanonical = project?.features?.elementsCanonical;

    return (
        <div className="bg-white border rounded-lg shadow-sm p-3 space-y-3">
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Suggested Elements</div>
                    <div className="text-xs text-gray-500 mt-1">Scope: {scopeLabel}</div>
                </div>
            </div>

            <textarea
                className="w-full border rounded px-2 py-1 text-xs"
                placeholder="Optional: extra instructions (e.g., prioritize budget, avoid vendors, keep minimal)."
                value={userInstructions}
                onChange={(event) => setUserInstructions(event.target.value)}
                rows={2}
            />

            <div className="grid gap-2">
                {STRATEGIES.map((strategy) => (
                    <button
                        key={strategy.key}
                        type="button"
                        className="text-left text-xs border rounded px-2 py-2 hover:bg-gray-50 disabled:opacity-50"
                        onClick={() => void handleRun(strategy)}
                        disabled={!canRun}
                    >
                        <div className="font-semibold text-gray-800">
                            {isRunning === strategy.key ? "Running..." : strategy.label}
                        </div>
                        <div className="text-[11px] text-gray-500">{strategy.description}</div>
                    </button>
                ))}
            </div>

            {!canRun && scopeItemIds.length === 0 && (
                <div className="text-xs text-gray-400">Select elements to enable suggestions.</div>
            )}

            {elementsCanonical && suggestionDrafts && suggestionDrafts.length > 0 && (
                <div className="mt-4 pt-4 border-t">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Pending Suggestions</h4>
                    <div className="space-y-2">
                        {suggestionDrafts.map((draft) => (
                            <div key={draft._id} className="border rounded p-2 bg-blue-50">
                                <div className="text-xs font-bold text-gray-800 mb-1">{draft.summary}</div>
                                <div className="text-[10px] text-gray-500 mb-2">
                                    {new Date(draft.createdAt).toLocaleTimeString()} - {draft.actionType}
                                </div>
                                <div className="space-y-1 mb-2">
                                    {draft.changes.map((change) => (
                                        <div key={change._id} className="text-[10px] text-gray-600">
                                            <span className="font-semibold">{change.changeType === "create" ? "New" : "Update"}:</span>{" "}
                                            {change.elementTitle} · {change.mode === "snapshot" ? "Snapshot" : `Patch ops (${change.patchOpsCount})`}
                                            {change.replaceMask.length > 0 && (
                                                <span> · {change.replaceMask.join(", ")}</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                {previewDraftId === draft._id && previewCountsByElement.size > 0 && (
                                    <div className="text-[10px] text-gray-500 mb-2">
                                        {draft.changes.map((change) => {
                                            const counts = previewCountsByElement.get(String(change.elementId));
                                            if (!counts) return null;
                                            return (
                                                <div key={`preview:${change._id}`}>
                                                    {change.elementTitle}: tasks {counts.base.tasks}&rarr;{counts.next.tasks}, materials {counts.base.materials}&rarr;{counts.next.materials}, labor {counts.base.labor}&rarr;{counts.next.labor}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleApprove(draft._id)}
                                        className="text-xs bg-green-600 text-white px-2 py-1 rounded"
                                    >
                                        Approve
                                    </button>
                                    <button
                                        onClick={() => setPreviewDraftId(previewDraftId === draft._id ? null : draft._id)}
                                        className="text-xs bg-white border border-blue-200 text-blue-700 px-2 py-1 rounded"
                                    >
                                        {previewDraftId === draft._id ? "Hide preview" : "Preview"}
                                    </button>
                                    <button
                                        onClick={() => handleDiscard(draft._id)}
                                        className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded"
                                    >
                                        Discard
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
