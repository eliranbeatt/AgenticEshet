"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ApprovedElementsViewProps {
    projectId: Id<"projects">;
}

export function ApprovedElementsView({ projectId }: ApprovedElementsViewProps) {
    const approvedElements = useQuery(api.items.listApprovedElementsWithSnapshots, { projectId });
    const brain = useQuery(api.projectBrain.getCurrent, { projectId });

    if (approvedElements === undefined) {
        return <div className="text-gray-500 animate-pulse">Loading approved elements...</div>;
    }

    if (approvedElements.length === 0) {
        return (
            <div className="bg-gray-50 border rounded-lg p-8 text-center text-gray-500 italic">
                No approved elements yet. Approved elements will appear here as "derived truth".
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {approvedElements.map((el) => (
                <div key={el.itemId} className="bg-white rounded-lg shadow-sm border overflow-hidden">
                    <div className="bg-gray-50 px-6 py-4 border-b flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <h3 className="font-bold text-lg text-gray-900">{el.title}</h3>
                            <span className="text-[10px] uppercase font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded tracking-wider">
                                {el.typeKey}
                            </span>
                        </div>
                        <span className="text-xs text-gray-400 font-mono">{el.itemId}</span>
                    </div>
                    <div className="p-6 prose prose-sm max-w-none prose-headings:text-gray-800 prose-headings:font-bold prose-p:text-gray-700 prose-li:text-gray-700">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {el.digestText ?? ""}
                        </ReactMarkdown>
                    </div>
                    {(() => {
                        const notes = (brain as any)?.elementNotes?.[el.itemId]?.notes ?? [];
                        if (!Array.isArray(notes) || notes.length === 0) return null;
                        return (
                            <div className="bg-yellow-50/30 border-t px-6 py-4">
                                <h4 className="text-xs font-bold text-yellow-800 uppercase tracking-widest mb-2">Notes / Proposed (Non-canonical)</h4>
                                <ul className="text-sm text-yellow-900/80 space-y-2">
                                    {notes.map((note: any) => (
                                        <li key={note.id ?? note.text} className="whitespace-pre-wrap italic">
                                            {note.text}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        );
                    })()}
                </div>
            ))}
        </div>
    );
}
