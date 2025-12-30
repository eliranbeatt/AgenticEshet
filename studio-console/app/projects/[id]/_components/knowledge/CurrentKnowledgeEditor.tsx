"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

interface CurrentKnowledgeEditorProps {
  projectId: Id<"projects">;
}

export function CurrentKnowledgeEditor({ projectId }: CurrentKnowledgeEditorProps) {
  const currentKnowledge = useQuery(api.projectKnowledge.getCurrent, { projectId });
  const knowledgeLog = useQuery(api.projectKnowledge.listLog, { projectId, limit: 50 });
  const updateCurrentKnowledge = useMutation(api.projectKnowledge.updateCurrent);

  const [currentText, setCurrentText] = useState("");
  const [preferencesText, setPreferencesText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (currentKnowledge) {
        if (!dirty) {
            setCurrentText(currentKnowledge.currentText ?? "");
            setPreferencesText(currentKnowledge.preferencesText ?? "");
        }
    }
  }, [currentKnowledge, dirty]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateCurrentKnowledge({
        projectId,
        currentText,
        preferencesText,
        updatedBy: "user",
      });
      setDirty(false);
    } catch (error) {
      console.error("Failed to save knowledge:", error);
      alert("Failed to save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="bg-white p-6 rounded shadow border space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Current Knowledge</h3>
            <p className="text-sm text-gray-500">
              The canonical, editable project truth. Overrides chat history.
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving || !dirty}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50 hover:bg-blue-700"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>

        <div className="space-y-4">
            <div>
                <label className="block text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
                    Preferences & Constraints
                </label>
                <textarea
                    value={preferencesText}
                    onChange={(e) => { setPreferencesText(e.target.value); setDirty(true); }}
                    rows={4}
                    className="w-full border rounded p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-y"
                    placeholder="E.g., Tone, budget constraints, specific client dislikes..."
                />
            </div>

            <div>
                <label className="block text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
                    Knowledge Body
                </label>
                <textarea
                    value={currentText}
                    onChange={(e) => { setCurrentText(e.target.value); setDirty(true); }}
                    rows={15}
                    className="w-full border rounded p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-y font-mono"
                    placeholder="# Project Brief..."
                />
            </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded shadow border space-y-4">
        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Recent Updates Log</h4>
        <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
            {knowledgeLog?.map((entry) => (
                <div key={entry._id} className="border-l-2 border-gray-200 pl-3 py-1 text-sm">
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                        <span className={`uppercase font-bold px-1.5 py-0.5 rounded ${
                            entry.source === 'user_chat' ? 'bg-blue-100 text-blue-800' :
                            entry.source === 'ingestion' ? 'bg-green-100 text-green-800' :
                            'bg-gray-100 text-gray-800'
                        }`}>
                            {entry.source}
                        </span>
                        <span>{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="text-gray-700 whitespace-pre-wrap font-mono text-xs">
                        {entry.text}
                    </div>
                </div>
            ))}
            {(!knowledgeLog || knowledgeLog.length === 0) && (
                <div className="text-gray-400 text-sm italic">No history yet.</div>
            )}
        </div>
      </div>
    </div>
  );
}
