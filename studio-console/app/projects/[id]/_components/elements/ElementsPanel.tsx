"use client";

import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useItemsContext } from "../items/ItemsContext";

type DraftEntry = {
    draft: Doc<"elementDrafts">;
    element: Doc<"projectItems"> | null;
};

export function ElementsPanel() {
    const { projectId, selectedItemId, selectedItemMode, setSelectedItemId, setSelectedItemMode, tabScope } =
        useItemsContext();
    const approvedItems = useQuery(api.items.listApproved, { projectId }) as Doc<"projectItems">[] | undefined;
    const drafts = useQuery(api.elementDrafts.list, { projectId }) as DraftEntry[] | undefined;

    const approveDraft = useAction(api.elementDrafts.approveFromDraft);
    const deleteDraft = useMutation(api.elementDrafts.deleteDraft);

    const [previewDraftId, setPreviewDraftId] = useState<Id<"elementDrafts"> | null>(null);
    const previewData = useQuery(
        api.elementDrafts.getWithApproved,
        previewDraftId ? { projectId, draftId: previewDraftId } : "skip",
    );

    const sortedApproved = useMemo(() => approvedItems ?? [], [approvedItems]);
    const sortedDrafts = useMemo(() => drafts ?? [], [drafts]);

    const handleSelectApproved = (itemId: Id<"projectItems">) => {
        setSelectedItemMode("approved");
        setSelectedItemId(itemId);
    };

    const handleSelectDraft = (itemId: Id<"projectItems">) => {
        setSelectedItemMode("draft");
        setSelectedItemId(itemId);
    };

    return (
        <div className="bg-white border rounded-lg shadow-sm flex flex-col min-h-0">
            <div className="p-3 border-b">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Elements</div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4">
                <section>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Approved</div>
                    {sortedApproved.length === 0 ? (
                        <div className="text-xs text-gray-500">No approved elements yet.</div>
                    ) : (
                        <div className="space-y-2">
                            {sortedApproved.map((item) => {
                                const isActive = selectedItemId === item._id && selectedItemMode === "approved";
                                return (
                                    <button
                                        key={item._id}
                                        type="button"
                                        className={`w-full text-left border rounded px-2 py-2 text-xs ${
                                            isActive
                                                ? "border-blue-500 bg-blue-50"
                                                : "border-gray-200 hover:bg-gray-50"
                                        }`}
                                        onClick={() => handleSelectApproved(item._id)}
                                    >
                                        <div className="font-semibold text-gray-800 truncate">{item.title}</div>
                                        <div className="text-[10px] text-gray-500 mt-1">{item.typeKey}</div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </section>

                <section>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Drafts
                    </div>
                    {sortedDrafts.length === 0 ? (
                        <div className="text-xs text-gray-500">No drafts yet.</div>
                    ) : (
                        <div className="space-y-2">
                            {sortedDrafts.map(({ draft, element }) => {
                                const isActive =
                                    selectedItemId === draft.elementId && selectedItemMode === "draft";
                                return (
                                    <div
                                        key={draft._id}
                                        className={`border rounded p-2 text-xs ${
                                            isActive
                                                ? "border-amber-400 bg-amber-50"
                                                : "border-gray-200 hover:bg-gray-50"
                                        }`}
                                    >
                                        <button
                                            type="button"
                                            className="text-left w-full"
                                            onClick={() => handleSelectDraft(draft.elementId)}
                                        >
                                            <div className="font-semibold text-gray-800 truncate">
                                                {element?.title ?? "Untitled element"}
                                            </div>
                                            <div className="text-[10px] text-gray-500 mt-1">
                                                Updated {new Date(draft.updatedAt).toLocaleString()}
                                            </div>
                                        </button>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                className="text-[10px] px-2 py-1 rounded bg-blue-600 text-white"
                                                onClick={() => handleSelectDraft(draft.elementId)}
                                            >
                                                Edit
                                            </button>
                                            <button
                                                type="button"
                                                className="text-[10px] px-2 py-1 rounded bg-green-600 text-white"
                                                onClick={async () => {
                                                    await approveDraft({
                                                        projectId,
                                                        draftId: draft._id,
                                                        tabScope: tabScope ?? "planning",
                                                    });
                                                    setSelectedItemMode("approved");
                                                    setSelectedItemId(draft.elementId);
                                                }}
                                            >
                                                Approve
                                            </button>
                                            <button
                                                type="button"
                                                className="text-[10px] px-2 py-1 rounded bg-white border border-gray-300"
                                                onClick={() => setPreviewDraftId(draft._id)}
                                            >
                                                Preview diff
                                            </button>
                                            <button
                                                type="button"
                                                className="text-[10px] px-2 py-1 rounded bg-red-100 text-red-700"
                                                onClick={async () => {
                                                    await deleteDraft({ draftId: draft._id });
                                                    if (selectedItemId === draft.elementId) {
                                                        setSelectedItemMode("approved");
                                                    }
                                                }}
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </div>

            {previewDraftId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
                    <div className="bg-white rounded-lg shadow-lg w-full max-w-5xl max-h-[80vh] overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b">
                            <div className="text-sm font-semibold text-gray-800">Draft diff preview</div>
                            <button
                                type="button"
                                className="text-xs text-gray-500 hover:text-gray-700"
                                onClick={() => setPreviewDraftId(null)}
                            >
                                Close
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-4 p-4 max-h-[70vh] overflow-y-auto text-xs">
                            <div>
                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                    Approved
                                </div>
                                <pre className="bg-gray-50 border rounded p-3 overflow-auto">
                                    {previewData?.approvedSpec
                                        ? JSON.stringify(previewData.approvedSpec, null, 2)
                                        : "No approved snapshot."}
                                </pre>
                            </div>
                            <div>
                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                    Draft
                                </div>
                                <pre className="bg-gray-50 border rounded p-3 overflow-auto">
                                    {previewData?.draft?.data
                                        ? JSON.stringify(previewData.draft.data, null, 2)
                                        : "No draft data."}
                                </pre>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
