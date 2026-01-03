"use client";

import { useState } from "react";

export function SaveElementModal({
    defaultTitle,
    onClose,
    onSave,
}: {
    defaultTitle: string;
    onClose: () => void;
    onSave: (args: { title: string; description: string; phase: string }) => void;
}) {
    const [title, setTitle] = useState(defaultTitle);
    const [description, setDescription] = useState("Captured from an existing task");
    const [phase, setPhase] = useState("tasks");

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-lg w-full max-w-lg">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                    <div>
                        <div className="text-sm font-semibold text-gray-800">Save as reusable element</div>
                        <div className="text-xs text-gray-500">Publish this task as a palette template for other teams.</div>
                    </div>
                    <button className="text-xs text-gray-500 hover:text-gray-700" onClick={onClose}>
                        Close
                    </button>
                </div>

                <div className="p-4 space-y-3 text-sm">
                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-[11px] uppercase text-gray-500 font-semibold">Title</span>
                        <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="border rounded px-3 py-2 text-sm"
                        />
                    </label>

                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-[11px] uppercase text-gray-500 font-semibold">Description</span>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="border rounded px-3 py-2 text-sm"
                            rows={3}
                        />
                    </label>

                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-[11px] uppercase text-gray-500 font-semibold">Default studio phase</span>
                        <select
                            value={phase}
                            onChange={(e) => setPhase(e.target.value)}
                            className="border rounded px-3 py-2 text-sm"
                        >
                            <option value="ideation">Ideation</option>
                            <option value="planning">Planning</option>
                            <option value="solutioning">Solutioning</option>
                            <option value="tasks">Tasks</option>
                        </select>
                    </label>
                </div>

                <div className="flex justify-end gap-2 px-4 py-3 border-t bg-gray-50">
                    <button
                        type="button"
                        className="text-sm px-3 py-2 rounded border border-gray-200 text-gray-700"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="text-sm px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                        onClick={() => onSave({ title, description, phase })}
                    >
                        Save element
                    </button>
                </div>
            </div>
        </div>
    );
}
