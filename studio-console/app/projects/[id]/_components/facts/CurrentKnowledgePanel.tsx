"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function CurrentKnowledgePanel({ projectId }: { projectId: Id<"projects"> }) {
    const currentKnowledge = useQuery(api.projectKnowledge.getCurrent, { projectId });
    const updateCurrentKnowledge = useMutation(api.projectKnowledge.updateCurrent);

    const [currentText, setCurrentText] = useState("");
    const [preferencesText, setPreferencesText] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        if (!currentKnowledge || dirty) return;
        setCurrentText(currentKnowledge.currentText ?? "");
        setPreferencesText(currentKnowledge.preferencesText ?? "");
    }, [currentKnowledge, dirty]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await updateCurrentKnowledge({
                projectId,
                currentText,
                preferencesText: preferencesText.trim() ? preferencesText : undefined,
                updatedBy: "user",
            });
            setDirty(false);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="px-4 py-3 border-b flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Current Knowledge</div>
                <button
                    onClick={handleSave}
                    disabled={!dirty || isSaving}
                    className="text-xs font-semibold px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
                >
                    {isSaving ? "Saving..." : "Save"}
                </button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-4">
                <div>
                    <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Preferences</div>
                    <textarea
                        value={preferencesText}
                        onChange={(e) => {
                            setPreferencesText(e.target.value);
                            setDirty(true);
                        }}
                        rows={4}
                        className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="Tone, priorities, constraints, style guides..."
                    />
                </div>
                <div>
                    <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Current Knowledge</div>
                    <textarea
                        value={currentText}
                        onChange={(e) => {
                            setCurrentText(e.target.value);
                            setDirty(true);
                        }}
                        rows={10}
                        className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="Authoritative project truth, decisions, risks, and requirements."
                    />
                </div>
            </div>
        </div>
    );
}
