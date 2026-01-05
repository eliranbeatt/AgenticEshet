"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export function RunningMemoryEditor({ projectId }: { projectId: Id<"projects"> }) {
    const markdown = useQuery(api.memory.getRunningMemoryMarkdown, { projectId });
    const updateMarkdown = useMutation(api.memory.updateRunningMemoryMarkdown);

    const [text, setText] = useState("");
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (markdown !== undefined && !isDirty) {
            setText(markdown);
        }
    }, [markdown, isDirty]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setText(e.target.value);
        setIsDirty(true);
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await updateMarkdown({ projectId, markdown: text });
            setIsDirty(false);
        } catch (error) {
            console.error("Failed to save memory:", error);
            alert("Failed to save memory. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    if (markdown === undefined) {
        return <div className="text-sm text-gray-500">Loading memory...</div>;
    }

    return (
        <div className="flex flex-col h-full space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">Running Memory</h2>
                    <p className="text-xs text-gray-500">
                        This is the raw "brain" of the project. It updates automatically after every turn. You can also edit it manually.
                    </p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={!isDirty || isSaving}
                    className={`px-4 py-2 rounded text-sm font-medium ${
                        isDirty
                            ? "bg-blue-600 text-white hover:bg-blue-700"
                            : "bg-gray-100 text-gray-400 cursor-not-allowed"
                    }`}
                >
                    {isSaving ? "Saving..." : isDirty ? "Save Changes" : "Saved"}
                </button>
            </div>
            <div className="flex-1 border rounded-md shadow-sm overflow-hidden">
                <textarea
                    className="w-full h-full p-4 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={text}
                    onChange={handleChange}
                    placeholder="# Running Memory..."
                />
            </div>
        </div>
    );
}
