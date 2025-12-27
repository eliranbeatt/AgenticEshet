"use client";

import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function IdeasPanel({ projectId }: { projectId: Id<"projects"> }) {
    const cards = useQuery(api.ideation.listConceptCards, { projectId });
    const createSelection = useMutation(api.ideaSelections.createSelection);
    const createChangeSet = useAction(api.agents.convertIdeas.createChangeSet);

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [notes, setNotes] = useState("");
    const [status, setStatus] = useState<"idle" | "creating" | "done" | "error">("idle");

    const selectedCount = selectedIds.size;
    const selectedList = useMemo(() => Array.from(selectedIds), [selectedIds]);

    const toggleSelection = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const handleConvert = async () => {
        if (selectedCount === 0) return;
        setStatus("creating");
        try {
            const selectionId = await createSelection({
                projectId,
                conceptCardIds: selectedList as Array<Id<"ideationConceptCards">>,
                notes: notes.trim() || undefined,
            });
            await createChangeSet({ projectId, selectionId });
            setSelectedIds(new Set());
            setNotes("");
            setStatus("done");
        } catch (error) {
            console.error(error);
            setStatus("error");
        }
    };

    if (cards === undefined) {
        return <div className="text-xs text-gray-500 p-4">Loading ideas...</div>;
    }

    if (!cards || cards.length === 0) {
        return <div className="text-xs text-gray-500 p-4">No ideas generated yet.</div>;
    }

    return (
        <div className="flex flex-col h-full bg-white border-l">
            <div className="p-3 border-b bg-gray-50 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-700">Idea Selection</div>
                <textarea
                    className="w-full text-xs border rounded p-2"
                    rows={3}
                    placeholder="Optional notes about what to include or avoid."
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                />
                <div className="flex items-center justify-between">
                    <div className="text-[10px] text-gray-500">
                        Selected: {selectedCount}
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            className="text-[10px] px-2 py-1 rounded border bg-white hover:bg-gray-50"
                            onClick={() => setSelectedIds(new Set())}
                            disabled={selectedCount === 0}
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            className="text-[10px] px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                            onClick={handleConvert}
                            disabled={selectedCount === 0 || status === "creating"}
                        >
                            {status === "creating" ? "Converting..." : "Convert to elements"}
                        </button>
                    </div>
                </div>
                {status === "done" && (
                    <div className="text-[10px] text-green-700">ChangeSet created. Review to apply.</div>
                )}
                {status === "error" && (
                    <div className="text-[10px] text-red-600">Failed to create ChangeSet.</div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {cards.map((card) => (
                    <div key={card._id} className="border rounded p-3 bg-white">
                        <label className="flex items-start gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                className="mt-1"
                                checked={selectedIds.has(String(card._id))}
                                onChange={() => toggleSelection(String(card._id))}
                            />
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-gray-900">{card.title}</div>
                                <div className="text-xs text-gray-500">{card.oneLiner}</div>
                            </div>
                        </label>
                        <details className="mt-2">
                            <summary className="text-xs text-gray-500 cursor-pointer">Details</summary>
                            <div className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">
                                {card.detailsMarkdown}
                            </div>
                        </details>
                    </div>
                ))}
            </div>
        </div>
    );
}
