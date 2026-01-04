"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function CurrentKnowledgePanel({ projectId }: { projectId: Id<"projects"> }) {
    const memory = useQuery(api.memory.getRunningMemoryMarkdown, { projectId });

    return (
        <div className="flex flex-col h-full bg-white">
            <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
                <div className="flex flex-col">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-700">Running Memory</div>
                    <div className="text-[10px] text-gray-500">Auto-updated from chat</div>
                </div>
            </div>
            <div className="flex-1 p-0 relative overflow-auto">
                <pre className="w-full h-full p-4 text-sm leading-relaxed font-mono text-gray-800 whitespace-pre-wrap">
                    {memory ?? "(loading running memory...)"}
                </pre>
            </div>
            <div className="bg-gray-50 border-t px-4 py-2 text-[10px] text-gray-400 text-center">
                Updates after every turn. Edit in Knowledge tab.
            </div>
        </div>
    );
}
